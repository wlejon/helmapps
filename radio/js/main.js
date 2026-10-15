/**
 * Radio: an endless stream of generated instrumental music, steered by
 * moving through a map of sound (briefs/radio.md).
 *
 * The music is YuE2-3B's yue.endless stream, made 10 s at a time on the GPU.
 * The map is an atlas of anchors (instrumental style prompts) placed by CLAP;
 * you are the ring on it. Click to go somewhere, shift+click to lay a path
 * ahead, drag the ring to wander. The trail is where the music really went:
 * each played chunk placed by CLAP from its own audio.
 *
 * How it stays responsive: the models load on their own threads; the stream
 * runs on its worker and hands out audio just ahead of the playhead; CLAP
 * embeds each chunk asynchronously; the map redraws only when something
 * changed. The page's frame loop only feeds the player and reports the
 * playhead.
 */

import { startApp } from '/lib/app.js';
import { h, debounce } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, emptyState } from '/lib/layout.js';
import { Slider, Select } from '/lib/controls.js';
import { toast } from '/lib/toast.js';
import { buildAnchors, ANCHORS_VERSION } from './anchors.js';
import { makeAtlas } from './atlas.js';
import { AtlasView } from './atlas_view.js';
import { Radio, tagAnchor } from './radio.js';
import { capability, resolveModels, allReady, loadBackend, MODELS } from './models.js';
import { ModelsPanel } from './models_view.js';
import { Dialog } from '/lib/dialog.js';
import { PROGRAM_RATE } from './player.js';

const fs = require('fs');
const path = require('path');

/** Seconds between two points of a path ahead (two chunks). */
const LEG_SECONDS = 20;
/** Trail points kept (and saved): about 33 minutes of chunks. */
const TRAIL_MAX = 200;
/** A skip goes at least this far (map units; the anchors span 2). */
const SKIP_DISTANCE = 0.9;

const KNOBS = [
  { id: 'energy', label: 'Energy', min: -2, max: 1 },
  { id: 'density', label: 'Density', min: -1.5, max: 1 },
  { id: 'timbre', label: 'Timbre', min: -1.5, max: 1 },
];

/** Axis presets: principal components, or a CLAP text axis between two phrases. */
const AXES = [
  { value: 'pca', label: 'Principal axes', x: null, y: null },
  { value: 'mood', label: 'Calm–intense · dark–bright',
    x: ['calm, quiet, gentle music', 'intense, loud, driving music'], y: ['dark, gloomy music', 'bright, happy music'] },
  { value: 'sound', label: 'Acoustic–electronic · sparse–full',
    x: ['acoustic instruments', 'electronic synthesizers'], y: ['sparse, minimal music', 'full band, dense arrangement'] },
];

