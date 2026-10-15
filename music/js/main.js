/**
 * Music: plays the music in the user's Music folder. A library built from
 * the folder (artists, albums, folders, songs), a queue with shuffle and
 * repeat, and a now-playing bar that keeps playing while you browse.
 *
 * How it stays responsive (docs/performance.md):
 *  - The window is built from the kit before anything touches the disk; the
 *    saved index loads on the scan thread after the first frame.
 *  - Every file read happens on the scan thread (js/library-worker.js):
 *    walking the folders, reading tags, making cover thumbnails, saving the
 *    index. The page receives finished records in batches.
 *  - While a scan runs the view on screen is redrawn at most every 400 ms,
 *    and only when it shows something the scan changed.
 *  - Songs play from disk through the audio engine's streaming decoder; the
 *    page reads the position once a frame and touches two numbers.
 */

import { startApp } from '/lib/app.js';
import { h, api, perFrame } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, emptyState } from '/lib/layout.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { Progress } from '/lib/controls.js';
import { formatCount } from '/lib/format.js';
import { openApp, userDirs } from '/lib/files.js';
import { Library } from './library.js';
import { Player } from './player.js';
import { Views, totalTime } from './views.js';
import { QueueView } from './queueview.js';
import { NowPlaying } from './nowplaying.js';
import { MprisBridge } from './mpris.js';
import { libraryRoots, editFolders } from './prefs.js';
import { PLAYABLE, UNKNOWN_ARTIST } from './records.js';

const path = require('path');
const fs = require('fs');

/** Least time between two redraws of the view while a scan delivers songs. */
const REFRESH_MS = 400;
/** How often the position is saved while a song plays. */
const SAVE_POSITION_MS = 5000;
const SEEK_STEP = 10;
const TOP_VIEWS = ['songs', 'albums', 'artists', 'folders', 'queue'];

