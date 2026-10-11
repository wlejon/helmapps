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
 *  - Find Animals (js/wildlife) analyses the folder on workers; the grid,
 *    the strip and Next / Previous show its filtered list (shownItems()).
 */

import { startApp } from '/lib/app.js';
import { h, api, debounce } from '/lib/dom.js';
import { appFrame, Toolbar, SplitPane, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { formatNumber, formatCount } from '/lib/format.js';
import { homeDir } from '/lib/files.js';
import { Viewer } from './viewer.js';
import { Decoder } from './decoder.js';
import { Folder } from './folder.js';
import { Thumbs, FAILED } from './thumbs.js';
import { stripList, cellRenderer, paintThumb, visiblePaths } from './gallery.js';
import { Details } from './details.js';
import { FileActions } from './actions.js';
import { Presentation } from './presentation.js';
import { isImage, dialogFilter, compareNames } from './formats.js';
import { buildToolbar, zoomMenu, moreMenu, stageMenu, viewNote, chooseImage, acceptDrops } from './chrome.js';
import { BurstFeature, BURST_SETTINGS } from './burst/burst.js';
import { WildlifeFeature, WILDLIFE_SETTINGS } from './wildlife/feature.js';

const fs = require('fs');
const os = require('os');
const path = require('path');

const app = startApp({
  settings: {
    showStrip: { type: 'bool', default: true },
    showDetails: { type: 'bool', default: false },
    slideshowSeconds: { type: 'int', default: 4, min: 1, max: 60 },
    lastFolder: { type: 'string', default: '' },
    background: { type: 'string', default: 'dark' },      // dark | mid | checker
    detailsWidth: { type: 'int', default: 280, min: 200, max: 520 },
    ...BURST_SETTINGS,
    ...WILDLIFE_SETTINGS,
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  mode: 'empty',       // 'empty' | 'image' | 'grid' | 'burst' (the stabilize view)
  path: '',            // the image on screen, or the one selected in the grid
  pic: null,           // its decoded picture, once it is in
  loading: '',         // the path being decoded
  error: '',           // why the image on screen cannot be shown
};
let burst = null;      // the stabilize-a-burst feature (js/burst/burst.js), made below
let wild = null;       // Find Animals (js/wildlife/feature.js), made below

/** The folder's images as the grid, the strip and Next / Previous show them (Find Animals' filter). */
const shownItems = () => (wild ? wild.items(folder.items) : folder.items);

// ---- the window ---------------------------------------------------------------

const ui = appFrame({ toolbar: true, statusbar: true });
document.body.appendChild(ui.frame);
const toolbar = new Toolbar(ui.toolbar, commands);

const viewer = new Viewer({
  onChange: () => { updateStatus(); toolbar.refresh(); },
  // Zoomed past the screen-sized preview: the picture at full resolution.
  onNeedFull: (pic) => decoder.wantFull(pic),
  // The subject tool's mask and an isolated animal's darkening follow the view.
  onDraw: () => { if (burst) burst.tool.draw(); if (wild && wild.isolate) wild.isolate.draw(); },
});
viewer.el.dataset.bg = settings.get('background');
const details = new Details({ extra: (file) => (wild ? wild.details(file) : null) });
const decoder = new Decoder({
  inUse: (pic) => viewer.pic === pic,
  onFull: (pic) => { if (viewer.pic === pic) viewer.schedule(); },
});
const folder = new Folder({ onChange: () => folderChanged(), onWatch: () => wild.folderChanged({ force: true }) });

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
  render: cellRenderer(thumbs, cells, (it, el) => wild.decorate(it, el)),
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

// The strip selects the frames of a burst: a plain click opens a photo,
// Shift+click and Ctrl+click change the selection and leave the photo on screen.
let syncingStrip = false;
let stripModifier = false;
const strip = stripList({
  cellWidth: 88,
  cellHeight: 76,
  padding: 4,
  key: (it) => it.path,
  label: (it) => it.name,
  render: cellRenderer(thumbs, cells),
  onSelectionChange: () => {
    if (syncingStrip) return;
    if (stripModifier) {
      // The photo on screen stays one of the frames.
      if (state.path && !strip.selection.has(state.path) && strip.index.has(state.path)) {
        strip.selection.add(state.path);
        strip.paint();
      }
      if (burst) burst.changed();
      // A frame left out of the selection may be one the animal filter hides: once the strip is done with the click.
      Promise.resolve().then(() => itemsChanged());
      return;
    }
    const it = strip.items[strip.cursor];
    if (it && it.path !== state.path) openImage(it.path);
  },
});
const noteModifier = (e) => { stripModifier = !!(e.shiftKey || e.ctrlKey || e.metaKey); };
strip.el.addEventListener('pointerdown', noteModifier, true);
strip.el.addEventListener('keydown', noteModifier, true);

// Requests for cells scrolled away are dropped.
const trimThumbs = debounce(() => thumbs.keepOnly([...visiblePaths(grid), ...visiblePaths(strip)]), 100);
grid.scroller.addEventListener('scroll', trimThumbs);
strip.scroller.addEventListener('scroll', trimThumbs);

const startEmpty = emptyState({ icon: 'image', title: 'No image open',
  hint: 'Open an image or a folder of images, or drop one onto the window.', action: { label: 'Open…', run: () => commands.run('open') } });
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

burst = new BurstFeature({
  settings, viewer, viewHost: viewArea, host: split.first, strip, folder,
  current: () => (state.mode === 'image' || state.mode === 'burst' ? state.path : ''),
  onMode: (mode) => {
    presentation.stopSlideshow();
    state.mode = mode;
    if (wild.holdReleased()) itemsChanged();
    layoutChrome();
    if (mode === 'image') viewer.el.focus();
    updateStatus();
    toolbar.refresh();
  },
  // Leaving Select Subject or Stabilize: the animal filter held back while they were open applies now.
  onChange: () => { if (wild.holdReleased()) itemsChanged(); else { updateStatus(); toolbar.refresh(); } },
  burstOf: (p) => wild.burstMembers(p),
});

wild = new WildlifeFeature({
  settings, commands, folder, viewer, viewHost: viewArea, mode: () => state.mode,
  cacheDir: (typeof bro !== 'undefined' && bro.app && bro.app.cacheDir) || path.join(os.tmpdir(), 'helm-images'),
  onItems: () => itemsChanged(),
  onDetails: () => { if (settings.get('showDetails')) details.refresh(state.path); },
  // The filter never takes away the photo on screen or the frames selected around it,
  // and nothing at all while Select Subject or Stabilize is open.
  keep: () => (state.mode === 'image' || state.mode === 'burst' ? [state.path, ...strip.selection] : []),
  hold: () => burst.picking || burst.active,
});

const status = { dims: h('span.num'), zoom: h('span.num'), pos: h('span.num'), note: h('span.iv-note.hidden'), text: h('span.grow.ellipsis') };
ui.statusbar.append(status.dims, status.zoom, status.pos, status.note, status.text, wild.statusEl);

const presentation = new Presentation({
  settings,
  next: () => step(1),
  canRun: () => state.mode === 'image' && shownItems().length > 1,
  onChange: () => { layoutChrome(); toolbar.refresh(); },
});

const actions = new FileActions({
  current: () => state.path,
  imagePng: (p) => decoder.get(p).then((pic) => decoder.png(pic)),
  onRenamed: renamed,
  onTrashed: trashed,
  onRestored: (p) => { folder.reload(); openImage(p); },
});

// ---- commands -------------------------------------------------------------------

const viewing = () => state.mode === 'image' && !!state.pic;
const hasFile = () => !!state.path && (state.mode === 'image' || state.mode === 'grid');
const several = () => state.mode === 'image' && shownItems().length > 1;

// The burst's commands first: in the stabilize view, Space, the arrows and
// Escape are its own.
commands.addAll(burst.commands({ imageShown: () => state.mode === 'image' && !!state.path && !state.error }));
commands.addAll(wild.commandList());
commands.addAll([
  { id: 'open', label: 'Open…', icon: 'folder-open', keys: ['Mod+O'], run: chooseFile },
  { id: 'next', label: 'Next Image', icon: 'chevron-right', keys: ['ArrowRight', 'PageDown', 'Space'],
    enabled: several, run: () => step(1) },
  { id: 'prev', label: 'Previous Image', icon: 'chevron-left', keys: ['ArrowLeft', 'PageUp', 'Backspace'],
    enabled: several, run: () => step(-1) },
  { id: 'first', label: 'First Image', keys: ['Home'], enabled: several, run: () => goIndex(0) },
  { id: 'last', label: 'Last Image', keys: ['End'], enabled: several, run: () => goIndex(shownItems().length - 1) },
  { id: 'zoom-in', label: 'Zoom In', icon: 'zoom-in', keys: ['Mod+=', 'Mod+Shift+=', 'Mod++'],
    enabled: viewing, run: () => viewer.zoomIn() },
  { id: 'zoom-out', label: 'Zoom Out', icon: 'zoom-out', keys: ['Mod+-'], enabled: viewing, run: () => viewer.zoomOut() },
  { id: 'fit', label: 'Fit to Window', keys: ['Mod+0'], enabled: viewing, checked: () => viewing() && viewer.v.fit,
    run: () => viewer.fit() },
  { id: 'actual', label: 'Actual Size (100%)', keys: ['Mod+1'], enabled: viewing, run: () => viewer.zoomTo(1) },
  { id: 'zoom-menu', label: 'Zoom', enabled: viewing, run: () => zoomMenu(commands, viewer, zoomButton) },
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
  { id: 'copy', label: 'Copy Image', icon: 'copy', keys: ['Mod+C'], enabled: hasFile, run: () => actions.copyImage() },
  { id: 'copy-path', label: 'Copy Path', keys: ['Mod+Shift+C'], enabled: hasFile, run: () => actions.copyPath() },
  { id: 'open-with', label: 'Open With…', icon: 'external-link', enabled: () => hasFile() && !!api('apps'),
    run: () => actions.openWithMenu(document.querySelector('[data-command="menu"]')) },
  { id: 'show-in-files', label: 'Show in Files', icon: 'folder', keys: ['Mod+Shift+O'], enabled: () => hasFile() && !!api('apps'),
    run: () => actions.showInFiles() },
  { id: 'close', label: 'Close Window', keys: ['Mod+W'], run: () => app.quit() },
  { id: 'menu', label: 'More', icon: 'more-v', run: () => moreMenu(commands) },
  ...['dark', 'mid', 'checker'].map((bg) => ({
    id: `bg-${bg}`, label: { dark: 'Dark', mid: 'Grey', checker: 'Checkerboard' }[bg],
    checked: () => settings.get('background') === bg, run: () => setBackground(bg),
  })),
]);

// Buttons that act on the image on screen hide in the folder grid (js/chrome.js).
const { titleEl, zoomButton, imageOnly, burstOnly, notBurst } = buildToolbar(toolbar, commands, { extra: wild.filterBtn });

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

viewer.el.addEventListener('contextmenu', (e) => { if (state.pic) stageMenu(commands, e); });

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
  split.setCollapsed(!settings.get('showDetails') || m === 'empty' || m === 'burst' || full);
  if (m === 'image') syncStrip();
}

function updateStatus() {
  const m = state.mode;
  const pic = state.pic;
  const name = state.path ? path.basename(state.path) : '';
  const burstTitle = m === 'burst' ? `Stabilize · ${burst.session.frames.length} frames from ${name}` : '';
  if (m === 'image') app.setTitle(name);
  else if (m === 'grid') app.setTitle(path.basename(folder.dir) || folder.dir);
  else if (m === 'burst') app.setTitle(burstTitle);
  else app.setTitle('');
  titleEl.textContent = m === 'image' ? name : m === 'grid' ? path.basename(folder.dir) || folder.dir : burstTitle;
  const items = shownItems();
  const n = items.length;
  const i = items.findIndex((it) => it.path === state.path);
  status.dims.textContent = m === 'image' && pic ? `${formatNumber(pic.width)} × ${formatNumber(pic.height)}` : '';
  status.zoom.textContent = m === 'image' && pic ? `${Math.round(viewer.scale() * 100)}%` : '';
  zoomButton.textContent = m === 'image' && pic ? `${Math.round(viewer.scale() * 100)}%` : '–';
  status.pos.textContent = m === 'image' && n ? `${i >= 0 ? i + 1 : '–'} / ${formatNumber(n)}` : '';
  const note = m === 'image' ? viewNote(viewer.v) : '';
  status.note.textContent = note;
  status.note.classList.toggle('hidden', !note);
  const all = folder.items.length;
  const count = n === all ? formatCount(n, 'image') : `${formatNumber(n)} of ${formatCount(all, 'image')}`;
  if (m === 'grid') status.text.textContent = folder.error ? `Cannot read this folder: ${folder.error}` : count;
  else if (m === 'image' && state.error) status.text.textContent = state.error;
  else if (m === 'burst') status.text.textContent = burst.statusText();
  else status.text.textContent = '';
  for (const k of ['dims', 'zoom', 'pos']) status[k].classList.toggle('hidden', !status[k].textContent);
  for (const el of imageOnly) el.classList.toggle('hidden', m !== 'image');
  for (const el of burstOnly) el.classList.toggle('hidden', m !== 'burst');
  for (const el of notBurst) el.classList.toggle('hidden', m === 'burst');
  wild.showStatus();
}

function syncStrip() {
  syncingStrip = true;
  // Twice: the filter keeps the selection, so a selection changed here may let photos it kept go.
  for (let pass = 0; pass < 2; pass++) {
    const items = shownItems();
    if (strip.items !== items) strip.setItems(items);
    // A burst's frames selected around the photo stay selected.
    if (state.path && strip.index.has(state.path)) {
      if (!strip.selection.has(state.path)) strip.select([state.path]);
      else strip.cursor = strip.index.get(state.path);
    } else strip.clearSelection();
  }
  syncingStrip = false;
}

/** The folder's list changed (loaded, or a file came or went). */
function folderChanged() {
  wild.folderChanged();
  itemsChanged();
  if (state.mode === 'image') prefetchNeighbours();
}

/** What the grid and the strip show changed: the folder, or Find Animals' answers or filter. */
function itemsChanged() {
  const items = shownItems();
  if (grid.items !== items) {
    const keep = grid.selectedItems().map((it) => it.path);
    grid.setItems(items);
    if (keep.length) grid.select(keep, { scroll: false });
  }
  if (state.mode === 'grid' && state.path && !grid.selection.size && grid.index.has(state.path)) grid.select([state.path]);
  if (state.mode === 'image') syncStrip();
  updateStatus();
  toolbar.refresh();
}

// ---- opening --------------------------------------------------------------------------

/**
 * Open a file or a folder by path (command line, Open, a drop). The newest
 * request wins; `restore` (the last folder, at launch) gives way to any other.
 */
let openSeq = 0;
async function openPath(p, { quiet = false, restore = false } = {}) {
  if (!p || (restore && openSeq)) return;
  const seq = ++openSeq;
  p = path.resolve(p);
  let st = null;
  try { st = await fs.promises.stat(p); } catch (_) { st = null; }
  if (seq !== openSeq) return;
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
  burst.photoChanged(p);
  updateStatus();
  toolbar.refresh();
}

let spinnerTimer = null;
function load(p) {
  state.loading = p;
  if (state.pic && state.pic.path !== p) state.pic = null;
  clearTimeout(spinnerTimer);
  // No spinner over a preview standing in for the photo.
  const previewing = () => !!(viewer.pic && viewer.pic.placeholder && viewer.pic.path === p);
  spinnerTimer = setTimeout(() => loadingEl.classList.toggle('hidden', state.loading !== p || previewing()), 150);
  if (settings.get('showDetails')) details.show(p, null);
  if (!decoder.peek(p)) showPreviewOf(p);
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

/**
 * While a photo decodes, show its grid preview stretched to fit: moving
 * through a folder faster than photos decode (Next held down) then shows
 * every photo at once, a little soft, sharpening where the user stops. The
 * preview's own size is a few hundred px, so it stands in at a nominal large
 * size with its aspect; fitting scales it to the stage like the photo.
 */
function showPreviewOf(p) {
  const url = thumbs.ready.get(p);
  if (!url || url === FAILED) return;
  const img = new Image();
  const place = () => {
    if (state.loading !== p || state.mode !== 'image' || !img.naturalWidth || !img.naturalHeight) return;
    const k = 8192 / Math.max(img.naturalWidth, img.naturalHeight);
    viewer.show({ path: p, kind: 'bitmap', source: img, placeholder: true, partial: false, full: null,
      width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
    loadingEl.classList.add('hidden');
  };
  img.onload = place;
  img.src = url;
  if (img.complete) place();
}

function shown(pic) {
  const fromPreview = !!(viewer.pic && viewer.pic.placeholder && viewer.pic.path === pic.path);
  if (viewer.pic && viewer.pic !== pic) decoder.release(viewer.pic);
  state.loading = '';
  state.pic = pic;
  loadingEl.classList.add('hidden');
  viewer.show(pic, { keepView: fromPreview });
  if (settings.get('showDetails')) details.show(pic.path, pic);
  prefetchNeighbours();
  updateStatus();
  toolbar.refresh();
}

const indexIn = (items, p) => items.findIndex((it) => it.path === p);

function prefetchNeighbours() {
  const items = shownItems();
  const i = indexIn(items, state.path);
  if (i < 0 || items.length < 2 || state.loading) return;
  decoder.prefetch([items[(i + 1) % items.length].path, items[(i - 1 + items.length) % items.length].path]);
}

// ---- moving through the folder ----------------------------------------------------------

/** The next (+1) or previous (-1) image shown, in name order, wrapping at the ends. */
function step(dir) {
  const items = shownItems();
  if (!items.length) return;
  let i = indexIn(items, state.path);
  if (i < 0) {
    // The image is not in the list (yet, or any more): go from where its name would be.
    const name = path.basename(state.path);
    const after = items.findIndex((it) => compareNames(it.name, name) > 0);
    i = dir > 0 ? (after < 0 ? items.length : after) - 1 : (after < 0 ? items.length : after);
  }
  goIndex((i + dir + items.length) % items.length);
}

function goIndex(i) {
  const it = shownItems()[i];
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
  const items = shownItems();
  const i = indexIn(items, p);
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

function chooseFile() {
  const picked = chooseImage(dialogFilter());
  if (picked) openPath(picked);
}

acceptDrops(ui.frame, openPath);

// ---- launch -------------------------------------------------------------------------------
// The window above is all the first frame needs. The disk is touched from here on.

layoutChrome();
updateStatus();

app.onLaunch(({ argv, cwd, first }) => {
  const target = argv.find((a) => !a.startsWith('--'));
  if (target) openPath(path.resolve(cwd || homeDir(), target));
  else if (first && settings.get('lastFolder')) openPath(settings.get('lastFolder'), { quiet: true, restore: true });
});

// For tests and the inspector.
app.expose({ state, viewer, folder, grid, strip, decoder, thumbs, details, presentation, burst, wildlife: wild,
  shownItems, openPath, openImage, openFolder });