const app = startApp({
  settings: {
    listener: { type: 'json', default: null },     // { x, y }
    owner: { type: 'int', default: -1 },           // the anchor the listener is in
    knobs: { type: 'json', default: {} },
    trail: { type: 'json', default: [] },
    axes: { type: 'string', default: 'pca' },
    modelDirs: { type: 'json', default: {} },      // { yue, vae, clap }: folders chosen in the app
    arWeights: { type: 'string', default: 'int8' },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  phase: 'probing',     // probing | missing | loading | mapping | ready | error
  reason: '',
  backend: null,
  anchors: buildAnchors(),
  atlas: null,
  radio: null,
  playing: false,       // the user asked for sound
  listener: settings.get('listener'),
  owner: settings.get('owner'),
  knobs: Object.assign({ energy: 0, density: 0, timbre: 0 }, settings.get('knobs')),
  trail: settings.get('trail') || [],
  path: [],             // waypoints ahead: { x, y, anchor, at }
  planned: null,        // { anchor, sample }: the newest target placed by the stream
  nowAnchor: -1,        // the anchor the playing chunk was made under
  chunkStarts: [],      // { sample, anchor } of chunks handed out, for the now strip
};

// ---- the window ---------------------------------------------------------------

const ui = appFrame({ toolbar: true, statusbar: true });
document.body.appendChild(ui.frame);
const toolbar = new Toolbar(ui.toolbar, commands);

const view = new AtlasView({
  onGo: (x, y) => goTo(x, y),
  onWaypoint: (x, y) => addWaypoint(x, y),
  onMove: (x, y, end) => wander(x, y, end),
  onHover: (a) => { hoverText.textContent = a ? a.label : ''; },
});

const nowName = h('div.radio-now-name', '—');
const nowNext = h('div.radio-now-next.dim', '');
const playBtn = h('button.icon-btn.radio-play', { onclick: () => commands.run('play-pause'), 'data-tip': 'Play / Pause' }, icon('play'));
const sliders = {};
const knobRow = h('div.radio-knobs', KNOBS.map((k) => {
  const range = (typeof bro !== 'undefined' && bro.music && bro.music.knobRanges && bro.music.knobRanges[k.id]) || k;
  sliders[k.id] = new Slider({ min: range.min, max: range.max, step: 0.05, value: state.knobs[k.id] || 0,
    onChange: (v) => setKnob(k.id, v) });
  return h('label.radio-knob', h('span.micro.dim', k.label), sliders[k.id].el);
}));
const strip = h('div.radio-strip',
  playBtn,
  h('button.icon-btn', { onclick: () => commands.run('skip'), 'data-tip': 'Skip far away' }, icon('skip-forward')),
  h('div.radio-now', nowName, nowNext),
  knobRow);

const blank = h('div.radio-blank');
const stage = h('div.radio-stage', view.el, blank);
ui.content.append(stage, strip);

const hoverText = h('span.dim');
const statusText = h('span.grow.num');
ui.statusbar.append(statusText, hoverText);

const axesSelect = new Select({ options: AXES.map((a) => ({ value: a.value, label: a.label })),
  value: settings.get('axes'), onChange: (v) => setAxes(v) });

function setAxes(v) {
  settings.set('axes', v);
  axesSelect.set(v);
  reproject();
}
const search = h('input.field.radio-search', { type: 'text', placeholder: 'Fly to a sound…',
  onkeydown: (e) => { if (e.key === 'Enter') { flyTo(search.value); e.preventDefault(); } } });

// ---- commands -------------------------------------------------------------------

const ready = () => state.phase === 'ready';
commands.addAll([
  { id: 'play-pause', label: 'Play', icon: 'play', keys: ['Space'], enabled: ready,
    checked: () => state.playing, run: togglePlay },
  { id: 'skip', label: 'Skip Far Away', icon: 'skip-forward', keys: ['Mod+ArrowRight'], enabled: ready, run: skip },
  { id: 'clear-path', label: 'Clear Path Ahead', icon: 'x', keys: ['Escape'],
    enabled: () => state.path.length > 0, run: clearPath },
  { id: 'reset-view', label: 'Fit Map', icon: 'fullscreen', keys: ['Mod+0'], run: () => view.resetView() },
  { id: 'clear-trail', label: 'Clear Trail', icon: 'trash', enabled: () => state.trail.length > 0,
    run: () => { state.trail = []; saveTrail(); view.setState({ trail: [] }); } },
  { id: 'models', label: 'Models…', icon: 'layers', keys: ['Mod+,'],
    enabled: () => state.phase !== 'unavailable' && state.phase !== 'loading', run: openModels },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);
toolbar.add(search);
toolbar.spacer();
toolbar.add(axesSelect.el);
toolbar.button('clear-trail');
toolbar.button('reset-view');
toolbar.sep();
toolbar.button('models');

// ---- boot: models, then the map ---------------------------------------------

function showBlank(node) {
  blank.replaceChildren(...(node ? [node] : []));
  blank.classList.toggle('hidden', !node);
  view.el.classList.toggle('hidden', !!node);
}

function setPhase(phase, reason = '') {
  state.phase = phase;
  state.reason = reason;
  if (phase === 'unavailable') {
    showBlank(emptyState({ icon: 'music', title: 'The radio cannot run here', hint: reason }));
  } else if (phase === 'missing') {
    showBlank(setupCard(reason));
  } else if (phase === 'error') {
    showBlank(emptyState({ icon: 'alert', title: 'The radio stopped', hint: reason,
      action: state.backend ? { label: 'Start Again', run: () => { setPhase('ready'); play(); } } : null }));
  } else if (phase === 'loading' || phase === 'mapping' || phase === 'probing') {
    showBlank(h('div.radio-loading', h('div.spinner'), h('div.dim', reason || 'Starting…')));
  } else {
    showBlank(null);
  }
  toolbar.refresh();
  drawNow();
}

/**
 * The models card shown while the radio cannot start: the panel, why not
 * (a failed load says what failed), and Load once every folder will do.
 */
function setupCard(reason) {
  const panel = new ModelsPanel({ chosen: settings.get('modelDirs'), arWeights: settings.get('arWeights'),
    onChange: (p) => { load.disabled = !p.ready; } });
  const load = h('button.btn.primary.models-load', { onclick: () => applyModels(panel) }, 'Load Models');
  load.disabled = !panel.ready;
  return h('div.card.radio-setup',
    h('div.head', 'Choose the radio\'s models'),
    h('div.dim', 'Pick each model\'s folder, or let bro find it by name. They load on the GPU.'),
    reason ? h('div.radio-setup-error', icon('alert'), h('span', reason)) : null,
    panel.el,
    h('div.radio-setup-actions', load));
}

function boot() {
  const why = capability();
  if (why) { setPhase('unavailable', why); return; }
  const where = resolveModels(settings.get('modelDirs'));
  if (!allReady(where)) { setPhase('missing', ''); return; }
  loadModels(where);
}

/** Loads the models at `where` (resolveModels) and runs the radio on them. */
function loadModels(where) {
  const dirs = {};
  for (const m of MODELS) dirs[m.key] = where[m.key].dir;
  const loaded = new Set();
  const progress = () => `Loading ${MODELS.filter((m) => !loaded.has(m.key)).map((m) => m.label).join(', ')}…`;
  setPhase('loading', progress());
  const t0 = performance.now(), gen = state.backendGen;
  loadBackend(dirs, { arWeights: settings.get('arWeights'),
    onStep: (key) => { loaded.add(key); if (gen === state.backendGen && loaded.size < MODELS.length) setPhase('loading', progress()); } })
    .then((backend) => {
      console.log(`radio: models loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s on ${backend.device}`);
      if (gen === state.backendGen) useBackend(backend);       // unless something chose another backend meanwhile
      else backend.dispose();
    }, (e) => { if (gen === state.backendGen) setPhase('missing', `Loading failed. ${e.message}`); });
}

/** Saves the panel's choice and (re)loads the models with it. */
async function applyModels(panel) {
  settings.set('modelDirs', panel.chosen);
  settings.set('arWeights', panel.arWeights);
  setPhase('loading', 'Releasing the models in use…');
  await releaseBackend();
  boot();
}

/**
 * Stops the stream and frees the backend's models. A stream lets go of the
 * models at its onDone, a moment after stop(), so freeing is retried until
 * then (at most 15 s; after that the weights go with the GC instead).
 */
function releaseBackend() {
  const be = state.backend;
  state.backendGen = (state.backendGen || 0) + 1;
  state.backend = null;
  state.playing = false;
  if (state.radio) state.radio.stop();
  state.radio = null;
  state.atlas = null;
  view.setAtlas(null);
  return new Promise((resolve) => {
    if (!be || !be.dispose) { resolve(); return; }
    const t0 = performance.now();
    const tryFree = () => {
      if (be.dispose()) resolve();
      else if (performance.now() - t0 > 15000) { console.log('radio: models still busy after 15 s; left to the GC'); resolve(); }
      else setTimeout(tryFree, 50);
    };
    tryFree();
  });
}

/** The Models… dialog: change folders or weights at any time; Load reloads. */
async function openModels() {
  const d = new Dialog({ title: 'Models', icon: 'layers', wide: true });
  const panel = new ModelsPanel({ chosen: settings.get('modelDirs'), arWeights: settings.get('arWeights'),
    onChange: (p) => { loadBtn.disabled = !p.ready; } });
  d.body.append(h('div.dim', 'Loading other models stops the music and reloads.'), panel.el);
  d.addButton('Cancel', { value: false });
  const loadBtn = d.addButton('Load', { primary: true, value: true, onClick: () => panel.ready });
  loadBtn.disabled = !panel.ready;
  if (await d.open()) applyModels(panel);
}

/** Runs the radio on a backend (the real one, or a test's fake). */
function useBackend(backend) {
  state.backendGen = (state.backendGen || 0) + 1;
  if (state.radio) state.radio.stop();
  state.backend = backend;
  state.radio = new Radio(backend, {
    onPlanned: (p) => { state.planned = p; drawNow(); },
    onChunk: (c) => { state.chunkStarts.push({ sample: c.sample, anchor: c.anchor }); },
    onTrail: (p) => addTrail(p),
    onError: (m) => { state.playing = false; setPhase('error', m); },
    place: (vec) => state.atlas.placeAudio(vec),
  });
  setPhase('mapping', 'Drawing the map…');
  // Embedding the prompts takes a moment the first time; let the spinner paint first.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    embedAnchors();
    reproject();
    if (!state.listener || state.owner < 0 || state.owner >= state.anchors.length) {
      const a = state.anchors[Math.floor(Math.random() * state.anchors.length)];
      state.listener = { x: a.x, y: a.y };
      state.owner = a.id;
      saveListener();
    }
    view.setState({ listener: state.listener, owner: state.owner, trail: state.trail });
    setPhase('ready');
  }));
}