const app = startApp({
  settings: {
    folders: { type: 'json', default: null },        // null: the Music folder
    volume: { type: 'double', default: 0.8, min: 0, max: 1 },
    muted: { type: 'bool', default: false },
    shuffle: { type: 'bool', default: false },
    repeat: { type: 'string', default: 'off' },      // off | all | one
    view: { type: 'string', default: 'albums' },
    queueIndex: { type: 'int', default: 0, min: 0 },  // the queue itself: queue.json (saveQueue)
    position: { type: 'double', default: 0 },
    columns: { type: 'json', default: {} },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  view: TOP_VIEWS.includes(settings.get('view')) ? settings.get('view') : 'albums',
  arg: '',                   // the album key, artist key or folder path the view shows
  history: [],
  query: '',
  songSort: { id: 'artist', dir: 1 },
  lastDraw: 0,
  savedAt: 0,
};

const library = new Library({
  cacheDir: typeof bro !== 'undefined' && bro.app ? bro.app.cacheDir : '.',
  onChange: () => libraryChanged(),
  onProgress: () => drawScanStatus(),
  onScanned: (s) => scanned(s),
});

const player = new Player({
  songOf: (p) => library.song(p),
  onChange: () => playerChanged(),
  onTrack: () => trackChanged(),
  onError: (e, err) => toast(`Cannot play ${path.basename(e.path)}: ${err.message}`, { error: true }),
});
player.volume = settings.get('volume');
player.muted = settings.get('muted');
player.queue.shuffle = settings.get('shuffle');
player.queue.repeat = ['off', 'all', 'one'].includes(settings.get('repeat')) ? settings.get('repeat') : 'off';

// ---- the window ---------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: false });
document.body.appendChild(ui.frame);
const toolbar = new Toolbar(ui.toolbar, commands);

const sidebar = new Sidebar({ onSelect: (item) => go(item.id, '') });
const scanText = h('div.mu-scan-text.dim');
const scanBar = new Progress(null);
scanBar.el.classList.add('mu-scan-bar', 'hidden');
const scanStop = h('button.btn.ghost.small.mu-scan-stop.hidden', { onclick: () => commands.run('stop-scan') }, 'Stop');
const scanBox = h('div.mu-scan', scanBar.el, h('div.mu-scan-row', scanText, scanStop));
ui.sidebar.append(sidebar.el, h('div.grow'), scanBox);

const searchInput = h('input', { type: 'text', placeholder: 'Search', 'aria-label': 'Search' });
const search = h('label.search-field', icon('search'), searchInput);
const redrawSoon = perFrame(() => draw());
searchInput.addEventListener('input', () => { state.query = searchInput.value; redrawSoon(); });

const actions = {
  playSongs: (songs, i, opts) => playSongs(songs, i, opts),
  playView: (shuffle) => playView(shuffle),
  openAlbum: (key) => go('album', key),
  openArtist: (key) => go('artist', key),
  openArtistByName: (name) => go('artist', (name || UNKNOWN_ARTIST).toLowerCase()),
  openFolder: (p) => go('folders', p),
  sortSongs: (sort) => { state.songSort = sort; draw(); },
  clearQueue: () => commands.run('clear-queue'),
  songMenu: (e, songs, heading) => songMenu(e, songs, heading),
};
const views = new Views({ library, player, settings, actions });
const queueView = new QueueView({
  player, library,
  onMove: (from, to) => { player.queue.move(from, to); player.queueChanged(); },
  onActivate: (row) => player.playIndex(row.index),
  onContextMenu: (e, rows) => queueMenu(e, rows),
});

const loading = h('div.mu-loading', h('div.spinner'));
const noMusic = h('div.mu-nomusic.hidden');
ui.content.append(views.head.el, views.stage, loading, noMusic);

// ---- commands -------------------------------------------------------------------

const hasSong = () => !!player.queue.current;
const selection = () => (state.view === 'queue' ? [] : views.selectedSongs());
const queueSelection = () => (state.view === 'queue' ? queueView.list.selectedItems() : []);
const oneSong = () => { const s = selection(); return s.length === 1 ? s[0] : null; };

commands.addAll([
  { id: 'play-pause', label: 'Play', icon: 'play', keys: ['Space', 'MediaPlayPause'],
    enabled: () => hasSong() || views.hasSongs(),
    run: () => (hasSong() ? player.toggle() : playView(false)) },
  { id: 'next', label: 'Next', icon: 'skip-forward', keys: ['Mod+ArrowRight', 'MediaTrackNext'], enabled: hasSong,
    run: () => player.next() },
  { id: 'prev', label: 'Previous', icon: 'skip-back', keys: ['Mod+ArrowLeft', 'MediaTrackPrevious'], enabled: hasSong,
    run: () => player.prev() },
  { id: 'stop', label: 'Stop', icon: 'stop', keys: ['MediaStop'], enabled: () => player.state === 'playing',
    run: () => { player.pause(); player.seek(0); mpris.seeked(0); } },
  { id: 'seek-forward', label: 'Forward 10 Seconds', keys: ['Shift+ArrowRight'], enabled: hasSong,
    run: () => { player.seek(player.readPosition() + SEEK_STEP); mpris.seeked(player.readPosition()); savePosition(); } },
  { id: 'seek-back', label: 'Back 10 Seconds', keys: ['Shift+ArrowLeft'], enabled: hasSong,
    run: () => { player.seek(Math.max(0, player.readPosition() - SEEK_STEP)); mpris.seeked(player.readPosition()); savePosition(); } },
  { id: 'shuffle', label: 'Shuffle', icon: 'shuffle', keys: ['Mod+S'], checked: () => player.queue.shuffle,
    run: () => { player.setShuffle(!player.queue.shuffle); settings.set('shuffle', player.queue.shuffle); saveQueue(); } },
  { id: 'repeat', label: 'Repeat', icon: 'repeat', keys: ['Mod+R'], checked: () => player.queue.repeat !== 'off',
    run: () => setRepeat({ off: 'all', all: 'one', one: 'off' }[player.queue.repeat]) },
  { id: 'repeat-off', label: 'Repeat Off', checked: () => player.queue.repeat === 'off', run: () => setRepeat('off') },
  { id: 'repeat-all', label: 'Repeat the Queue', checked: () => player.queue.repeat === 'all', run: () => setRepeat('all') },
  { id: 'repeat-one', label: 'Repeat One Song', checked: () => player.queue.repeat === 'one', run: () => setRepeat('one') },
  { id: 'mute', label: 'Mute', icon: 'volume-2', keys: ['Mod+M'], checked: () => player.muted,
    run: () => { player.setMuted(!player.muted); settings.set('muted', player.muted); } },
  { id: 'volume-up', label: 'Volume Up', keys: ['Mod+ArrowUp'], run: () => { player.setVolume(player.volume + 0.05); saveVolume(); } },
  { id: 'volume-down', label: 'Volume Down', keys: ['Mod+ArrowDown'], run: () => { player.setVolume(player.volume - 0.05); saveVolume(); } },

  // The view keys work from the search field too: they mean nothing in text.
  { id: 'view-songs', label: 'Songs', icon: 'music', keys: ['Mod+1'], inText: true, run: () => go('songs', '') },
  { id: 'view-albums', label: 'Albums', icon: 'disc', keys: ['Mod+2'], inText: true, run: () => go('albums', '') },
  { id: 'view-artists', label: 'Artists', icon: 'user', keys: ['Mod+3'], inText: true, run: () => go('artists', '') },
  { id: 'view-folders', label: 'Folders', icon: 'folder', keys: ['Mod+4'], inText: true, run: () => go('folders', '') },
  { id: 'show-queue', label: 'Queue', icon: 'list', keys: ['Mod+5'], inText: true, checked: () => state.view === 'queue', run: () => go('queue', '') },
  { id: 'back', label: 'Back', icon: 'arrow-left', keys: ['Alt+ArrowLeft', 'Backspace'], enabled: () => state.history.length > 0,
    run: () => back() },
  { id: 'find', label: 'Search', icon: 'search', keys: ['Mod+F'], inText: true, run: () => { searchInput.focus(); searchInput.select && searchInput.select(); } },
  { id: 'clear-search', label: 'Clear Search', keys: ['Escape'], inText: true, enabled: () => !!state.query || document.activeElement === searchInput,
    run: () => clearSearch() },

  { id: 'play-selection', label: 'Play', icon: 'play', enabled: () => selection().length > 0,
    run: () => playSongs(selection(), 0) },
  { id: 'play-next', label: 'Play Next', icon: 'skip-forward', keys: ['Mod+Shift+N'], enabled: () => selection().length > 0,
    run: () => playNext(selection()) },
  { id: 'add-to-queue', label: 'Add to Queue', icon: 'plus', keys: ['Mod+Shift+A'], enabled: () => selection().length > 0,
    run: () => addToQueue(selection()) },
  { id: 'go-album', label: 'Go to Album', icon: 'disc', enabled: () => !!(oneSong() || queueOne()),
    run: () => { const s = oneSong() || queueOne(); if (s) go('album', s.albumKey); } },
  { id: 'go-artist', label: 'Go to Artist', icon: 'user', enabled: () => !!(oneSong() || queueOne()),
    run: () => { const s = oneSong() || queueOne(); if (s) actions.openArtistByName(s.artist); } },
  { id: 'show-in-files', label: 'Show in Files', icon: 'folder-open', enabled: () => !!api('apps') && !!(oneSong() || queueOne()),
    run: () => showInFiles(oneSong() || queueOne()) },
  { id: 'remove-from-queue', label: 'Remove from Queue', icon: 'x', keys: ['Delete'], enabled: () => queueSelection().length > 0,
    run: () => removeFromQueue(queueSelection()) },
  { id: 'move-up', label: 'Move Up', icon: 'arrow-up', keys: ['Alt+ArrowUp'], enabled: () => queueSelection().length === 1 && queueSelection()[0].index > 0,
    run: () => moveSelected(-1) },
  { id: 'move-down', label: 'Move Down', icon: 'arrow-down', keys: ['Alt+ArrowDown'],
    enabled: () => queueSelection().length === 1 && queueSelection()[0].index < player.queue.length - 1, run: () => moveSelected(1) },
  { id: 'clear-queue', label: 'Clear Queue', icon: 'trash', enabled: () => player.queue.length > 0,
    run: () => { player.queue.clear(); player.queueChanged(); } },

  { id: 'rescan', label: 'Scan Library Again', icon: 'refresh', keys: ['Mod+Shift+R'], enabled: () => !library.scanning,
    run: () => startScan() },
  { id: 'stop-scan', label: 'Stop Scanning', icon: 'x', enabled: () => !!library.scanning && !library.stopping,
    run: () => { library.stop(); drawScanStatus(); } },
  { id: 'folders', label: 'Library Folders…', icon: 'settings', keys: ['Mod+,'], run: () => chooseFolders() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => { mpris.close(); savePosition(true); app.quit(); } },
]);

function queueOne() {
  const rows = queueSelection();
  return rows.length === 1 ? library.song(rows[0].path) : null;
}

toolbar.button('back');
const titleEl = toolbar.add(h('div.toolbar-title.mu-toolbar-title.ellipsis'));
toolbar.spacer();
toolbar.add(search);
toolbar.button('rescan');
toolbar.button('folders');

const mpris = new MprisBridge({
  player, commands,
  onSeek: (t) => { player.seek(t); savePosition(); },
  onVolume: (v, done) => { player.setVolume(v); if (player.muted && v > 0) player.setMuted(false); if (done) saveVolume(); },
  onRepeat: (mode) => setRepeat(mode),
  onShuffle: (on) => { player.setShuffle(on); settings.set('shuffle', player.queue.shuffle); saveQueue(); },
  onOpenUri: (file) => openFiles([file], '.'),
});

// The now-playing bar: its buttons run the commands above.
const bar = new NowPlaying({
  player, commands,
  peaksOf: (p, cb) => library.peaks(p, cb),
  onSeek: (t) => { player.seek(t); mpris.seeked(player.readPosition()); savePosition(); },
  onVolume: (v, done) => { player.setVolume(v); if (player.muted && v > 0) player.setMuted(false); if (done) saveVolume(); },
  onOpenAlbum: () => { const s = player.current; if (s && s.albumKey) go('album', s.albumKey); },
  onOpenArtist: () => { const s = player.current; if (s) actions.openArtistByName(s.artist); },
});
ui.frame.appendChild(bar.el);

// ---- the sidebar ----------------------------------------------------------------

let sidebarSig = '';
function drawSidebar() {
  const n = player.queue.length;
  const sig = `${n}`;
  if (sig !== sidebarSig) {
    sidebarSig = sig;
    sidebar.setSections([
      { title: 'Library', items: [
        { id: 'songs', label: 'Songs', icon: 'music' },
        { id: 'albums', label: 'Albums', icon: 'disc' },
        { id: 'artists', label: 'Artists', icon: 'user' },
        { id: 'folders', label: 'Folders', icon: 'folder' },
      ] },
      { title: 'Playing', items: [{ id: 'queue', label: 'Queue', icon: 'list', count: n || null }] },
    ]);
  }
  sidebar.select({ album: 'albums', artist: 'artists' }[state.view] || state.view);
}

function drawScanStatus() {
  const p = library.progress;
  scanBar.el.classList.toggle('hidden', !p);
  scanStop.classList.toggle('hidden', !p);
  scanStop.disabled = !!library.stopping;
  if (p) {
    scanText.textContent = `Scanning… ${formatCount(p.files, 'song')} found` + (p.parsed ? `, ${p.parsed} read` : '');
  } else if (library.loaded) {
    const n = library.size;
    const s = library.lastScan;
    const left = s ? Object.entries(s.skipped).reduce((t, [, c]) => t + c, 0) : 0;
    const kinds = s ? Object.keys(s.skipped).map((k) => k.toUpperCase()).join(', ') : '';
    scanText.textContent = formatCount(n, 'song') + (left ? `; ${formatCount(left, 'file')} Music cannot play (${kinds}) left out` : '');
  } else {
    scanText.textContent = '';
  }
  toolbar.refresh();
}

// ---- drawing ------------------------------------------------------------------------

/** The view on screen, the head above it and the chrome around it. */
function draw() {
  state.lastDraw = performance.now();
  drawSidebar();
  const queue = state.view === 'queue';
  const empty = library.loaded && library.size === 0 && !library.scanning && !queue;
  loading.classList.toggle('hidden', library.loaded || queue);
  noMusic.classList.toggle('hidden', !empty);
  views.head.el.classList.toggle('hidden', !library.loaded && !queue || empty);
  if (empty) drawNoMusic();
  if (queue) {
    views.mount(queueView.el);
    queueView.show(state.query);
    const total = player.queue.entries.reduce((t, e) => { const s = library.song(e.path); return t + (s ? s.duration || 0 : 0); }, 0);
    views.setHead({ title: 'Queue', queue: true, canPlay: player.queue.length > 0,
      meta: player.queue.length ? [formatCount(player.queue.length, 'song'), totalTime(total)].filter(Boolean).join(' · ') : 'Nothing queued' });
    views.active = null;
    views.shownKey = '';
  } else {
    if (library.loaded && !empty) {
      if (views.stage.firstChild === queueView.el) views.shownKey = '';   // back from the queue: put the list back
      views.show(state);
    } else views.mount(null);
  }
  titleEl.textContent = viewTitle();
  toolbar.refresh();
}

function viewTitle() {
  return { songs: 'Songs', albums: 'Albums', artists: 'Artists', folders: 'Folders', queue: 'Queue', album: 'Album', artist: 'Artist' }[state.view] || '';
}

let noMusicFor = '';
function drawNoMusic() {
  const roots = libraryRoots(settings);
  const sig = roots.join('\n');
  if (sig === noMusicFor) return;
  noMusicFor = sig;
  const where = roots.length === 1 ? `the ${path.basename(roots[0])} folder (${roots[0]})` : roots.length ? `${roots.length} folders` : 'no folders';
  noMusic.replaceChildren(emptyState({
    icon: 'music',
    title: 'No music yet',
    hint: roots.length ? `Music looks in ${where} for MP3, FLAC, Ogg and WAV files. Add some there, or choose other folders.`
      : 'The library has no folders. Choose the folders your music is in.',
    action: { label: 'Choose Folders…', run: () => commands.run('folders') },
  }));
}

/** Songs arrived or left: redraw now, or at most every REFRESH_MS while a scan runs. */
let refreshTimer = null;
function libraryChanged() {
  bar.shown.path = null;                        // the song on the bar may have new tags or a cover
  playerChangedSoon();
  const due = REFRESH_MS - (performance.now() - state.lastDraw);
  if (!library.scanning || due <= 0) { clearTimeout(refreshTimer); refreshTimer = null; draw(); return; }
  if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; draw(); }, due);
}

