/**
 * Sound Recorder (helm.recorder)
 * Record voice memos and audio clips with live waveform visualization,
 * timestamped markers, playback speed control, and on-device transcription.
 */

import { startApp } from '/lib/app.js';
import { h, clamp } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, SplitPane, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { confirmDialog, promptDialog, alertDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { Select, Switch } from '/lib/controls.js';
import { formatBytes, formatCount, formatDate, formatDateLong, formatDuration } from '/lib/format.js';

import * as wav from './wav.js';
import { CaptureEngine } from './capture.js';
import { RecordingsLibrary, defaultRecordingsDir } from './library.js';
import { WaveformView } from './waveform.js';
import { AudioPlayer, PLAYBACK_SPEEDS } from './player.js';
import { Transcriber } from './transcribe.js';

const path = require('path');

const app = startApp({
  settings: {
    recordingsDir: { type: 'string', default: '' },
    sampleRate: { type: 'int', default: 16000 },
    agc: { type: 'bool', default: false },
    playbackSpeed: { type: 'number', default: 1.0 },
    splitWidth: { type: 'int', default: 360 },
    sttModelDir: { type: 'string', default: '' },
    columns: { type: 'json', default: {} },
  },
});
const { commands, settings } = app;

const state = {
  recording: false,
  paused: false,
  playing: false,
  playbackSpeed: Number(settings.get('playbackSpeed')) || 1.0,
  searchQuery: '',
  sort: { id: 'date', dir: -1 },
  selected: null,
  audioCache: new Map(),
  transcribing: false,
  ready: false,
};

let audioLoadSeq = 0;

const capture = new CaptureEngine({
  headless: app.headless,
  onUpdate: (snap) => onCaptureUpdate(snap),
});

const library = new RecordingsLibrary({
  dir: settings.get('recordingsDir') || defaultRecordingsDir(),
  onChange: () => refreshList(),
});

const player = new AudioPlayer({
  onTimeUpdate: (cur) => {
    if (!state.recording) {
      waveform.setCurrentTime(cur);
      transportTimeNow.textContent = formatDuration(cur);
    }
  },
  onStateChange: (p) => {
    state.playing = p.playing;
    state.playbackSpeed = p.playbackRate;
    syncTransportButtons();
    toolbar.refresh();
  },
});
player.playbackRate = state.playbackSpeed;

const transcriber = new Transcriber({
  settings,
  onStatusChange: () => {
    state.transcribing = transcriber.busy;
    renderTranscriptPanel();
    toolbar.refresh();
  },
});

// ---- window layout (built synchronously before any disk I/O) ----------------

const ui = appFrame({ toolbar: true, sidebar: false, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);

const split = new SplitPane({
  fixed: 'first',
  size: settings.get('splitWidth') || 360,
  min: 260,
  max: 560,
  onResize: (px) => settings.set('splitWidth', px),
});
ui.content.appendChild(split.el);

const searchInput = h('input', {
  type: 'text',
  placeholder: 'Search recordings, markers…',
  'aria-label': 'Search recordings',
  oninput: () => setSearchQuery(searchInput.value),
  onkeydown: (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      e.stopPropagation();
      setSearchQuery('');
    }
  },
});
const searchClearBtn = h('button.icon-btn.small.hidden', {
  'aria-label': 'Clear search',
  onclick: () => setSearchQuery(''),
}, icon('x', 'sm'));
const listBar = h('div.rec-list-bar', h('div.search-field', icon('search'), searchInput, searchClearBtn));

const list = new VirtualList({
  layout: 'list',
  rowHeight: 36,
  key: (it) => it.id,
  label: (it) => it.title,
  sort: state.sort,
  columns: [
    {
      id: 'title',
      label: 'Recording',
      sortable: true,
      minWidth: 130,
      cell: (it) => [
        icon('file-audio'),
        h('span.ellipsis.grow', it.title),
        it.markerCount > 0 ? h('span.badge', `${it.markerCount}`) : null,
      ],
    },
    { id: 'duration', label: 'Length', width: 68, align: 'right', sortable: true, cell: (it) => formatDuration(it.duration) },
    { id: 'date', label: 'Recorded', width: 112, align: 'right', sortable: true, cell: (it) => formatDate(it.createdAt) },
  ],
  columnWidths: settings.get('columns'),
  onColumnResize: (w) => settings.set('columns', w),
  onSort: (id, dir) => { state.sort = { id, dir }; refreshList(); },
  onSelectionChange: (items) => {
    const picked = items[0] || null;
    if (picked && (!state.selected || state.selected.id !== picked.id)) {
      selectRecording(picked, { fromList: true });
    } else if (!picked && state.selected && !state.recording) {
      state.selected = null;
      player.stop();
      renderStage();
    }
    toolbar.refresh();
    updateStatus();
  },
  onActivate: (items) => {
    if (items[0] && !state.recording) {
      selectRecording(items[0], { fromList: true });
      commands.run('play-toggle');
    }
  },
  onContextMenu: (e, items) => showListContextMenu(e, items),
  empty: emptyState({
    icon: 'mic',
    title: 'No recordings yet',
    hint: 'Press Record (Ctrl+R) to capture a new voice memo.',
    action: { label: 'Start Recording', run: () => commands.run('record-toggle') },
  }),
});

split.first.appendChild(h('div.rec-left-pane', listBar, list.el));

const liveDot = h('span.rec-live-dot.hidden');
const stageTitle = h('div.head.ellipsis', 'Ready to Record');
const stageMeta = h('div.rec-meta-line', '16 kHz Mono WAV');
const stageTimer = h('div.rec-timer.num', '0:00');
const stageHeader = h('div.rec-header',
  h('div.rec-title-group', h('div.rec-title-row', liveDot, stageTitle), stageMeta),
  stageTimer
);

const waveform = new WaveformView({
  onScrub: (timeSec) => {
    if (!state.recording && state.selected) {
      player.seek(timeSec);
      transportTimeNow.textContent = formatDuration(player.currentTime);
    }
  },
  onMarkerClick: (marker) => {
    if (!state.recording && state.selected) {
      player.seek(marker.timeSec);
      waveform.setCurrentTime(marker.timeSec);
      transportTimeNow.textContent = formatDuration(marker.timeSec);
    }
  },
});

const recordMainBtn = h('button.btn.danger', { dataset: { command: 'record-toggle' }, onclick: () => commands.run('record-toggle') }, icon('record'), h('span', 'Record'));
const pauseResumeBtn = h('button.btn.hidden', { dataset: { command: 'pause-resume' }, onclick: () => commands.run('pause-resume') }, icon('pause'), h('span', 'Pause'));
const cancelRecBtn = h('button.btn.ghost.hidden', { dataset: { command: 'cancel-record' }, onclick: () => commands.run('cancel-record') }, icon('x'), h('span', 'Discard'));
const playBtn = h('button.btn.primary', { dataset: { command: 'play-toggle' }, onclick: () => commands.run('play-toggle') }, icon('play'), h('span', 'Play'));
const seekBackBtn = h('button.icon-btn', { 'data-tip': 'Skip Back 5s', 'data-keys': '←', 'aria-label': 'Skip Back 5s', onclick: () => commands.run('seek-back') }, icon('skip-back'));
const seekFwdBtn = h('button.icon-btn', { 'data-tip': 'Skip Forward 5s', 'data-keys': '→', 'aria-label': 'Skip Forward 5s', onclick: () => commands.run('seek-forward') }, icon('skip-forward'));
const addMarkerTransportBtn = h('button.btn', { dataset: { command: 'add-marker' }, 'data-tip': 'Add Marker (M)', onclick: () => commands.run('add-marker') }, icon('pin'), h('span', 'Add Marker'));

const transportTimeNow = h('span.num', '0:00');
const transportTimeTotal = h('span.dim.num', '/ 0:00');
const transportTimeBox = h('div.rec-transport-time', transportTimeNow, transportTimeTotal);

const speedSelect = new Select({
  options: PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}x` })),
  value: state.playbackSpeed,
  onChange: (val) => setPlaybackSpeed(val),
});
speedSelect.el.classList.add('rec-speed-select');
speedSelect.el.setAttribute('aria-label', 'Playback Speed');

const agcSwitch = new Switch({
  on: settings.get('agc'),
  label: 'Automatic Gain Control',
  onChange: (on) => settings.set('agc', on),
});

const transportBar = h('div.rec-transport',
  h('div.rec-transport-main', recordMainBtn, pauseResumeBtn, cancelRecBtn, playBtn, seekBackBtn, seekFwdBtn, addMarkerTransportBtn, transportTimeBox),
  h('div.rec-transport-right', h('span.dim', { style: { fontSize: 'var(--fs-cap)' } }, 'Auto Gain'), agcSwitch.el, speedSelect.el)
);

const waveformCard = h('div.rec-waveform-card', waveform.el, transportBar);

const markerCountBadge = h('span.badge', '0');
const markerAddSmallBtn = h('button.btn.small', { onclick: () => commands.run('add-marker') }, icon('plus', 'sm'), 'Marker');
const markerListEl = h('div.rec-marker-list');
const markersPanel = h('div.rec-panel.rec-markers-panel',
  h('div.rec-panel-head', h('div.rec-title-row', h('span.micro', 'MARKERS'), markerCountBadge), markerAddSmallBtn),
  markerListEl
);

const sttStatusBadge = h('span.badge', transcriber.statusHint());
const transcribeBtn = h('button.btn.small', { dataset: { command: 'transcribe' }, onclick: () => commands.run('transcribe') }, icon('sparkles', 'sm'), 'Transcribe');
const transcriptBodyEl = h('div.rec-transcript-body.selectable');
const transcriptPanel = h('div.rec-panel.rec-transcript-panel',
  h('div.rec-panel-head', h('div.rec-title-row', h('span.micro', 'TRANSCRIPT'), sttStatusBadge), transcribeBtn),
  transcriptBodyEl
);

split.second.appendChild(h('div.rec-right-pane', h('div.rec-stage', stageHeader, waveformCard, h('div.rec-panels', markersPanel, transcriptPanel))));

const statusText = h('span.grow', 'Ready');
const statusRight = h('span.dim.num', '');
ui.statusbar.append(statusText, statusRight);

// ---- commands & shortcuts ---------------------------------------------------

commands.addAll([
  { id: 'record-toggle', label: 'Record / Stop', icon: 'record', keys: ['Mod+R'],
    enabled: () => capture.isAvailable() || app.headless,
    run: () => (state.recording ? stopAndSaveRecording() : startRecording()) },
  { id: 'pause-resume', label: 'Pause / Resume Recording', icon: 'pause', keys: ['P'],
    enabled: () => state.recording,
    run: () => (state.paused ? resumeRecording() : pauseRecording()) },
  { id: 'add-marker', label: 'Add Marker', icon: 'pin', keys: ['M'],
    enabled: () => state.recording || !!state.selected,
    run: () => addMarker() },
  { id: 'cancel-record', label: 'Discard Recording', icon: 'x', keys: ['Escape'],
    enabled: () => state.recording,
    run: () => cancelRecording() },
  { id: 'play-toggle', label: 'Play / Pause', icon: 'play', keys: ['Space'],
    enabled: () => !state.recording && !!state.selected && state.selected.duration > 0,
    run: () => togglePlayback() },
  { id: 'seek-back', label: 'Skip Back 5s', icon: 'skip-back', keys: ['ArrowLeft'],
    enabled: () => !state.recording && !!state.selected,
    run: () => { player.skip(-5); waveform.setCurrentTime(player.currentTime); } },
  { id: 'seek-forward', label: 'Skip Forward 5s', icon: 'skip-forward', keys: ['ArrowRight'],
    enabled: () => !state.recording && !!state.selected,
    run: () => { player.skip(5); waveform.setCurrentTime(player.currentTime); } },
  { id: 'rename', label: 'Rename…', icon: 'edit', keys: ['F2'],
    enabled: () => !state.recording && !!state.selected,
    run: () => promptRenameRecording() },
  { id: 'export', label: 'Export WAV…', icon: 'download', keys: ['Mod+S'], inText: true,
    enabled: () => !state.recording && !!state.selected,
    run: () => exportRecording() },
  { id: 'delete', label: 'Delete Recording', icon: 'trash', keys: ['Delete'], danger: true,
    enabled: () => !state.recording && !!state.selected,
    run: () => confirmDeleteRecording() },
  { id: 'search', label: 'Search Recordings', icon: 'search', keys: ['Mod+F'], inText: true,
    run: () => { searchInput.focus(); if (searchInput.select) searchInput.select(); } },
  { id: 'transcribe', label: 'Transcribe Audio', icon: 'sparkles', keys: ['Mod+T'],
    enabled: () => !state.recording && !!state.selected && transcriber.isAvailable() && !state.transcribing,
    run: () => transcribeRecording() },
  { id: 'open-file', label: 'Import WAV…', icon: 'folder-open', keys: ['Mod+O'],
    enabled: () => !state.recording,
    run: () => openWavDialog() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

toolbar.button('record-toggle', { label: true });
toolbar.button('pause-resume');
toolbar.button('add-marker');
toolbar.sep();
toolbar.button('play-toggle');
toolbar.button('seek-back');
toolbar.button('seek-forward');
toolbar.sep();
toolbar.button('transcribe');
toolbar.button('rename');
toolbar.button('export');
toolbar.button('delete');
toolbar.spacer();
toolbar.button('open-file');

// ---- actions & workflows ----------------------------------------------------

function startRecording(opts = {}) {
  if (state.recording) return false;
  player.stop();
  const rate = opts.sampleRate || settings.get('sampleRate') || 16000;
  const agc = opts.agc != null ? opts.agc : settings.get('agc');

  capture.start({ sampleRate: rate, agc, live: opts.live, autoFeed: opts.autoFeed });
  state.recording = true;
  state.paused = false;
  renderStage();
  toolbar.refresh();
  updateStatus();
  return true;
}

function pauseRecording() {
  if (!state.recording || state.paused) return false;
  capture.pause();
  state.paused = true;
  renderStage();
  toolbar.refresh();
  updateStatus();
  return true;
}

function resumeRecording() {
  if (!state.recording || !state.paused) return false;
  capture.resume();
  state.paused = false;
  renderStage();
  toolbar.refresh();
  updateStatus();
  return true;
}

function cancelRecording() {
  if (!state.recording) return false;
  capture.cancel();
  state.recording = false;
  state.paused = false;
  renderStage();
  toolbar.refresh();
  updateStatus();
  toast('Recording discarded', { key: 'rec-state' });
  return true;
}

async function stopAndSaveRecording(customTitle) {
  if (!state.recording) return null;
  const clip = capture.stop();
  state.recording = false;
  state.paused = false;
  if (!clip) {
    renderStage();
    toolbar.refresh();
    return null;
  }

  let samples = clip.samples;
  let duration = clip.duration;
  let peaks = clip.peaks;
  if (!samples || samples.length === 0) {
    samples = new Float32Array(Math.round(clip.sampleRate * 0.1));
    duration = samples.length / clip.sampleRate;
    peaks = wav.computePeaks(samples, 256, 1);
  }

  const saved = await library.saveRecording({
    samples,
    sampleRate: clip.sampleRate,
    duration,
    peaks,
    markers: clip.markers,
    title: customTitle,
  });

  state.audioCache.set(saved.id, { samples, sampleRate: clip.sampleRate, duration, peaks });
  await selectRecording(saved);
  toast(`Saved “${saved.title}”`, { icon: 'check', key: 'rec-state' });
  return saved;
}

function addMarker(label) {
  if (state.recording) {
    const m = capture.addMarker(label);
    renderMarkersPanel();
    return m;
  }
  if (!state.selected) return null;
  const cur = state.selected;
  const timeSec = Math.round((player.currentTime || 0) * 100) / 100;
  const nextIdx = (cur.markers ? cur.markers.length : 0) + 1;
  const marker = { timeSec, label: (label && String(label).trim()) || `Marker ${nextIdx}` };
  const nextMarkers = [...(cur.markers || []), marker].sort((a, b) => a.timeSec - b.timeSec);
  cur.markers = nextMarkers;
  cur.markerCount = nextMarkers.length;
  waveform.setPlaybackState({ markers: nextMarkers });
  renderMarkersPanel();
  library.updateMetadata(cur.id, { markers: nextMarkers }).then((updated) => {
    if (updated && state.selected && state.selected.id === updated.id) state.selected = updated;
  });
  return marker;
}

async function selectRecording(target, { fromList = false } = {}) {
  if (!target) {
    state.selected = null;
    player.stop();
    renderStage();
    return null;
  }
  let item = null;
  if (typeof target === 'number') item = list.items[target] || null;
  else if (typeof target === 'string') item = library.items.find((it) => it.id === target || it.title === target || it.fileName === target) || null;
  else if (typeof target === 'object') item = library.items.find((it) => it.id === target.id) || target;
  if (!item) return null;

  state.selected = item;
  if (!fromList) list.select([item.id]);

  player.stop();
  player.load({ duration: item.duration, sampleRate: item.sampleRate });
  waveform.setPlaybackState({ peaks: item.peaks, duration: item.duration, currentTime: 0, markers: item.markers || [] });

  renderStage();
  toolbar.refresh();
  updateStatus();

  const seq = ++audioLoadSeq;
  const cached = state.audioCache.get(item.id);
  if (cached) {
    player.load(cached);
    return item;
  }

  try {
    const decoded = await library.loadAudio(item);
    if (seq !== audioLoadSeq || !state.selected || state.selected.id !== item.id) return item;
    if (state.audioCache.size > 16) {
      const oldestKey = state.audioCache.keys().next().value;
      state.audioCache.delete(oldestKey);
    }
    state.audioCache.set(item.id, decoded);
    player.load(decoded);
    waveform.setPlaybackState({ peaks: item.peaks, duration: item.duration || decoded.duration });
  } catch (_) {}

  return item;
}

function togglePlayback() {
  if (state.recording || !state.selected) return false;
  return player.toggle();
}

function setPlaybackSpeed(rate) {
  const r = clamp(Number(rate) || 1.0, 0.25, 4.0);
  state.playbackSpeed = r;
  settings.set('playbackSpeed', r);
  player.setSpeed(r);
  speedSelect.set(r);
  return r;
}

function setSearchQuery(q) {
  state.searchQuery = String(q || '');
  if (searchInput.value !== state.searchQuery) searchInput.value = state.searchQuery;
  searchClearBtn.classList.toggle('hidden', !state.searchQuery);
  refreshList();
}

async function promptRenameRecording() {
  const item = state.selected;
  if (!item || state.recording) return null;
  const nextTitle = await promptDialog({
    title: 'Rename Recording',
    value: item.title,
    ok: 'Rename',
    validate: (v) => (!v || !v.trim() ? 'Enter a title' : ''),
  });
  if (!nextTitle || nextTitle.trim() === item.title) return null;
  return renameRecording(item, nextTitle.trim());
}

async function renameRecording(idOrItem, newTitle) {
  const item = idOrItem || state.selected;
  if (!item || !newTitle) return null;
  const updated = await library.updateMetadata(item, { title: String(newTitle).trim() });
  if (updated && state.selected && state.selected.id === updated.id) {
    state.selected = updated;
    renderStage();
  }
  toast(`Renamed to “${updated ? updated.title : newTitle}”`, { key: 'rec-rename' });
  return updated;
}

async function confirmDeleteRecording() {
  const item = state.selected;
  if (!item || state.recording) return false;
  const ok = await confirmDialog({
    title: `Delete “${item.title}”?`,
    body: 'This will remove the recording from your library.',
    ok: 'Delete',
    danger: true,
  });
  if (!ok) return false;
  return deleteRecording(item);
}

async function deleteRecording(idOrItem) {
  const target = idOrItem || state.selected;
  if (!target) return false;
  const wasSelected = state.selected && state.selected.id === (target.id || target);
  if (wasSelected) player.stop();

  const del = await library.deleteRecording(target);
  if (!del) return false;
  state.audioCache.delete(del.item.id);

  if (wasSelected) {
    const next = list.items[0] || null;
    if (next) await selectRecording(next);
    else { state.selected = null; renderStage(); }
  }
  toolbar.refresh();
  updateStatus();

  toast(`Deleted “${del.item.title}”`, {
    icon: 'trash',
    action: 'Undo',
    onAction: async () => {
      const restored = await del.restore();
      if (restored) await selectRecording(restored);
    },
  });
  return true;
}

async function exportRecording(destPath) {
  const item = state.selected;
  if (!item) return false;
  let target = destPath;
  if (!target && typeof showSaveFileDialogAsync === 'function') {
    const defaultName = `${item.title.replace(/[^a-zA-Z0-9._ -]/g, '_')}.wav`;
    target = await showSaveFileDialogAsync('WAV Audio|wav', defaultName);
  }
  if (!target) return false;
  try {
    await library.exportWav(item, target);
    toast(`Exported to ${path.basename(target)}`, { icon: 'download' });
    return true;
  } catch (err) {
    await alertDialog({ title: 'Could not export WAV', body: err.message, icon: 'alert' });
    return false;
  }
}

async function transcribeRecording(idOrItem) {
  const item = idOrItem
    ? (typeof idOrItem === 'string' ? library.items.find((x) => x.id === idOrItem) : idOrItem)
    : state.selected;
  if (!item) return null;
  if (!transcriber.isAvailable()) {
    toast(transcriber.statusHint(), { icon: 'info' });
    return null;
  }
  try {
    let audio = state.audioCache.get(item.id);
    if (!audio) {
      audio = await library.loadAudio(item);
      state.audioCache.set(item.id, audio);
    }
    const text = await transcriber.transcribe(audio, item);
    const updated = await library.updateMetadata(item.id, { transcript: text });
    if (updated && state.selected && state.selected.id === updated.id) {
      state.selected = updated;
      renderTranscriptPanel();
    }
    toast('Transcription complete', { icon: 'sparkles' });
    return text;
  } catch (err) {
    toast(`Transcription failed: ${err.message}`, { error: true });
    return null;
  }
}

async function openWavDialog() {
  if (typeof showOpenFileDialogAsync !== 'function') return;
  const picked = await showOpenFileDialogAsync('WAV Audio|wav', false);
  if (picked && picked.length) {
    const entry = await library.importWavFile(picked[0]);
    if (entry) await selectRecording(entry);
  }
}

async function setRecordingsDir(dir) {
  player.stop();
  state.selected = null;
  state.audioCache.clear();
  await library.setDir(dir);
  if (list.items.length > 0) await selectRecording(list.items[0]);
  else renderStage();
  return library.items;
}

function setMockTranscriber(fn) {
  transcriber.setMockTranscriber(fn);
}

// ---- rendering & UI sync ----------------------------------------------------

function onCaptureUpdate(snap) {
  if (!state.recording) return;
  stageTimer.textContent = formatDuration(snap.duration);
  transportTimeNow.textContent = formatDuration(snap.duration);
  transportTimeTotal.textContent = '/ Live';
  waveform.setLiveState(snap);
  if (markerCountBadge.textContent !== String(snap.markers.length)) renderMarkersPanel();
}

function refreshList() {
  const rows = library.query({ query: state.searchQuery, sortBy: state.sort.id, sortDir: state.sort.dir });
  if (list.sort !== state.sort) list.setSort(state.sort);
  list.setItems(rows);
  if (state.selected) {
    const fresh = library.items.find((it) => it.id === state.selected.id);
    if (fresh) state.selected = fresh;
  }
  updateStatus();
  toolbar.refresh();
}

function renderStage() {
  if (state.recording) {
    liveDot.classList.remove('hidden');
    liveDot.classList.toggle('paused', state.paused);
    stageTitle.textContent = state.paused ? 'Recording Paused' : 'Recording in Progress…';
    stageMeta.textContent = `${capture.sampleRate / 1000} kHz 16-bit PCM Mono${capture.agc ? ' • AGC On' : ''}`;
    stageTimer.textContent = formatDuration(capture.duration);
    app.setTitle(state.paused ? 'Paused' : 'Recording…');
  } else if (state.selected) {
    const it = state.selected;
    liveDot.classList.add('hidden');
    stageTitle.textContent = it.title;
    stageMeta.textContent = `${formatDateLong(it.createdAt)} • ${(it.sampleRate / 1000).toFixed(0)} kHz • ${formatBytes(it.size)}`;
    stageTimer.textContent = formatDuration(it.duration);
    transportTimeNow.textContent = formatDuration(player.currentTime);
    transportTimeTotal.textContent = `/ ${formatDuration(it.duration)}`;
    app.setTitle(it.title);
  } else {
    liveDot.classList.add('hidden');
    stageTitle.textContent = capture.isAvailable() || app.headless ? 'Ready to Record' : 'Microphone Unavailable';
    stageMeta.textContent = capture.isAvailable() || app.headless
      ? 'Select a recording on the left or press Record (Ctrl+R).'
      : 'bro.mic is not available in this environment.';
    stageTimer.textContent = '0:00';
    transportTimeNow.textContent = '0:00';
    transportTimeTotal.textContent = '/ 0:00';
    waveform.setPlaybackState({ peaks: [], duration: 0, currentTime: 0, markers: [] });
    app.setTitle('');
  }

  syncTransportButtons();
  renderMarkersPanel();
  renderTranscriptPanel();
}

function syncTransportButtons() {
  if (state.recording) {
    recordMainBtn.replaceChildren(icon('stop'), h('span', 'Stop & Save'));
    pauseResumeBtn.classList.remove('hidden');
    pauseResumeBtn.replaceChildren(icon(state.paused ? 'play' : 'pause'), h('span', state.paused ? 'Resume' : 'Pause'));
    cancelRecBtn.classList.remove('hidden');
    playBtn.classList.add('hidden');
    seekBackBtn.classList.add('hidden');
    seekFwdBtn.classList.add('hidden');
  } else {
    recordMainBtn.replaceChildren(icon('record'), h('span', 'Record'));
    pauseResumeBtn.classList.add('hidden');
    cancelRecBtn.classList.add('hidden');
    playBtn.classList.remove('hidden');
    seekBackBtn.classList.remove('hidden');
    seekFwdBtn.classList.remove('hidden');
    playBtn.disabled = !state.selected || state.selected.duration <= 0;
    seekBackBtn.disabled = !state.selected;
    seekFwdBtn.disabled = !state.selected;
    playBtn.replaceChildren(icon(state.playing ? 'pause' : 'play'), h('span', state.playing ? 'Pause' : 'Play'));
  }
  addMarkerTransportBtn.disabled = !state.recording && !state.selected;
  markerAddSmallBtn.disabled = !state.recording && !state.selected;
}

function renderMarkersPanel() {
  const markers = state.recording ? capture.markers : (state.selected ? state.selected.markers || [] : []);
  markerCountBadge.textContent = String(markers.length);

  if (!markers.length) {
    markerListEl.replaceChildren(
      h('div.rec-transcript-empty', state.recording || state.selected
        ? 'No markers yet. Press M to drop a timestamped marker.'
        : 'Select or start a recording to add markers.')
    );
    return;
  }

  markerListEl.replaceChildren(...markers.map((m, idx) =>
    h('button.rec-marker-pill', {
      dataset: { markerIndex: String(idx) },
      onclick: () => {
        if (!state.recording && state.selected) {
          player.seek(m.timeSec);
          waveform.setCurrentTime(m.timeSec);
          transportTimeNow.textContent = formatDuration(m.timeSec);
        }
      },
    }, h('span.ellipsis', m.label), h('span.rec-marker-pill-time.num', formatDuration(m.timeSec)))
  ));
}

function renderTranscriptPanel() {
  sttStatusBadge.textContent = transcriber.statusHint();
  const avail = transcriber.isAvailable();
  sttStatusBadge.classList.toggle('ok', avail);
  transcribeBtn.disabled = state.recording || !state.selected || !avail || state.transcribing;

  const text = !state.recording && state.selected ? (state.selected.transcript || '') : '';
  if (text) {
    transcriptBodyEl.className = 'rec-transcript-body selectable';
    transcriptBodyEl.textContent = text;
  } else {
    transcriptBodyEl.className = 'rec-transcript-body rec-transcript-empty';
    transcriptBodyEl.textContent = avail
      ? 'Press Transcribe (Ctrl+T) to generate an on-device transcript.'
      : 'On-device STT available when model installed';
  }
}

function showListContextMenu(e, items) {
  if (!items.length) return;
  const it = items[0];
  selectRecording(it, { fromList: true });
  menu.show([
    { heading: it.title },
    commands.item('play-toggle', { label: state.playing ? 'Pause' : 'Play' }),
    commands.item('add-marker'),
    commands.item('transcribe'),
    { separator: true },
    commands.item('rename'),
    commands.item('export'),
    { separator: true },
    commands.item('delete'),
  ], e.clientX, e.clientY);
}

function updateStatus() {
  if (state.recording) {
    statusText.textContent = state.paused ? 'Recording paused' : 'Recording from microphone…';
    statusRight.textContent = `${formatCount(capture.markers.length, 'marker')}`;
    return;
  }
  const total = library.items.length;
  const shown = list.items.length;
  const totalSec = library.items.reduce((acc, r) => acc + (r.duration || 0), 0);
  if (state.searchQuery) {
    statusText.textContent = `Showing ${shown} of ${formatCount(total, 'recording')} matching “${state.searchQuery}”`;
  } else {
    statusText.textContent = `${formatCount(total, 'recording')} • ${formatDuration(totalSec)} total`;
  }
  statusRight.textContent = transcriber.statusHint();
}

renderStage();
requestAnimationFrame(() => waveform.measure());

transcriber.checkModelDir();
library.load().then(async (items) => {
  state.ready = true;
  if (items.length > 0 && !state.selected && !state.recording) {
    await selectRecording(items[0]);
  }
});

app.onLaunch(async ({ argv, cwd }) => {
  const target = (argv || []).find((a) => !a.startsWith('--') && a.toLowerCase().endsWith('.wav'));
  if (target) {
    const full = path.resolve(cwd || '.', target);
    const entry = await library.importWavFile(full);
    if (entry) await selectRecording(entry);
  }
});

app.expose({
  state, list, library, capture, player, waveform, transcriber, wav,
  startRecording, pauseRecording, resumeRecording, stopAndSaveRecording,
  cancelRecording, addMarker, selectRecording, togglePlayback,
  setPlaybackSpeed, setSearchQuery, renameRecording, promptRenameRecording,
  deleteRecording, confirmDeleteRecording, exportRecording, transcribeRecording,
  setRecordingsDir, setMockTranscriber,
});