/** The anchors' CLAP text vectors, cached on disk for the real backend. */
function embedAnchors() {
  const n = state.anchors.length, d = 512;
  // Keyed by the CLAP checkpoint too: another CLAP folder means other vectors.
  const key = state.backend.cacheKey;
  const cache = key && typeof bro !== 'undefined' && bro.app && bro.app.cacheDir
    ? path.join(bro.app.cacheDir, `anchors-v${ANCHORS_VERSION}-${key}.f32`) : null;
  let flat = null;
  if (cache) {
    try {
      const buf = fs.readFileSync(cache);
      if (buf.byteLength === n * d * 4) flat = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } catch (_) { /* first run */ }
  }
  if (!flat) {
    const vecs = state.backend.embedText(state.anchors.map((a) => a.style));
    flat = new Float32Array(n * d);
    vecs.forEach((v, i) => flat.set(v, i * d));
    if (cache) {
      try { fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache, new Uint8Array(flat.buffer)); }
      catch (e) { console.log(`radio: anchor cache not written: ${e.message}`); }
    }
  }
  state.anchors.forEach((a, i) => { a.vec = flat.subarray(i * d, (i + 1) * d); });
}

function reproject() {
  if (!state.backend || !state.anchors[0].vec) return;
  const preset = AXES.find((a) => a.value === settings.get('axes')) || AXES[0];
  const axis = (pair) => (pair ? state.backend.embedText(pair) : null);
  const oldOwner = state.owner;
  state.atlas = makeAtlas(state.anchors, { x: axis(preset.x), y: axis(preset.y) });
  view.setAtlas(state.atlas);
  // The listener stays in its anchor; the trail is re-placed from its anchors.
  if (oldOwner >= 0 && state.listener) {
    const a = state.anchors[oldOwner];
    state.listener = { x: a.x, y: a.y };
  }
  // Points from an earlier session carry no vector: they go to the anchor CLAP heard.
  state.trail = state.trail.map((t) => {
    if (t.vec) { const p = state.atlas.placeAudio(t.vec); return Object.assign(t, { x: p.x, y: p.y }); }
    const a = state.anchors[t.heard];
    return a ? Object.assign(t, { x: a.x, y: a.y }) : t;
  });
  state.path = state.path.map((p) => Object.assign(p, { x: state.anchors[p.anchor].x, y: state.anchors[p.anchor].y }));
  view.setState({ listener: state.listener, trail: state.trail, path: state.path });
}