function scanned(s) {
  clearTimeout(refreshTimer);
  refreshTimer = null;
  drawScanStatus();
  draw();
  if (s && !library.watching) library.watch(libraryRoots(settings));
}

// ---- playing --------------------------------------------------------------------------

const paths = (songs) => songs.map((s) => s.path);

function playSongs(songs, i = 0, { shuffle = false } = {}) {
  if (!songs.length) return;
  if (shuffle && !player.queue.shuffle) { player.queue.shuffle = true; settings.set('shuffle', true); }
  player.playQueue(paths(songs), shuffle ? Math.floor(Math.random() * songs.length) : i);
  saveQueue();
}

function playView(shuffle) {
  if (state.view === 'queue') { if (player.queue.length) player.playIndex(0); return; }
  playSongs(views.viewSongs(), 0, { shuffle });
}

function playNext(songs) {
  if (!songs.length) return;
  const was = player.queue.length;
  player.queue.playNext(paths(songs));
  if (!was) player.queueChanged();
  toast(songs.length === 1 ? `“${songs[0].title}” plays next` : `${formatCount(songs.length, 'song')} play next`, { icon: 'skip-forward' });
  playerChanged();
}

function addToQueue(songs) {
  if (!songs.length) return;
  const was = player.queue.length;
  player.queue.add(paths(songs));
  if (!was) player.queueChanged();
  toast(songs.length === 1 ? `Added “${songs[0].title}” to the queue` : `Added ${formatCount(songs.length, 'song')} to the queue`, { icon: 'list' });
  playerChanged();
}

