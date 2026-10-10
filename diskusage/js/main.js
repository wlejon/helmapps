/**
 * Disk Usage: pick a folder, see what takes up its space, walk into the big
 * ones, open or trash what you find. The helm app kit's reference app: it
 * uses every part of /lib the way a new app should, and it shows how an app
 * stays responsive with a job as big as totalling a whole drive.
 *
 * How it stays responsive (docs/performance.md says why each one matters):
 *  - Nothing waits on the disk before the first frame. The window is built
 *    from the kit and painted; places and drives fill in when their async
 *    answers come back.
 *  - The scan is native: bro.vfs.usage walks the tree on its own threads.
 *    The page never sees the millions of files, only the folder on screen,
 *    read with one call (scan.children) capped at MAX_ROWS.
 *  - Results show while the scan runs. A requestAnimationFrame loop polls
 *    scan.progress() and redraws the list only when the scan's version has
 *    changed and REFRESH_MS has passed, so a redraw never lands every frame.
 *  - A new scan cancels the old one; leaving a folder costs nothing.
 */

import { startApp } from '/lib/app.js';
import { h, api } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, Breadcrumbs, emptyState, meter } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { confirmDialog, alertDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { Progress } from '/lib/controls.js';
import { formatBytes, formatCount, formatNumber, formatPercent } from '/lib/format.js';
import { userDirs, iconFor, openFile, openApp, homeDir } from '/lib/files.js';

const fs = require('fs');
const path = require('path');

/** Most rows one folder shows: the biggest MAX_ROWS of it. */
const MAX_ROWS = 5000;
/** Least time between two redraws of the list while a scan runs. */
const REFRESH_MS = 250;

const app = startApp({
  settings: {
    showHidden: { type: 'bool', default: false },
    lastRoot: { type: 'string', default: '' },
  },
});
const { commands, settings } = app;
const vfs = api('vfs');

// ---- state ------------------------------------------------------------------

const state = {
  scan: null,          // the bro.vfs.usage scan of rootPath
  rootPath: '',
  currentPath: '',     // the folder on screen
  current: null,       // the scan's record of it ({ bytes, files, directories, complete, ... })
  history: [],         // folder paths to go back to
  sort: { id: 'size', dir: -1 },
  shownVersion: -1,    // the scan version the list last drew
  lastDraw: 0,
  volumes: [],         // bro.vfs.volumes(), once it answers
  scanDone: null,      // { ms, errors, cancelled } once the scan has ended
  maxRows: MAX_ROWS,
};

// ---- the window ---------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const crumbs = new Breadcrumbs({ onNavigate: (p) => show(p) });
const toolbar = new Toolbar(ui.toolbar, commands);

const sidebar = new Sidebar({ onSelect: (item) => openPath(item.id) });
ui.sidebar.appendChild(sidebar.el);

// The head of the content: the folder's name and counts, its total, and (for
// a drive) how full the drive is; a progress line while the scan runs.
const summary = h('div.du-summary');
const progress = new Progress(null);
progress.el.classList.add('du-progress', 'hidden');
const statusText = h('span.grow');
ui.statusbar.append(statusText);

// A folder still being counted: a live dot, and its size so far (if any).
const sizeCell = (n) => (n.complete ? formatBytes(n.bytes)
  : [h('span.du-live', { title: 'Still counting' }), h('span.du-partial', n.bytes ? formatBytes(n.bytes) : '')]);
const shareText = (s) => (s >= 10 ? `${Math.round(s)}%` : s >= 0.1 ? `${s.toFixed(1)}%` : s > 0 ? '<0.1%' : '');

const list = new VirtualList({
  layout: 'list',
  rowHeight: 34,
  key: (n) => n.path,
  label: (n) => n.name,
  sort: state.sort,
  rowClass: (n) => (n.bytes === 0 ? 'du-zero' : n.isDirectory ? '' : 'du-file'),
  columns: [
    { id: 'name', label: 'Name', flex: 3, sortable: true,
      cell: (n) => [icon(n.isDirectory ? 'folder' : iconFor(n)), h('span.ellipsis', n.name)] },
    { id: 'share', label: 'Share', flex: 2,
      cell: (n) => [
        h('div.du-bar', h('div.du-bar-fill', { style: { width: `${Math.max(0.4, n.share)}%` } })),
        h('span.du-pct', shareText(n.share))] },
    { id: 'size', label: 'Size', width: 92, align: 'right', sortable: true, cell: sizeCell },
    { id: 'files', label: 'Files', width: 92, align: 'right', sortable: true,
      cell: (n) => (n.isDirectory && (n.complete || n.files) ? formatNumber(n.files) : '') },
  ],
  render: null,
  onSort: (id, dir) => { state.sort = { id, dir }; drawFolder(); },
  onActivate: (items) => activate(items[0]),
  onContextMenu: (e, items) => contextMenu(e, items),
  onSelectionChange: () => { toolbar.refresh(); updateStatus(); },
  empty: emptyState({ icon: 'folder', title: 'Nothing here', hint: 'This folder is empty, or everything in it is hidden.' }),
});

// Before anything is scanned: the drives as cards (filled in when
// bro.vfs.volumes() answers), and any other folder by choosing it.
const driveCards = h('div.du-drives');
const startEmpty = h('div.du-home',
  h('div.du-home-head',
    h('div.head', 'See what takes up space'),
    h('div.dim', 'Pick a drive to total every folder on it, biggest first, or choose any folder.')),
  driveCards,
  h('div', h('button.btn.du-choose', { onclick: () => commands.run('open-folder') }, icon('folder-open'), 'Choose Folder…')));

const notYet = emptyState({
  icon: 'clock',
  title: 'Not counted yet',
  hint: 'The scan has not reached this folder; it shows as soon as it does.',
});

ui.content.append(summary, list.el, startEmpty, notYet);
summary.classList.add('hidden');
list.el.classList.add('hidden');
notYet.classList.add('hidden');

// ---- commands -------------------------------------------------------------------

const selected = () => list.selectedItems();
const scanning = () => {
  const p = state.scan && state.scan.progress();
  return !!p && !p.finished && !p.cancelled;
};

commands.addAll([
  { id: 'back', label: 'Back', icon: 'arrow-left', keys: ['Alt+ArrowLeft', 'Backspace'],
    enabled: () => state.history.length > 0, run: () => show(state.history.pop(), { push: false }) },
  { id: 'up', label: 'Enclosing Folder', icon: 'arrow-up', keys: ['Alt+ArrowUp'],
    enabled: () => !!state.currentPath && state.currentPath !== state.rootPath,
    run: () => show(path.dirname(state.currentPath)) },
  { id: 'rescan', label: 'Scan Again', icon: 'refresh', keys: ['F5', 'Mod+R'],
    enabled: () => !!state.rootPath, run: () => openPath(state.rootPath, { at: state.currentPath }) },
  { id: 'stop', label: 'Stop Scanning', icon: 'stop', keys: ['Escape'],
    enabled: () => scanning(), run: () => state.scan.cancel() },
  { id: 'open-folder', label: 'Choose Folder…', icon: 'folder-open', keys: ['Mod+O'], run: chooseFolder },
  { id: 'toggle-hidden', label: 'Count Hidden Files', icon: 'eye', keys: ['Mod+H'],
    checked: () => settings.get('showHidden'),
    run: () => {
      settings.set('showHidden', !settings.get('showHidden'));
      if (state.rootPath) openPath(state.rootPath, { at: state.currentPath });
    } },
  { id: 'open', label: 'Open', icon: 'external-link', enabled: () => selected().length === 1,
    run: () => activate(selected()[0]) },
  { id: 'show-in-files', label: 'Show in Files', icon: 'folder', enabled: () => selected().length === 1 && !!api('apps'),
    run: () => showInFiles(selected()[0]) },
  { id: 'copy-path', label: 'Copy Path', icon: 'copy', keys: ['Mod+Shift+C'], enabled: () => selected().length > 0,
    run: copyPaths },
  { id: 'trash', label: 'Move to Trash', icon: 'trash', keys: ['Delete'], danger: true,
    enabled: () => !!vfs && selected().length > 0, run: trashSelected },
  { id: 'new-window', label: 'New Window', keys: ['Mod+N'], run: () => app.newWindow() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

toolbar.button('back');
toolbar.button('up');
toolbar.sep();
toolbar.add(crumbs.el);
toolbar.spacer();
toolbar.button('toggle-hidden');
const stopButton = toolbar.button('stop');
toolbar.button('rescan');
toolbar.button('open-folder');

/** Toolbar state, and Stop shown only while there is something to stop. */
function refreshChrome() {
  toolbar.refresh();
  stopButton.classList.toggle('hidden', !scanning());
}
refreshChrome();

// ---- places and drives --------------------------------------------------------------
// Both come from async calls: a drive asked for its size can take seconds to
// answer (a sleeping disk, a network share that has gone away), and the window
// is already on screen while they do.

const sidebarSections = { places: [], drives: [] };

function drawSidebar() {
  const sections = [{ title: 'Places', items: sidebarSections.places }];
  if (sidebarSections.drives.length) sections.push({ title: 'Drives', items: sidebarSections.drives });
  sidebar.setSections(sections);
  if (state.rootPath) sidebar.select(state.rootPath);
}

async function fillPlaces() {
  const d = userDirs();
  const places = [
    { id: d.home, label: 'Home', icon: 'home' },
    { id: d.documents, label: 'Documents', icon: 'file-text' },
    { id: d.downloads, label: 'Downloads', icon: 'download' },
    { id: d.pictures, label: 'Pictures', icon: 'image' },
    { id: d.music, label: 'Music', icon: 'music' },
    { id: d.videos, label: 'Videos', icon: 'video' },
  ];
  const there = await Promise.all(places.map((p) => isDirectoryAsync(p.id)));
  sidebarSections.places = places.filter((_, i) => there[i]);
  drawSidebar();
}

async function fillDrives() {
  if (!vfs || typeof vfs.volumes !== 'function') return;
  let volumes = [];
  try {
    volumes = await vfs.volumes();
  } catch (err) {
    console.warn(`volumes: ${err.message}`);
    return;
  }
  state.volumes = volumes.filter((v) => v.mountPoint && v.totalBytes > 0 &&
    !/^\/(proc|sys|dev|run|snap)(\/|$)/.test(v.mountPoint));
  sidebarSections.drives = state.volumes.map((v) => ({
    id: v.mountPoint,
    label: v.volumeLabel ? `${v.volumeLabel} (${v.mountPoint.replace(/[\\/]$/, '')})` : v.mountPoint,
    icon: 'hard-drive',
    sub: `${formatBytes(v.availableBytes)} free of ${formatBytes(v.totalBytes)}`,
    meter: 1 - v.availableBytes / v.totalBytes,
  }));
  drawSidebar();
  driveCards.replaceChildren(...state.volumes.map((v, i) => {
    const used = 1 - v.availableBytes / v.totalBytes;
    return h('button.du-drive', { onclick: () => openPath(v.mountPoint) },
      h('div.du-drive-top',
        icon('hard-drive', 'lg'),
        h('div.du-drive-name', h('div.title.ellipsis', sidebarSections.drives[i].label),
          h('div.dim.num', `${formatBytes(v.totalBytes)} ${v.fsType || ''}`.trim()))),
      meter(used),
      h('div.du-drive-free.num', h('span', `${formatBytes(v.availableBytes)} free`), h('span.dim', formatPercent(used) + ' used')));
  }));
}

async function isDirectoryAsync(p) {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch (_) {
    return false;
  }
}

/** The volume a scan root is the top of, for a real progress fraction. */
function volumeOf(p) {
  const norm = (s) => s.replace(/[\\/]+$/, '').toLowerCase();
  return state.volumes.find((v) => norm(v.mountPoint) === norm(p)) || null;
}

// ---- scanning ------------------------------------------------------------------------

/** Scan a folder and show it (or `at`, a folder inside it, once the scan reaches it). */
async function openPath(p, { at = '', quiet = false } = {}) {
  if (!p) return;
  p = path.resolve(p);
  if (!(await isDirectoryAsync(p))) {
    if (!quiet) toast(`Not a folder: ${p}`, { error: true });
    return;
  }
  if (state.scan) state.scan.cancel();
  if (!vfs || typeof vfs.usage !== 'function') {
    toast('This build of bro has no bro.vfs; Disk Usage needs it', { error: true });
    return;
  }
  const scan = vfs.usage(p, { includeHidden: settings.get('showHidden') });
  state.scan = scan;
  state.rootPath = p;
  state.currentPath = at && at.startsWith(p) ? at : p;
  state.history = [];
  state.shownVersion = -1;
  state.scanDone = null;
  settings.set('lastRoot', p);
  sidebar.select(p);
  startEmpty.classList.add('hidden');
  progress.el.classList.remove('hidden');
  drawFolder();
  refreshChrome();
  requestAnimationFrame(() => pump(scan));
}

/** Once a frame while `scan` runs: progress every frame, the list when it is due. */
function pump(scan) {
  if (scan !== state.scan) return;                 // a newer scan took over
  const p = scan.progress();
  const done = p.finished || p.cancelled;
  const now = performance.now();
  if (p.version !== state.shownVersion && (done || now - state.lastDraw >= REFRESH_MS)) drawFolder();
  showProgress(p);
  if (done) {
    progress.el.classList.add('hidden');
    refreshChrome();
    state.scanDone = { ms: p.elapsedMs, errors: p.errors, cancelled: p.cancelled };
    updateStatus();
    return;
  }
  requestAnimationFrame(() => pump(scan));
}

function showProgress(p) {
  const vol = volumeOf(state.rootPath);
  const used = vol ? vol.totalBytes - vol.freeBytes : 0;
  progress.set(used > 0 ? Math.min(1, p.bytes / used) : null);
  if (!p.finished && !p.cancelled) {
    statusText.textContent = `Scanning… ${formatCount(p.files, 'file')}, ${formatBytes(p.bytes)}` +
      (used > 0 ? ` of ${formatBytes(used)}` : '');
  }
}

// ---- the folder on screen --------------------------------------------------------------

/** Show a folder of the scan (it need not be counted yet). */
function show(p, { push = true } = {}) {
  if (!state.scan || !p) return;
  if (push && state.currentPath && state.currentPath !== p) state.history.push(state.currentPath);
  state.currentPath = p;
  drawFolder();
  list.clearSelection();
  list.focus();
  refreshChrome();
}

function sortRows(rows) {
  const { id, dir } = state.sort;
  const key = id === 'name' ? (n) => n.name.toLowerCase() : id === 'files' ? (n) => n.files : (n) => n.bytes;
  return rows.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return a.name.localeCompare(b.name);
  });
}

function drawFolder() {
  const scan = state.scan;
  if (!scan) return;
  state.shownVersion = scan.progress().version;
  state.lastDraw = performance.now();
  const p = state.currentPath;
  drawCrumbs(p);
  const name = p === state.rootPath ? displayName(p) : path.basename(p);
  app.setTitle(name);
  const item = scan.entry(p);
  state.current = item;
  if (!item) {
    summary.classList.add('hidden');
    list.el.classList.add('hidden');
    notYet.classList.remove('hidden');
    return;
  }
  notYet.classList.add('hidden');
  summary.classList.remove('hidden');
  list.el.classList.remove('hidden');
  drawSummary(name, item);
  // The native side sorts and cuts to MAX_ROWS; the page sorts only what it shows.
  const rows = scan.children(p, { sort: state.sort.id === 'name' ? 'name' : 'bytes', limit: state.maxRows }) || [];
  // A row shows only its own fields (lib/list.js), so its share of the folder
  // rides on it; rounded to the 0.1% a bar can show, a row whose share has
  // not visibly moved is not redrawn.
  for (const r of rows) r.share = item.bytes > 0 ? Math.round((r.bytes / item.bytes) * 1000) / 10 : 0;
  if (list.sort !== state.sort) list.setSort(state.sort);
  list.setItems(sortRows(rows));
  updateStatus();
}

/**
 * The folder's name and counts on the left, its total on the right; under
 * them, for a drive, how full it is, and while the scan runs, its progress.
 */
function drawSummary(name, item) {
  const counts = `${formatCount(item.files, 'file')} in ${formatCount(item.directories, 'folder')}`;
  const vol = volumeOf(state.currentPath);
  summary.replaceChildren(...[
    h('div.du-summary-row',
      h('div.du-meta',
        h('div.head.ellipsis', name),
        h('div.dim.num', item.complete ? counts : `${counts}, still counting…`)),
      h('div.du-total.num', formatBytes(item.bytes))),
    vol ? capacityBar(vol, item) : progress.el,
  ]);
}

/**
 * A drive's capacity as one bar: the track is the whole drive, the grey fill
 * what the drive says is used, and the accent fill what the scan has counted
 * so far, so a scan visibly fills the drive's used space as it goes.
 */
function capacityBar(vol, item) {
  const used = vol.totalBytes - vol.freeBytes;
  const pct = (n) => `${Math.min(100, (n / vol.totalBytes) * 100).toFixed(2)}%`;
  const counting = !item.complete;
  return h('div.du-volume',
    h('div.du-cap',
      h('div.du-cap-used', { style: { width: pct(used) } }),
      h('div.du-cap-counted', { style: { width: pct(item.bytes) } })),
    h('div.du-volume-text.num',
      h('span', counting
        ? `${formatBytes(item.bytes)} counted of ${formatBytes(used)} used`
        : `${formatBytes(used)} used of ${formatBytes(vol.totalBytes)}`),
      h('span.dim', `${formatBytes(vol.availableBytes)} free`)));
}

let crumbsFor = '';
function drawCrumbs(p) {
  if (crumbsFor === state.rootPath + '\n' + p) return;
  crumbsFor = state.rootPath + '\n' + p;
  const chain = [{ label: displayName(state.rootPath), value: state.rootPath }];
  const rel = path.relative(state.rootPath, p);
  if (rel && !rel.startsWith('..')) {
    let at = state.rootPath;
    for (const part of rel.split(/[\\/]/)) {
      at = path.join(at, part);
      chain.push({ label: part, value: at });
    }
  }
  crumbs.set(chain);
}

function displayName(p) {
  return p === homeDir() ? 'Home' : path.basename(p) || p;
}

function updateStatus() {
  if (!state.current) return;
  if (scanning()) return;                          // the scan's progress owns the status bar
  const sel = selected();
  const shown = list.items.length;
  if (sel.length) {
    const bytes = sel.reduce((s, n) => s + n.bytes, 0);
    const share = state.current.bytes ? bytes / state.current.bytes : 0;
    statusText.textContent = `${formatCount(sel.length, 'item')} selected, ${formatBytes(bytes)} (${formatPercent(share)} of this folder)`;
  } else if (state.current.children > shown) {
    statusText.textContent = `Showing the largest ${formatNumber(shown)} of ${formatCount(state.current.children, 'item')}`;
  } else if (state.scanDone) {
    const d = state.scanDone;
    const root = state.scan.entry(state.rootPath);
    statusText.textContent = (d.cancelled ? 'Stopped after ' : 'Counted ') +
      `${formatCount(root ? root.files : 0, 'file')} in ${d.ms < 1000 ? `${Math.round(d.ms)} ms` : `${(d.ms / 1000).toFixed(1)} s`}` +
      (d.errors ? `; ${formatCount(d.errors, 'folder')} could not be read` : '');
  } else {
    statusText.textContent = '';
  }
}

// ---- actions --------------------------------------------------------------------------

function activate(node) {
  if (!node) return;
  if (node.isDirectory) show(node.path);
  else openFile(node.path).then((ok) => { if (!ok) toast(`No app opens ${node.name}`, { error: true }); });
}

async function chooseFolder() {
  const picked = typeof showOpenFolderDialog === 'function' ? showOpenFolderDialog(state.rootPath || homeDir(), false) : [];
  if (picked && picked.length) openPath(picked[0]);
}

async function showInFiles(node) {
  const target = node.isDirectory ? node.path : path.dirname(node.path);
  if (!(await openApp('helm.files', [target]))) toast('The Files app is not installed', { error: true });
}

async function copyPaths() {
  const text = selected().map((n) => n.path).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(selected().length === 1 ? 'Copied the path' : `Copied ${selected().length} paths`, { icon: 'copy' });
  } catch (err) {
    toast(`Could not copy: ${err.message}`, { error: true });
  }
}

async function trashSelected() {
  const items = selected();
  if (!items.length || !vfs) return;
  const what = items.length === 1 ? `“${items[0].name}”` : formatCount(items.length, 'item');
  const bytes = items.reduce((s, n) => s + n.bytes, 0);
  const ok = await confirmDialog({
    title: `Move ${what} to the Trash?`,
    body: `This frees ${formatBytes(bytes)}. You can restore it from the Trash.`,
    ok: 'Move to Trash',
    danger: true,
  });
  if (!ok) return;
  const trashed = [];
  for (const n of items) {
    try {
      const t = await vfs.trash(n.path);
      trashed.push(t && t.id);
      state.scan.remove(n.path);                   // its bytes come off every folder above it
    } catch (err) {
      await alertDialog({ title: `Could not move “${n.name}” to the Trash`, body: err.message, icon: 'alert' });
      break;
    }
  }
  drawFolder();
  if (trashed.length) {
    toast(`Moved ${formatCount(trashed.length, 'item')} to the Trash`, {
      icon: 'trash',
      action: 'Undo',
      onAction: async () => {
        for (const id of trashed) if (id) await vfs.restoreTrash(id);
        openPath(state.rootPath, { at: state.currentPath });
      },
    });
  }
}

function contextMenu(e, items) {
  if (!items.length) {
    menu.show([commands.item('rescan'), commands.item('toggle-hidden')], e.clientX, e.clientY);
    return;
  }
  menu.show([
    { heading: items.length === 1 ? items[0].name : formatCount(items.length, 'item') },
    items.length === 1 ? commands.item('open', { label: items[0].isDirectory ? 'Open Folder' : 'Open' }) : null,
    commands.item('show-in-files'),
    commands.item('copy-path'),
    { separator: true },
    commands.item('trash'),
  ], e.clientX, e.clientY);
}

// ---- launch -------------------------------------------------------------------------------
// The window above is all the first frame needs. Everything that touches the
// disk starts here and answers later.

fillPlaces();
fillDrives();

app.onLaunch(({ argv, cwd, first }) => {
  if (argv.includes('--new-window') && !first) { app.newWindow(); return; }
  const target = argv.find((a) => !a.startsWith('--'));
  if (target) openPath(path.resolve(cwd || '.', target));
  else if (first && settings.get('lastRoot')) openPath(settings.get('lastRoot'), { quiet: true });
});

// For tests and the inspector.
app.expose({ state, list, openPath, show, sidebar });