// ---- playing ------------------------------------------------------------------

function togglePlay() { if (state.playing) pause(); else play(); }

function play() {
  if (!ready()) return;
  state.playing = true;
  const r = state.radio;
  r.setPaused(false);
  if (!r.running) r.start(state.anchors[state.owner], state.knobs);
  drawNow();
}

function pause() {
  state.playing = false;
  if (state.radio) state.radio.setPaused(true);
  drawNow();
}

/** Go to (x, y) now: the listener moves there, the music follows. */
function goTo(x, y) {
  if (!state.atlas) return;
  clearPath();
  const a = state.atlas.nearest(x, y);
  state.listener = { x, y };
  setOwner(a, true);
}

/** Dragging the listener: knobs could follow; the style changes only when another anchor clearly owns the spot. */
function wander(x, y, end) {
  if (!state.atlas) return;
  state.listener = { x, y };
  const a = state.atlas.owner(x, y, state.owner);
  if (a.id !== state.owner) { clearPath(); setOwner(a, false); }
  if (end && state.ownerPending) applyOwner();
  view.setState({ listener: state.listener });
  if (end) saveListener();
}

const applyOwnerSoon = debounce(() => applyOwner(), 600);

function setOwner(a, now) {
  state.owner = a.id;
  state.ownerPending = true;
  view.setState({ listener: state.listener, owner: a.id });
  saveListener();
  if (now) applyOwner(); else applyOwnerSoon();
}