function removeFromQueue(rows) {
  player.queue.remove(rows.map((r) => r.id));
  player.queueChanged();
}

function moveSelected(d) {
  const row = queueSelection()[0];
  if (!row) return;
  player.queue.move(row.index, row.index + d);
  player.queueChanged();
  queueView.show(state.query, { force: true });
  queueView.list.select([row.id]);
}

function setRepeat(mode) {
  player.setRepeat(mode);
  settings.set('repeat', player.queue.repeat);
}

let shownTrack = '';
function trackChanged() {
  const e = player.queue.current;
  const key = e ? `${e.id}` : '';
  if (key === shownTrack) return;
  shownTrack = key;
  views.playingChanged();
  const s = player.current;
  app.setTitle(s ? s.title : '');
  savePosition(true);
}

/** Player state changed: the bar, the queue page, and what is saved. Once a frame at most. */
const playerChangedSoon = perFrame(() => {
  bar.update();
  mpris.update();
  if (state.view === 'queue') draw();
  else drawSidebar();
  toolbar.refresh();
  saveQueue();
});

function playerChanged() {
  playerChangedSoon();
  if (player.playing) startBarTicks();
}

/** While playing: the bar's position, and the position saved now and then. */
let barTicking = false;
function startBarTicks() {
  if (barTicking) return;
  barTicking = true;
  const tick = () => {
    if (!player.playing) { barTicking = false; bar.tick(); mpris.tick(); savePosition(); return; }
    bar.tick();
    mpris.tick();
    if (performance.now() - state.savedAt > SAVE_POSITION_MS) savePosition();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- what is saved -----------------------------------------------------------------------

// The queue's songs are a file of their own (queue.json in the app's data
// folder), written on the library's thread; its place in them and the
// position are settings. A setting is cheap to set, but the store is one
// file saved whole, so a list of thousands of paths in it would be rewritten
// with every position save.
const QUEUE_FILE = path.join(typeof bro !== 'undefined' && bro.app ? bro.app.dataDir : '.', 'queue.json');
let savedQueue = '';
function saveQueue() {
  const q = player.queue;
  const paths = q.paths();
  const sig = paths.join('\n');
  if (sig !== savedQueue) {
    savedQueue = sig;
    library.writeFile(QUEUE_FILE, JSON.stringify({ version: 1, paths }), 'the queue');
  }
  const index = Math.max(0, q.index);
  if (settings.get('queueIndex') !== index) settings.set('queueIndex', index);
}

function savePosition(force = false) {
  state.savedAt = performance.now();
  const t = Math.round(player.readPosition() * 10) / 10;
  if (force || Math.abs(t - settings.get('position')) >= 0.5) settings.set('position', t);
}

function saveVolume() {
  settings.set('volume', Math.round(player.volume * 100) / 100);
  settings.set('muted', player.muted);
}

/** The last queue, song and position, ready to play (paused). */
function resume() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) || {}; } catch (_) { /* no queue saved yet */ }
  const list = Array.isArray(saved.paths) ? saved.paths.filter((p) => typeof p === 'string') : [];
  if (!list.length) return;
  player.queue.restore(list, Math.max(0, Number(settings.get('queueIndex')) || 0));
  player.position = Math.max(0, Number(settings.get('position')) || 0);
  player.state = 'paused';
  savedQueue = list.join('\n');
  shownTrack = `${player.queue.current.id}`;
  const s = player.current;
  app.setTitle(s ? s.title : '');
  playerChanged();
}

