/**
 * Image Viewer: open an image and look at it. Fit, zoom, pan, step through
 * the folder, rotate and flip the view, see its details; a thumbnail strip,
 * and a folder grid when opened on a folder. It never changes a file except
 * by Rename and Move to Trash.
 *
 * How it stays responsive (docs/performance.md):
 *  - The window is built from the kit before anything touches the disk; the
 *    image or folder from the command line opens on the next tick.
 *  - Decoding happens on a decoder thread (js/decode-worker.js); the page
 *    receives an ImageBitmap and only draws it. The neighbours of the image
 *    on screen are decoded while you look, so Next is instant.
 *  - Previews come from bro.thumb on its own threads, only for the cells on
 *    screen, six at a time. A folder listing is one async readdir.
 */

import { startApp } from '/lib/app.js';
import { h, api, debounce } from '/lib/dom.js';
import { defineIcon } from '/lib/icons.js';
import { appFrame, Toolbar, SplitPane, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { formatNumber, formatCount } from '/lib/format.js';
import { homeDir } from '/lib/files.js';
import { Viewer } from './viewer.js';
import { Decoder } from './decoder.js';
import { Folder } from './folder.js';
import { Thumbs } from './thumbs.js';
import { StripList, cellRenderer, paintThumb, visiblePaths } from './gallery.js';
import { Details } from './details.js';
import { FileActions } from './actions.js';
import { Presentation } from './presentation.js';
import { isImage, dialogFilter, compareNames } from './formats.js';

const fs = require('fs');
const path = require('path');

defineIcon('flip-v', '<path d="M3 12h18"/><path d="M7 8l5-5 5 5zM7 16l5 5 5-5z"/>');

const app = startApp({
  settings: {
    showStrip: { type: 'bool', default: true },
    showDetails: { type: 'bool', default: false },
    slideshowSeconds: { type: 'int', default: 4, min: 1, max: 60 },
    lastFolder: { type: 'string', default: '' },
    background: { type: 'string', default: 'dark' },      // dark | mid | checker
    detailsWidth: { type: 'int', default: 280, min: 200, max: 520 },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  mode: 'empty',       // 'empty' | 'image' | 'grid'
  path: '',            // the image on screen, or the one selected in the grid
  pic: null,           // its decoded picture, once it is in
  loading: '',         // the path being decoded
  error: '',           // why the image on screen cannot be shown
};

// ---- the window ---------------------------------------------------------------

const ui = appFrame({ toolbar: true, statusbar: true });
document.body.appendChild(ui.frame);
const toolbar = new Toolbar(ui.toolbar, commands);

const viewer = new Viewer({
  onChange: () => { updateStatus(); toolbar.refresh(); },
  // Zoomed past the screen-sized preview: the full-resolution tiles on screen.
  onNeedTiles: (pic, keys) => decoder.wantTiles(pic, keys),
});
viewer.el.dataset.bg = settings.get('background');
const details = new Details();
const decoder = new Decoder({
  inUse: (pic) => viewer.pic === pic,
  // A tile is drawn on the frame after it arrives, so taking delivery and uploading it do not share one.
  onTile: (pic) => { if (viewer.pic === pic) viewer.schedule(); },
});
const folder = new Folder({ onChange: () => folderChanged() });

const cells = new Set();
const thumbs = new Thumbs({
  onReady: (p, url) => { for (const el of cells) if (el._path === p) paintThumb(el, url); },
});

const grid = new VirtualList({
  // A wall of square tiles edge to edge: about 240 px each, widened so the
  // columns fill the window; the picture is the cell, no names, no gaps.
  layout: 'grid',
  cellWidth: 240,
  fill: true,
  aspect: 1,
  gap: 0,
  padding: 0,
  key: (it) => it.path,
  label: (it) => it.name,
  render: cellRenderer(thumbs, cells),
  onActivate: (items) => items[0] && openImage(items[0].path),
  onSelectionChange: (items) => {
    if (state.mode !== 'grid') return;
    state.path = items[0] ? items[0].path : state.path;
    updateStatus();
    if (settings.get('showDetails')) details.show(state.path, null);
  },
  onContextMenu: (e, items) => items.length && menu.show([
    { heading: items[0].name },
    { label: 'Open', icon: 'image', action: () => openImage(items[0].path) },
  ], e.clientX, e.clientY),
  empty: emptyState({ icon: 'image', title: 'No images here', hint: 'This folder has no images Image Viewer can show.' }),
});
grid.el.classList.add('iv-grid');

let syncingStrip = false;
const strip = new StripList({
  cellWidth: 88,
  cellHeight: 76,
  padding: 4,
  key: (it) => it.path,
  label: (it) => it.name,
  render: cellRenderer(thumbs, cells),
  onSelectionChange: (items) => {
    if (syncingStrip || !items[0] || items[0].path === state.path) return;
    openImage(items[0].path);
  },
});
strip.scroller.addEventListener('wheel', (e) => {
  e.preventDefault();
  strip.scroller.scrollLeft += (e.deltaY || 0) + (e.deltaX || 0);
}, { passive: false });

// Requests for cells scrolled away are dropped.
const trimThumbs = debounce(() => thumbs.keepOnly([...visiblePaths(grid), ...visiblePaths(strip)]), 100);
grid.scroller.addEventListener('scroll', trimThumbs);
strip.scroller.addEventListener('scroll', trimThumbs);

const startEmpty = emptyState({
  icon: 'image',
  title: 'No image open',
  hint: 'Open an image or a folder of images, or drop one onto the window.',
  action: { label: 'Open…', run: () => commands.run('open') },
});
startEmpty.classList.add('iv-start');
const loadingEl = h('div.iv-loading.hidden', h('div.spinner'));
const errorEl = h('div.iv-error.hidden');

const viewArea = h('div.iv-view', viewer.el, loadingEl, errorEl);
const split = new SplitPane({
  fixed: 'second', size: settings.get('detailsWidth'), min: 200, max: 520,
  onResize: (px) => settings.set('detailsWidth', px),
});
split.first.append(viewArea, grid.el, startEmpty, strip.el);
split.second.append(details.el);
ui.content.append(split.el);

const status = {
  dims: h('span.num'),
  zoom: h('span.num'),
  pos: h('span.num'),
  note: h('span.iv-note.hidden'),
  text: h('span.grow.ellipsis'),
};
ui.statusbar.append(status.dims, status.zoom, status.pos, status.note, status.text);

const presentation = new Presentation({
  settings,
  next: () => step(1),
  canRun: () => state.mode === 'image' && folder.items.length > 1,
  onChange: () => { layoutChrome(); toolbar.refresh(); },
});

const actions = new FileActions({
  current: () => state.path,
  onRenamed: renamed,
  onTrashed: trashed,
  onRestored: (p) => { folder.reload(); openImage(p); },
});

// ---- commands -------------------------------------------------------------------

const viewing = () => state.mode === 'image' && !!state.pic;
const hasFile = () => !!state.path && state.mode !== 'empty';
const several = () => state.mode === 'image' && folder.items.length > 1;

commands.addAll([
  { id: 'open', label: 'Open…', icon: 'folder-open', keys: ['Mod+O'], run: chooseFile },
  { id: 'next', label: 'Next Image', icon: 'chevron-right', keys: ['ArrowRight', 'PageDown', 'Space'],
    enabled: several, run: () => step(1) },
  { id: 'prev', label: 'Previous Image', icon: 'chevron-left', keys: ['ArrowLeft', 'PageUp', 'Backspace'],
    enabled: several, run: () => step(-1) },
  { id: 'first', label: 'First Image', keys: ['Home'], enabled: several, run: () => goIndex(0) },
  { id: 'last', label: 'Last Image', keys: ['End'], enabled: several, run: () => goIndex(folder.items.length - 1) },
  { id: 'zoom-in', label: 'Zoom In', icon: 'zoom-in', keys: ['Mod+=', 'Mod+Shift+=', 'Mod++'],
    enabled: viewing, run: () => viewer.zoomIn() },
  { id: 'zoom-out', label: 'Zoom Out', icon: 'zoom-out', keys: ['Mod+-'], enabled: viewing, run: () => viewer.zoomOut() },
  { id: 'fit', label: 'Fit to Window', keys: ['Mod+0'], enabled: viewing, checked: () => viewing() && viewer.v.fit,
    run: () => viewer.fit() },
  { id: 'actual', label: 'Actual Size (100%)', keys: ['Mod+1'], enabled: viewing, run: () => viewer.zoomTo(1) },
  { id: 'zoom-menu', label: 'Zoom', enabled: viewing, run: () => zoomMenu() },
  { id: 'rotate-cw', label: 'Rotate Right', icon: 'rotate-cw', keys: ['R'], enabled: viewing, run: () => turn(() => viewer.rotate(90)) },
  { id: 'rotate-ccw', label: 'Rotate Left', icon: 'rotate-ccw', keys: ['Shift+R'], enabled: viewing, run: () => turn(() => viewer.rotate(-90)) },
  { id: 'flip-h', label: 'Flip Horizontally', icon: 'flip-h', keys: ['H'], enabled: viewing, run: () => turn(() => viewer.flip('h')) },
  { id: 'flip-v', label: 'Flip Vertically', icon: 'flip-v', keys: ['V'], enabled: viewing, run: () => turn(() => viewer.flip('v')) },
  { id: 'exit-fullscreen', label: 'Leave Full Screen', keys: ['Escape'], enabled: () => presentation.fullscreen,
    run: () => presentation.setFullscreen(false) },
  { id: 'show-folder', label: 'Show Folder', icon: 'grid', keys: ['Escape'], enabled: () => state.mode === 'image' && !!folder.dir,
    run: () => openFolder(folder.dir, { select: state.path }) },
  { id: 'fullscreen', label: 'Full Screen', icon: 'fullscreen', keys: ['F11'], checked: () => presentation.fullscreen,
    run: () => presentation.setFullscreen(!presentation.fullscreen) },
  { id: 'slideshow', label: 'Slideshow', icon: 'play', keys: ['F5'], enabled: () => presentation.canRun(),
    run: () => presentation.startSlideshow() },
  { id: 'details', label: 'Details', icon: 'info', keys: ['Mod+I'], checked: () => settings.get('showDetails'),
    run: () => toggleSetting('showDetails') },
  { id: 'strip', label: 'Thumbnails', icon: 'image', keys: ['Mod+T'], checked: () => settings.get('showStrip'),
    run: () => toggleSetting('showStrip') },
  { id: 'rename', label: 'Rename…', icon: 'edit', keys: ['F2'], enabled: hasFile, run: () => actions.rename() },
  { id: 'trash', label: 'Move to Trash', icon: 'trash', keys: ['Delete'], danger: true,
    enabled: () => hasFile() && !!api('vfs'), run: () => actions.trash() },
  { id: 'copy', label: 'Copy Path', icon: 'copy', keys: ['Mod+C'], enabled: hasFile, run: () => actions.copyPath() },
  { id: 'open-with', label: 'Open With…', icon: 'external-link', enabled: () => hasFile() && !!api('apps'),
    run: () => actions.openWithMenu(document.querySelector('[data-command="menu"]')) },
  { id: 'show-in-files', label: 'Show in Files', icon: 'folder', keys: ['Mod+Shift+O'], enabled: () => hasFile() && !!api('apps'),
    run: () => actions.showInFiles() },
  { id: 'close', label: 'Close Window', keys: ['Mod+W'], run: () => app.quit() },
  { id: 'menu', label: 'More', icon: 'more-v', run: () => moreMenu() },
  ...['dark', 'mid', 'checker'].map((bg) => ({
    id: `bg-${bg}`, label: { dark: 'Dark', mid: 'Grey', checker: 'Checkerboard' }[bg],
    checked: () => settings.get('background') === bg, run: () => setBackground(bg),
  })),
]);

// Buttons that act on the image on screen hide in the folder grid.
const imageOnly = [];
const only = (el) => { imageOnly.push(el); return el; };
toolbar.button('show-folder');
toolbar.sep();
toolbar.button('prev');
toolbar.button('next');
const titleEl = toolbar.add(h('div.iv-title.ellipsis'));
toolbar.spacer();
only(toolbar.button('zoom-out'));
const zoomButton = only(toolbar.add(h('button.btn.ghost.small.iv-zoom.num', { 'data-tip': 'Zoom', 'data-command': 'zoom-menu',
  onclick: () => commands.run('zoom-menu') }, '100%')));
only(toolbar.button('zoom-in'));
only(toolbar.sep());
only(toolbar.button('rotate-ccw'));
only(toolbar.button('rotate-cw'));
only(toolbar.sep());
toolbar.button('slideshow');
toolbar.button('details');
toolbar.button('open');
toolbar.button('menu');

function toggleSetting(key) {
  settings.set(key, !settings.get(key));
  layoutChrome();
  if (key === 'showDetails' && settings.get('showDetails')) details.show(state.path, state.pic);
}

function setBackground(bg) {
  settings.set('background', bg);
  viewer.el.dataset.bg = bg;
}

/** Rotate and flip change the view only; the first one says so. */
let saidViewOnly = false;
function turn(fn) {
  fn();
  if (!saidViewOnly && viewer.transformed()) {
    saidViewOnly = true;
    toast('Rotate and flip change the view only; the file is not changed', { icon: 'info' });
  }
}

function zoomMenu() {
  const s = viewer.scale();
  const level = (z, label) => ({ label, checked: !viewer.v.fit && Math.abs(s - z) < 1e-3, action: () => viewer.zoomTo(z) });
  menu.showBelow([
    { ...commands.item('fit'), checked: viewer.v.fit },
    { separator: true },
    level(0.25, '25%'), level(0.5, '50%'), level(1, '100%'), level(2, '200%'), level(4, '400%'),
    { separator: true },
    commands.item('zoom-in'), commands.item('zoom-out'),
  ], zoomButton);
}

function moreMenu() {
  const anchor = document.querySelector('[data-command="menu"]');
  menu.showBelow([
    commands.item('flip-h'), commands.item('flip-v'),
    { separator: true },
    commands.item('fullscreen'), commands.item('strip'),
    { label: 'Background', icon: 'palette', submenu: [commands.item('bg-dark'), commands.item('bg-mid'), commands.item('bg-checker')] },
    { separator: true },
    commands.item('copy'), commands.item('open-with'), commands.item('show-in-files'),
    { separator: true },
    commands.item('rename'), commands.item('trash'),
  ], anchor);
}

function stageMenu(e) {
  if (!state.pic) return;
  e.preventDefault();
  menu.show([
    commands.item('fit'), commands.item('actual'), commands.item('zoom-in'), commands.item('zoom-out'),
    { separator: true },
    commands.item('rotate-cw'), commands.item('rotate-ccw'), commands.item('flip-h'), commands.item('flip-v'),
    { separator: true },
    commands.item('copy'), commands.item('open-with'), commands.item('show-in-files'),
    { separator: true },
    commands.item('rename'), commands.item('trash'),
  ], e.clientX, e.clientY);
}
viewer.el.addEventListener('contextmenu', stageMenu);

// ---- what shows where ---------------------------------------------------------------

/** Show the parts of the window the mode, the settings and full screen call for. */
function layoutChrome() {
  const m = state.mode;
  const full = presentation.fullscreen;
  document.body.classList.toggle('iv-fullscreen', full);
  viewArea.classList.toggle('hidden', m !== 'image');
  grid.el.classList.toggle('hidden', m !== 'grid');
  startEmpty.classList.toggle('hidden', m !== 'empty');
  strip.el.classList.toggle('hidden', m !== 'image' || !settings.get('showStrip') || full);
  split.setCollapsed(!settings.get('showDetails') || m === 'empty' || full);
  if (m === 'image') syncStrip();
}

function updateStatus() {
  const m = state.mode;
  const pic = state.pic;
  const name = state.path ? path.basename(state.path) : '';
  if (m === 'image') app.setTitle(name);
  else if (m === 'grid') app.setTitle(path.basename(folder.dir) || folder.dir);
  else app.setTitle('');
  titleEl.textContent = m === 'image' ? name : m === 'grid' ? path.basename(folder.dir) || folder.dir : '';
  const n = folder.items.length;
  const i = folder.indexOf(state.path);
  status.dims.textContent = m === 'image' && pic ? `${formatNumber(pic.width)} × ${formatNumber(pic.height)}` : '';
  status.zoom.textContent = m === 'image' && pic ? `${Math.round(viewer.scale() * 100)}%` : '';
  zoomButton.textContent = m === 'image' && pic ? `${Math.round(viewer.scale() * 100)}%` : '–';
  status.pos.textContent = m === 'image' && n ? `${i >= 0 ? i + 1 : '–'} / ${formatNumber(n)}` : '';
  const note = m === 'image' ? viewNote() : '';
  status.note.textContent = note;
  status.note.classList.toggle('hidden', !note);
  if (m === 'grid') status.text.textContent = folder.error ? `Cannot read this folder: ${folder.error}` : formatCount(n, 'image');
  else if (m === 'image' && state.error) status.text.textContent = state.error;
  else status.text.textContent = '';
  for (const k of ['dims', 'zoom', 'pos']) status[k].classList.toggle('hidden', !status[k].textContent);
  for (const el of imageOnly) el.classList.toggle('hidden', m !== 'image');
}

/** "Rotated 90°, flipped · view only" while the view differs from the file. */
function viewNote() {
  const v = viewer.v;
  const parts = [];
  if (v.rotation) parts.push(`Rotated ${v.rotation}°`);
  if (v.flipH) parts.push('flipped horizontally');
  if (v.flipV) parts.push('flipped vertically');
  if (!parts.length) return '';
  const s = parts.join(', ');
  return `${s[0].toUpperCase()}${s.slice(1)} · view only`;
}

function syncStrip() {
  syncingStrip = true;
  if (strip.items !== folder.items) strip.setItems(folder.items);
  if (state.path && folder.indexOf(state.path) >= 0) strip.select([state.path]);
  else strip.clearSelection();
  syncingStrip = false;
}

/** The folder's list changed (loaded, or a file came or went). */
function folderChanged() {
  if (grid.items !== folder.items) {
    const keep = grid.selectedItems().map((it) => it.path);
    grid.setItems(folder.items);
    if (keep.length) grid.select(keep, { scroll: false });
  }
  if (state.mode === 'grid' && state.path && !grid.selection.size && folder.indexOf(state.path) >= 0) grid.select([state.path]);
  if (state.mode === 'image') {
    syncStrip();
    prefetchNeighbours();
  }
  updateStatus();
  toolbar.refresh();
}

// ---- opening --------------------------------------------------------------------------

/** Open a file or a folder by path (command line, Open, a drop). */
async function openPath(p, { quiet = false } = {}) {
  if (!p) return;
  p = path.resolve(p);
  let st = null;
  try { st = await fs.promises.stat(p); } catch (_) { st = null; }
  if (!st) {
    if (!quiet) toast(`Not found: ${p}`, { error: true });
    return;
  }
  if (st.isDirectory()) openFolder(p);
  else if (isImage(p)) openImage(p);
  else if (!quiet) toast(`Image Viewer cannot show ${path.basename(p)}`, { error: true });
}

/** lastFolder, written only when it changes (a bro.conf write costs a few ms). */
function rememberFolder(dir) {
  if (settings.get('lastFolder') !== dir) settings.set('lastFolder', dir);
}

/** The folder grid, with `select` (an image path) selected. */
function openFolder(dir, { select = '' } = {}) {
  presentation.stopSlideshow();
  state.mode = 'grid';
  state.error = '';
  rememberFolder(dir);
  if (select) state.path = select;
  else if (path.dirname(state.path) !== dir) state.path = '';
  layoutChrome();
  folder.load(dir).then(() => {
    if (state.mode !== 'grid') return;
    if (state.path && folder.indexOf(state.path) >= 0) grid.select([state.path]);
    grid.focus();
  });
  if (folder.dir === dir && folder.items.length) folderChanged();
  if (state.path) grid.select([state.path]);
  grid.focus();
  updateStatus();
  toolbar.refresh();
}

/** Show one image (and list its folder for Next / Previous). */
function openImage(p) {
  state.mode = 'image';
  state.path = p;
  state.error = '';
  const dir = path.dirname(p);
  rememberFolder(dir);
  folder.load(dir);
  layoutChrome();
  // Keys go to the view (not to the grid now hidden); the strip keeps them if it has them.
  if (!strip.el.contains(document.activeElement)) viewer.el.focus();
  errorEl.classList.add('hidden');
  load(p);
  updateStatus();
  toolbar.refresh();
}

let spinnerTimer = null;
function load(p) {
  state.loading = p;
  if (state.pic && state.pic.path !== p) state.pic = null;
  clearTimeout(spinnerTimer);
  spinnerTimer = setTimeout(() => loadingEl.classList.toggle('hidden', state.loading !== p), 150);
  if (settings.get('showDetails')) details.show(p, null);
  decoder.get(p).then((pic) => {
    // A picture that just arrived from the decoder thread is drawn on the
    // next frame, so taking delivery and uploading it do not share one.
    requestAnimationFrame(() => {
      if (state.path !== p || state.mode !== 'image') return;
      shown(pic);
    });
  }, (err) => {
    if (state.path !== p) return;
    state.loading = '';
    state.pic = null;
    state.error = `Cannot show ${path.basename(p)}: ${err.message}`;
    loadingEl.classList.add('hidden');
    viewer.clear();
    errorEl.replaceChildren(emptyState({ icon: 'alert', title: 'This image cannot be shown', hint: err.message }));
    errorEl.classList.remove('hidden');
    updateStatus();
    toolbar.refresh();
  });
}

function shown(pic) {
  if (viewer.pic && viewer.pic !== pic) decoder.release(viewer.pic);
  state.loading = '';
  state.pic = pic;
  loadingEl.classList.add('hidden');
  viewer.show(pic);
  if (settings.get('showDetails')) details.show(pic.path, pic);
  prefetchNeighbours();
  updateStatus();
  toolbar.refresh();
}

function prefetchNeighbours() {
  const items = folder.items;
  const i = folder.indexOf(state.path);
  if (i < 0 || items.length < 2 || state.loading) return;
  decoder.prefetch([items[(i + 1) % items.length].path, items[(i - 1 + items.length) % items.length].path]);
}

// ---- moving through the folder ----------------------------------------------------------

/** The next (+1) or previous (-1) image in name order, wrapping at the ends. */
function step(dir) {
  const items = folder.items;
  if (!items.length) return;
  let i = folder.indexOf(state.path);
  if (i < 0) {
    // The image is not in the list (yet, or any more): go from where its name would be.
    const name = path.basename(state.path);
    const after = items.findIndex((it) => compareNames(it.name, name) > 0);
    i = dir > 0 ? (after < 0 ? items.length : after) - 1 : (after < 0 ? items.length : after);
  }
  goIndex((i + dir + items.length) % items.length);
}

function goIndex(i) {
  const it = folder.items[i];
  if (it && it.path !== state.path) openImage(it.path);
}

// ---- file actions ------------------------------------------------------------------------

function renamed(from, to) {
  decoder.rename(from, to);
  thumbs.forget(from);
  details.invalidate();
  if (state.path === from) state.path = to;
  if (state.pic && state.pic.path === to) viewer.show(state.pic, { keepView: true });
  folder.reload();
  updateStatus();
  if (settings.get('showDetails')) details.show(state.path, state.pic);
  toast(`Renamed to “${path.basename(to)}”`, { icon: 'edit' });
}

function trashed(p) {
  const items = folder.items;
  const i = folder.indexOf(p);
  const rest = items.filter((it) => it.path !== p);
  decoder.drop(p);
  thumbs.forget(p);
  folder.reload();
  if (state.mode === 'grid' || !rest.length) {
    state.path = '';
    openFolder(path.dirname(p));
    return;
  }
  openImage(rest[Math.min(Math.max(i, 0), rest.length - 1)].path);
}

async function chooseFile() {
  if (typeof showOpenFileDialog !== 'function') return;
  const picked = showOpenFileDialog(dialogFilter(), false);
  if (picked && picked.length) openPath(picked[0]);
}

// Drop an image (or a folder) onto the window.
ui.frame.addEventListener('dragover', (e) => e.preventDefault());
ui.frame.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [];
  const first = files.find((f) => f.path);
  if (first) openPath(first.path);
});

// ---- launch -------------------------------------------------------------------------------
// The window above is all the first frame needs. The disk is touched from here on.

layoutChrome();
updateStatus();

app.onLaunch(({ argv, cwd, first }) => {
  const target = argv.find((a) => !a.startsWith('--'));
  if (target) openPath(path.resolve(cwd || homeDir(), target));
  else if (first && settings.get('lastFolder')) openPath(settings.get('lastFolder'), { quiet: true });
});

// For tests and the inspector.
app.expose({ state, viewer, folder, grid, strip, decoder, thumbs, details, presentation, openPath, openImage, openFolder });