function applyOwner() {
  state.ownerPending = false;
  if (state.radio && state.radio.running) state.radio.go(state.anchors[state.owner]);
  drawNow();
}

function addWaypoint(x, y) {
  if (!state.atlas) return;
  const a = state.atlas.nearest(x, y);
  state.path.push({ x, y, anchor: a.id, at: 0 });
  schedulePath();
}

function clearPath() {
  if (!state.path.length) return;
  state.path = [];
  if (state.radio && state.radio.running) state.radio.setPath([]);
  view.setState({ path: [] });
  toolbar.refresh();
}

/** Times the path: its first point from the open chunk, then one every LEG_SECONDS. */
function schedulePath() {
  const open = state.radio && state.radio.running ? state.radio.openSeconds() : 0;
  state.path.forEach((p, i) => { p.at = open + i * LEG_SECONDS; });
  if (state.radio && state.radio.running) {
    state.radio.setPath(state.path.map((p) => ({ anchor: state.anchors[p.anchor], at: p.at })));
  }
  view.setState({ path: state.path });
  toolbar.refresh();
}

/** The listener reaches each waypoint when the program does. */
function walkPath(nowSec) {
  let moved = false;
  while (state.path.length && state.path[0].at <= nowSec) {
    const p = state.path.shift();
    state.listener = { x: p.x, y: p.y };
    state.owner = p.anchor;
    moved = true;
  }
  if (moved) {
    saveListener();
    view.setState({ listener: state.listener, owner: state.owner, path: state.path });
    toolbar.refresh();
  }
}

function skip() {
  if (!state.atlas) return;
  const here = state.listener || { x: 0, y: 0 };
  const far = state.anchors.filter((a) => Math.hypot(a.x - here.x, a.y - here.y) > SKIP_DISTANCE);
  const pool = far.length ? far : state.anchors;
  const a = pool[Math.floor(Math.random() * pool.length)];
  goTo(a.x, a.y);
  if (!state.playing) play();
}