// ---- navigation ---------------------------------------------------------------------------

function go(view, arg = '', { push = true } = {}) {
  if (view === state.view && arg === state.arg) { draw(); return; }
  if (push) state.history.push({ view: state.view, arg: state.arg });
  if (state.history.length > 50) state.history.shift();
  state.view = view;
  state.arg = arg;
  if (state.query) { state.query = ''; searchInput.value = ''; }
  if (TOP_VIEWS.includes(view) && settings.get('view') !== view) settings.set('view', view);
  draw();
  const list = view === 'queue' ? queueView.list : views.active;
  if (list && document.activeElement !== searchInput) list.focus();
}

function back() {
  const prev = state.history.pop();
  if (prev) go(prev.view, prev.arg, { push: false });
}

function clearSearch() {
  const had = !!state.query;
  state.query = '';
  searchInput.value = '';
  if (document.activeElement === searchInput) {
    const list = state.view === 'queue' ? queueView.list : views.active;
    if (list) list.focus(); else searchInput.blur();
  }
  if (had) draw();
}

// ---- menus ---------------------------------------------------------------------------------

function songMenu(e, songs, heading) {
  if (!songs.length) return;
  const one = songs.length === 1;
  menu.show([
    { heading: heading || (one ? songs[0].title : formatCount(songs.length, 'song')) },
    commands.item('play-selection'),
    commands.item('play-next'),
    commands.item('add-to-queue'),
    one ? { separator: true } : null,
    one ? commands.item('go-album') : null,
    one ? commands.item('go-artist') : null,
    one && api('apps') ? commands.item('show-in-files') : null,
  ], e.clientX, e.clientY);
}

