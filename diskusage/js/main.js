/**
 * Disk Usage: pick a folder, see what takes up its space, walk into the big
 * ones, open or trash what you find. The helm app kit's reference app: it
 * uses every part of /lib the way a new app should.
 */

import { startApp } from '/lib/app.js';
import { h, api } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, Breadcrumbs, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { confirmDialog, alertDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { Progress } from '/lib/controls.js';
import { formatBytes, formatCount, formatPercent } from '/lib/format.js';
import { userDirs, iconFor, openFile, openApp, isDirectory, homeDir, sep } from '/lib/files.js';
import { scanTree, ScanSignal, detach, findNode } from './scan.js';

const path = require('path');

const app = startApp({
  settings: {
    showHidden: { type: 'bool', default: false },
    lastRoot: { type: 'string', default: '' },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  root: null,          // the scanned tree
  rootPath: '',
  current: null,       // the folder node on screen
  history: [],         // folder paths to go back to
  scanning: null,      // ScanSignal of the scan in progress
  sort: { id: 'size', dir: -1 },
};

// ---- the window ---------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const crumbs = new Breadcrumbs({ onNavigate: (p) => show(p) });
const toolbar = new Toolbar(ui.toolbar, commands);

const sidebar = new Sidebar({ onSelect: (item) => openPath(item.id) });
ui.sidebar.appendChild(sidebar.el);

const summary = h('div.du-summary');
const progress = new Progress(null);
progress.el.classList.add('du-progress', 'hidden');
const statusText = h('span.grow');
ui.statusbar.append(statusText, progress.el);

const list = new VirtualList({
  layout: 'list',
  rowHeight: 40,
  key: (n) => n.path,
  label: (n) => n.name,
  sort: state.sort,
  columns: [
    { id: 'name', label: 'Name', flex: 3, sortable: true,
      cell: (n) => [icon(n.isDir ? 'folder' : iconFor(n)), h('span.ellipsis', n.name), n.error ? h('span.badge.danger', n.error) : null] },
    { id: 'share', label: 'Share', flex: 2,
      cell: (n) => {
        const total = state.current && state.current.size > 0 ? state.current.size : 1;
        return h('div.du-bar', h('div.du-bar-fill', { style: { width: `${Math.max(0.5, (n.size / total) * 100).toFixed(1)}%` } }));
      } },
    { id: 'size', label: 'Size', width: 96, align: 'right', sortable: true, cell: (n) => formatBytes(n.size) },
    { id: 'files', label: 'Files', width: 90, align: 'right', sortable: true,
      cell: (n) => (n.isDir ? formatCount(n.files, 'file') : '') },
  ],
  render: null,
  onSort: (id, dir) => { state.sort = { id, dir }; renderFolder(); },
  onActivate: (items) => activate(items[0]),
  onContextMenu: (e, items) => contextMenu(e, items),
  onSelectionChange: () => { toolbar.refresh(); updateStatus(); },
  empty: emptyState({ icon: 'folder', title: 'Nothing here', hint: 'This folder is empty, or everything in it is hidden.' }),
});

const startEmpty = emptyState({
  icon: 'pie-chart',
  title: 'Choose a folder to look at',
  hint: 'Disk Usage totals every folder inside it, so the big ones stand out.',
  action: { label: 'Choose Folder…', run: () => commands.run('open-folder') },
});

ui.content.append(summary, list.el, startEmpty);
summary.classList.add('hidden');
list.el.classList.add('hidden');

// ---- commands -------------------------------------------------------------------

const selected = () => list.selectedItems();
const vfs = api('vfs');

commands.addAll([
  { id: 'back', label: 'Back', icon: 'arrow-left', keys: ['Alt+ArrowLeft', 'Backspace'],
    enabled: () => state.history.length > 0, run: () => show(state.history.pop(), { push: false }) },
  { id: 'up', label: 'Enclosing Folder', icon: 'arrow-up', keys: ['Alt+ArrowUp'],
    enabled: () => !!(state.current && state.current.parent), run: () => show(state.current.parent.path) },
  { id: 'rescan', label: 'Scan Again', icon: 'refresh', keys: ['F5', 'Mod+R'],
    enabled: () => !!state.rootPath, run: () => openPath(state.current ? state.current.path : state.rootPath) },
  { id: 'open-folder', label: 'Choose Folder…', icon: 'folder-open', keys: ['Mod+O'], run: chooseFolder },
  { id: 'toggle-hidden', label: 'Count Hidden Files', icon: 'eye', keys: ['Mod+H'],
    checked: () => settings.get('showHidden'),
    run: () => { settings.set('showHidden', !settings.get('showHidden')); if (state.rootPath) openPath(state.rootPath); } },
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
toolbar.button('rescan');
toolbar.button('open-folder');

// ---- places -----------------------------------------------------------------------

function buildSidebar() {
  const d = userDirs();
  const places = [
    { id: d.home, label: 'Home', icon: 'home' },
    { id: d.documents, label: 'Documents', icon: 'file-text' },
    { id: d.downloads, label: 'Downloads', icon: 'download' },
    { id: d.pictures, label: 'Pictures', icon: 'image' },
    { id: d.music, label: 'Music', icon: 'music' },
    { id: d.videos, label: 'Videos', icon: 'video' },
  ].filter((p) => isDirectory(p.id));
  const sections = [{ title: 'Places', items: places }];
  const volumes = vfs && typeof vfs.listVolumes === 'function' ? (attemptVolumes() || []) : [];
  if (volumes.length) {
    sections.push({
      title: 'Drives',
      items: volumes.map((v) => ({
        id: v.mountPoint,
        label: v.label || v.mountPoint,
        icon: 'hard-drive',
        title: v.totalBytes ? `${formatBytes(v.availableBytes)} free of ${formatBytes(v.totalBytes)}` : v.mountPoint,
      })),
    });
  }
  sidebar.setSections(sections);
}

function attemptVolumes() {
  try {
    return vfs.listVolumes().filter((v) => v.mountPoint && isDirectory(v.mountPoint) &&
      !/^\/(proc|sys|dev|run|snap)(\/|$)/.test(v.mountPoint));
  } catch (err) {
    console.warn(`listVolumes: ${err.message}`);
    return [];
  }
}

// ---- scanning and navigation ------------------------------------------------------

/** Scan a folder and show it. */
async function openPath(p) {
  if (!p) return;
  p = path.resolve(p);
  if (!isDirectory(p)) {
    toast(`Not a folder: ${p}`, { error: true });
    return;
  }
  if (state.scanning) state.scanning.cancel();
  const signal = new ScanSignal();
  state.scanning = signal;
  settings.set('lastRoot', p);
  sidebar.select(p);
  startEmpty.classList.add('hidden');
  progress.el.classList.remove('hidden');
  statusText.textContent = `Scanning ${p}…`;
  app.setTitle(path.basename(p) || p);
  const tree = await scanTree(p, {
    showHidden: settings.get('showHidden'),
    signal,
    onProgress: ({ files, bytes }) => {
      if (state.scanning === signal) statusText.textContent = `Scanning… ${formatCount(files, 'file')}, ${formatBytes(bytes)}`;
    },
  });
  if (!tree || state.scanning !== signal) return;   // a newer scan took over
  state.scanning = null;
  progress.el.classList.add('hidden');
  state.root = tree;
  state.rootPath = p;
  state.history = [];
  state.current = null;
  show(p, { push: false });
}

/** Show a folder of the scanned tree. */
function show(p, { push = true } = {}) {
  const node = findNode(state.root, p);
  if (!node || !node.isDir) return;
  if (push && state.current && state.current !== node) state.history.push(state.current.path);
  state.current = node;
  renderFolder();
  list.clearSelection();
  list.focus();
  app.setTitle(node.name);
  toolbar.refresh();
}

function sorted(children) {
  const { id, dir } = state.sort;
  const key = id === 'name' ? (n) => n.name.toLowerCase() : id === 'files' ? (n) => n.files : (n) => n.size;
  return children.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return a.name.localeCompare(b.name);
  });
}

function renderFolder() {
  const node = state.current;
  if (!node) return;
  summary.classList.remove('hidden');
  list.el.classList.remove('hidden');
  // Breadcrumbs from the scan root down to here.
  const chain = [];
  for (let n = node; n; n = n.parent) chain.unshift(n);
  crumbs.set(chain.map((n) => ({ label: n === state.root ? (n.path === homeDir() ? 'Home' : n.name || n.path) : n.name, value: n.path })));
  summary.replaceChildren(
    h('div.du-total.num', formatBytes(node.size)),
    h('div.du-meta',
      h('div.title', node.path === homeDir() ? 'Home' : node.name),
      h('div.dim', `${formatCount(node.files, 'file')} in ${formatCount(node.dirs, 'folder')}`)));
  list.setSort(state.sort);
  list.setItems(sorted(node.children));
  updateStatus();
}

function updateStatus() {
  if (state.scanning || !state.current) return;
  const sel = selected();
  if (sel.length) {
    const bytes = sel.reduce((s, n) => s + n.size, 0);
    const share = state.current.size ? bytes / state.current.size : 0;
    statusText.textContent = `${formatCount(sel.length, 'item')} selected, ${formatBytes(bytes)} (${formatPercent(share)} of this folder)`;
  } else {
    statusText.textContent = `${state.current.path}: ${formatBytes(state.current.size)}`;
  }
}

// ---- actions --------------------------------------------------------------------------

function activate(node) {
  if (!node) return;
  if (node.isDir) show(node.path);
  else openFile(node.path).then((ok) => { if (!ok) toast(`No app opens ${node.name}`, { error: true }); });
}

async function chooseFolder() {
  const picked = typeof showOpenFolderDialog === 'function' ? showOpenFolderDialog(state.rootPath || homeDir(), false) : [];
  if (picked && picked.length) openPath(picked[0]);
}

async function showInFiles(node) {
  const target = node.isDir ? node.path : path.dirname(node.path);
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
  const bytes = items.reduce((s, n) => s + n.size, 0);
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
      trashed.push({ node: n, id: t && t.id });
      detach(n);
    } catch (err) {
      await alertDialog({ title: `Could not move “${n.name}” to the Trash`, body: err.message, icon: 'alert' });
      break;
    }
  }
  renderFolder();
  if (trashed.length) {
    toast(`Moved ${formatCount(trashed.length, 'item')} to the Trash`, {
      icon: 'trash',
      action: 'Undo',
      onAction: async () => {
        for (const t of trashed) if (t.id) await vfs.restoreTrash(t.id);
        openPath(state.current ? state.current.path : state.rootPath);
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
    items.length === 1 ? commands.item('open', { label: items[0].isDir ? 'Open Folder' : 'Open' }) : null,
    commands.item('show-in-files'),
    commands.item('copy-path'),
    { separator: true },
    commands.item('trash'),
  ], e.clientX, e.clientY);
}

// ---- launch -------------------------------------------------------------------------------

buildSidebar();

app.onLaunch(({ argv, cwd, first }) => {
  if (argv.includes('--new-window') && !first) { app.newWindow(); return; }
  const target = argv.find((a) => !a.startsWith('--'));
  if (target) openPath(path.resolve(cwd || '.', target));
  else if (first && settings.get('lastRoot') && isDirectory(settings.get('lastRoot'))) openPath(settings.get('lastRoot'));
});

// For tests and the inspector.
app.expose({ state, list, openPath, show, sidebar, sep });