/** Fly to typed text: CLAP places the phrase on the map and the listener goes there. */
function flyTo(text) {
  text = String(text || '').trim();
  if (!text || !state.atlas) return;
  const [vec] = state.backend.embedText([text]);
  const p = state.atlas.project(vec);
  goTo(p.x, p.y);
  toast(`Flying to “${text}”`, { key: 'fly' });
}

function setKnob(id, v) {
  state.knobs[id] = v;
  if (sliders[id].value !== v) sliders[id].set(v);
  knobsChanged();
}

const knobsChanged = debounce(() => {
  settings.set('knobs', state.knobs);
  if (state.radio) state.radio.setKnobs(state.knobs);
}, 150);

function addTrail(p) {
  state.trail.push({ x: p.x, y: p.y, anchor: p.anchor, heard: p.heard, sample: p.sample, vec: p.vec });
  if (state.trail.length > TRAIL_MAX) state.trail.splice(0, state.trail.length - TRAIL_MAX);
  view.setState({ trail: state.trail });
  saveTrail();
}

function saveListener() {
  settings.set('listener', state.listener);
  settings.set('owner', state.owner);
}
const saveTrail = debounce(() => settings.set('trail', state.trail.map(({ x, y, anchor, heard }) => ({ x, y, anchor, heard }))), 2000);

// ---- the now strip and status ---------------------------------------------------

const fmtSec = (s) => (s < 60 ? `${Math.max(0, Math.round(s))} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

function drawNow() {
  const r = state.radio;
  const playhead = r ? r.playhead : 0;
  while (state.chunkStarts.length > 1 && state.chunkStarts[1].sample <= playhead) state.chunkStarts.shift();
  const cur = state.chunkStarts.length && state.chunkStarts[0].sample <= playhead ? state.chunkStarts[0].anchor : -1;
  state.nowAnchor = cur;
  const want = state.anchors[state.owner];
  if (cur >= 0) nowName.textContent = state.anchors[cur].label;
  else nowName.textContent = state.playing ? 'Starting…' : (want ? want.label : '—');
  let next = '';
  const pl = state.planned;
  if (state.playing && pl && pl.anchor >= 0 && pl.anchor !== cur && pl.sample > playhead) {
    next = `${state.anchors[pl.anchor].label} in ${fmtSec((pl.sample - playhead) / PROGRAM_RATE)}`;
  } else if (state.playing && cur >= 0 && want && want.id !== cur) {
    next = `heading to ${want.label}`;
  }
  nowNext.textContent = next;
  playBtn.replaceChildren(icon(state.playing ? 'pause' : 'play'));
  playBtn.classList.toggle('on', state.playing);

  const st = r ? r.stats() : null;
  if (state.phase !== 'ready') statusText.textContent = state.reason;
  else if (!st) statusText.textContent = state.backend ? `Ready · ${state.backend.device}` : '';
  else {
    statusText.textContent = `${fmtSec(playhead / PROGRAM_RATE)} played · ${st.aheadSeconds.toFixed(1)} s ahead · `
      + `chunk ${st.playing} · ${state.trail.length} on the trail`
      + (st.worstGapSeconds >= 0.2 ? ` · worst gap ${st.worstGapSeconds.toFixed(2)} s` : '');
  }
}

let lastNow = 0;
function frame(t) {
  if (state.radio && state.radio.running) {
    state.radio.tick();
    walkPath(state.radio.playhead / PROGRAM_RATE);
  }
  view.frame();
  if (t - lastNow > 250) { lastNow = t; drawNow(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => { if (state.radio) state.radio.stop(); });

app.expose({ state, view, useBackend, play, pause, goTo, addWaypoint, wander, skip, flyTo, clearPath, setAxes, setKnob });
boot();