function queueMenu(e, rows) {
  if (!rows.length) {
    menu.show([commands.item('clear-queue')], e.clientX, e.clientY);
    return;
  }
  const one = rows.length === 1;
  menu.show([
    { heading: one ? rows[0].title : formatCount(rows.length, 'song') },
    one ? { label: 'Play', icon: 'play', action: () => player.playIndex(rows[0].index) } : null,
    one ? commands.item('move-up') : null,
    one ? commands.item('move-down') : null,
    commands.item('remove-from-queue'),
    one ? { separator: true } : null,
    one ? commands.item('go-album') : null,
    one ? commands.item('go-artist') : null,
  ], e.clientX, e.clientY);
}

async function showInFiles(song) {
  if (!song) return;
  if (!(await openApp('helm.files', [path.dirname(song.path)]))) toast('The Files app is not installed', { error: true });
}

// ---- the library ---------------------------------------------------------------------------

function startScan() {
  // The folders are read when the scan starts (after the saved index is in), not now.
  library.scan(() => libraryRoots(settings));
  drawScanStatus();
}

async function chooseFolders() {
  if (await editFolders(settings)) {
    library.watch([]);
    startScan();
  }
}

/** Files from the command line (or a file manager): play them, now. */
function openFiles(list, cwd) {
  const files = list.map((a) => path.resolve(cwd || '.', a)).filter((p) => PLAYABLE.has(path.extname(p).slice(1).toLowerCase()));
  if (!files.length) return false;
  player.playQueue(files, 0);
  saveQueue();
  return true;
}

// ---- launch ---------------------------------------------------------------------------------
// The window above is all the first frame needs. The disk is touched from here on.

drawSidebar();
draw();
drawScanStatus();

app.onLaunch(({ argv, cwd, first }) => {
  const args = argv.filter((a) => !a.startsWith('--'));
  if (first) {
    resume();
    library.start();
    startScan();
  }
  if (args.length) openFiles(args, cwd);
});

// For tests and the inspector.
app.expose({ state, library, player, views, queueView, bar, mpris, go, back, playSongs, playNext, addToQueue, startScan, resume, userDirs });
