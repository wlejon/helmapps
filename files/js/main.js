/**
 * Files (helm.files): browse folders in icon grid or detailed list view,
 * preview thumbnails, watch for live updates, search recursively, and copy,
 * move, rename, or trash files with undo.
 *
 * Follows docs/performance.md:
 *  - Builds and paints the window synchronously before touching disk or volumes.
 *  - Uses async bro.vfs / fs.promises calls off the UI thread.
 */

import { startApp } from '/lib/app.js';
import { h, api, isTyping } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar } from '/lib/layout.js';
import { menu } from '/lib/menu.js';
import { Dialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { formatBytes, formatCount } from '/lib/format.js';
import { homeDir, openFile, appsFor, appsReady, mimeOf } from '/lib/files.js';

import { DirectoryModel, TRASH_URI, normalizePath } from './model.js';
import { LocationBar } from './breadcrumbs.js';
import { FilesSidebar } from './sidebar.js';
import { FilesView } from './views.js';
import { TransferManager } from './transfer.js';
import { TrashManager } from './trash.js';
import { Inspector } from './inspector.js';
import { SearchController } from './search.js';

const fs = require('fs');
const path = require('path');

const app = startApp({
  settings: {
    view: { type: 'string', default: 'grid' },
    iconSize: { type: 'int', default: 96 },
    showHidden: { type: 'bool', default: false },
    sortByFolder: { type: 'json', default: {} },
    bookmarks: { type: 'json', default: [] },
    lastFolder: { type: 'string', default: '' },
    columns: { type: 'json', default: {} },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  currentPath: '',
  backStack: [],
  forwardStack: [],
  sort: { id: 'name', dir: 1 },
  view: settings.get('view') === 'list' ? 'list' : 'grid',
  filterQuery: '',
  searchRecursive: false,
  searching: false,
  loading: false,
  done: false,
  clipboard: null,        // { mode: 'copy'|'cut', paths: [] }
  volumes: [],
  TrashCount: 0,
  disableVfs: false,      // test hook to simulate missing bro.vfs
  customVfs: null,        // optional injected vfs mock
};

// ---- the window -------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const vfsBanner = h('div.files-banner.hidden',
  icon('info'),
  h('span.files-banner-title', 'Read-only browsing'),
  h('span.files-banner-sub.grow', 'bro.vfs is unavailable; file operations and live watching are disabled.'),
);

const trash = new TrashManager({
  state,
  onChanged: () => model.reload({ preserveSelection: true }),
});

const model = new DirectoryModel({
  state,
  settings,
  trash,
  onChange: (opts) => onModelChanged(opts || {}),
  onError: (msg) => toast(msg, { error: true }),
});

const transfer = new TransferManager({
  state,
  model,
  trash,
  onStatusUpdate: () => {
    views.list.refreshClasses();
    refreshChrome();
    updateStatus();
  },
});

const locationBar = new LocationBar({
  onNavigate: (target) => openPath(target),
});

const sidebar = new FilesSidebar({
  state,
  settings,
  onSelect: (target) => openPath(target),
  onDropItems: (srcPaths, destDir, opts) => transfer.transferPaths(srcPaths, destDir, opts),
});
ui.sidebar.appendChild(sidebar.el);

const views = new FilesView({
  state,
  settings,
  onSort: (id, dir) => model.saveFolderSort(id, dir),
  onActivate: (item) => activateItem(item),
  onContextMenu: (e, items) => showContextMenu(e, items),
  onSelectionChange: () => {
    refreshChrome();
    updateStatus();
  },
  onViewChange: () => {
    refreshChrome();
  },
  onDropItems: (srcPaths, destDir, opts) => transfer.transferPaths(srcPaths, destDir, opts),
  onBookmarkFolder: (folderPath, label) => sidebar.toggleBookmark(folderPath, label),
});

trash.getSelected = () => views.list.selectedItems();

const inspector = new Inspector({
  state,
  thumbs: views.thumbs,
});

const search = new SearchController({
  state,
  settings,
  model,
  onUpdate: () => {
    views.list.setItems(model.entries);
    refreshChrome();
    updateStatus();
  },
  onFocusList: () => views.list.scroller.focus(),
});

ui.content.append(vfsBanner, trash.bannerEl, search.bannerEl, views.el);

const statusLeft = h('span.grow.num');
const statusRight = h('span.dim.num');
ui.statusbar.append(statusLeft, transfer.progressWrap, statusRight);

// ---- commands & shortcuts ---------------------------------------------------

const selected = () => views.list.selectedItems();
const inTrash = () => state.currentPath === TRASH_URI;
const hasVfs = () => transfer.hasVfs();

commands.addAll([
  { id: 'back', label: 'Back', icon: 'arrow-left', keys: ['Alt+ArrowLeft'],
    enabled: () => model.canBack(), run: () => model.back() },
  { id: 'forward', label: 'Forward', icon: 'arrow-right', keys: ['Alt+ArrowRight'],
    enabled: () => model.canForward(), run: () => model.forward() },
  { id: 'up', label: 'Enclosing Folder', icon: 'arrow-up', keys: ['Alt+ArrowUp'],
    enabled: () => model.canUp(), run: () => model.up() },
  { id: 'focus-location', label: 'Enter Location…', icon: 'edit', keys: ['Mod+L'],
    inText: true, run: () => locationBar.startEdit() },
  { id: 'search', label: 'Search…', icon: 'search', keys: ['Mod+F'],
    inText: true, run: () => search.focus() },
  { id: 'toggle-hidden', label: 'Show Hidden Files', icon: 'eye', keys: ['Mod+H'],
    checked: () => settings.get('showHidden'),
    run: () => {
      settings.set('showHidden', !settings.get('showHidden'));
      model.applyFilterAndSort();
      onModelChanged({ preserveSelection: true });
    } },
  { id: 'view-grid', label: 'Grid View', icon: 'grid', keys: ['Mod+1'],
    checked: () => state.view === 'grid',
    run: () => views.setViewMode('grid') },
  { id: 'view-list', label: 'List View', icon: 'list', keys: ['Mod+2'],
    checked: () => state.view === 'list',
    run: () => views.setViewMode('list') },
  { id: 'new-folder', label: 'New Folder…', icon: 'folder-plus', keys: ['Mod+Shift+N'],
    enabled: () => hasVfs() && !inTrash() && !!state.currentPath,
    run: () => transfer.newFolder() },
  { id: 'rename', label: 'Rename…', icon: 'edit', keys: ['F2'],
    enabled: () => hasVfs() && !inTrash() && selected().length === 1,
    run: () => transfer.renameItem(selected()[0]) },
  { id: 'copy', label: 'Copy', icon: 'copy', keys: ['Mod+C'],
    enabled: () => !inTrash() && selected().length > 0,
    run: () => transfer.setClipboard('copy', selected()) },
  { id: 'cut', label: 'Cut', icon: 'cut', keys: ['Mod+X'],
    enabled: () => hasVfs() && !inTrash() && selected().length > 0,
    run: () => transfer.setClipboard('cut', selected()) },
  { id: 'paste', label: 'Paste', icon: 'paste', keys: ['Mod+V'],
    enabled: () => hasVfs() && !inTrash() && !!(state.clipboard && state.clipboard.paths && state.clipboard.paths.length),
    run: () => transfer.paste() },
  { id: 'duplicate', label: 'Duplicate', icon: 'copy', keys: ['Mod+D'],
    enabled: () => hasVfs() && !inTrash() && selected().length > 0,
    run: () => transfer.duplicateItems(selected()) },
  { id: 'select-all', label: 'Select All', keys: ['Mod+A'],
    enabled: () => views.list.items.length > 0,
    run: () => views.list.selectAll() },
  { id: 'trash', label: 'Move to Trash', icon: 'trash', keys: ['Delete'], danger: true,
    enabled: () => (hasVfs() || !!trash.provider) && !inTrash() && selected().length > 0,
    run: () => trash.trashItems(selected(), {
      // In headless without a mock trash provider, ask confirmation so real OS trash is protected
      askConfirm: app.headless && !trash.provider,
      onUndoPush: (u) => transfer.pushUndo(u),
    }) },
  { id: 'delete-permanent', label: 'Delete Permanently…', icon: 'trash', keys: ['Shift+Delete'], danger: true,
    enabled: () => hasVfs() && !inTrash() && selected().length > 0,
    run: () => transfer.deletePermanently(selected()) },
  { id: 'restore-trash', label: 'Restore from Trash', icon: 'undo',
    enabled: () => inTrash() && selected().length > 0 && !!trash.activeBackend,
    run: () => trash.restoreItems(selected()) },
  { id: 'empty-trash', label: 'Empty Trash…', icon: 'trash', danger: true,
    enabled: () => inTrash() && state.TrashCount > 0 && !!trash.activeBackend,
    run: () => trash.emptyTrash() },
  { id: 'undo', label: 'Undo', icon: 'undo', keys: ['Mod+Z'],
    enabled: () => transfer.canUndo(),
    run: () => transfer.undo() },
  { id: 'redo', label: 'Redo', icon: 'redo', keys: ['Mod+Shift+Z', 'Mod+Y'],
    enabled: () => transfer.canRedo(),
    run: () => transfer.redo() },
  { id: 'properties', label: 'Properties', icon: 'info', keys: ['Alt+Enter'],
    enabled: () => !!state.currentPath,
    run: () => inspector.showProperties(selected()) },
  { id: 'refresh', label: 'Refresh', icon: 'refresh', keys: ['F5', 'Mod+R'],
    enabled: () => !!state.currentPath,
    run: () => model.reload({ preserveSelection: true }) },
  { id: 'bookmark-folder', label: 'Bookmark This Folder', icon: 'star', keys: ['Mod+B'],
    enabled: () => !!state.currentPath && !inTrash(),
    checked: () => sidebar.isBookmarked(state.currentPath),
    run: () => sidebar.toggleBookmark(state.currentPath) },
  { id: 'open', label: 'Open', icon: 'external-link',
    enabled: () => selected().length === 1 && (selected()[0].isDirectory || !!api('apps')),
    run: () => activateItem(selected()[0]) },
  { id: 'copy-path', label: 'Copy Path', icon: 'link', keys: ['Mod+Shift+C'],
    enabled: () => selected().length > 0,
    run: copySelectedPaths },
  { id: 'new-window', label: 'New Window', icon: 'plus', keys: ['Mod+N'],
    run: () => app.newWindow(state.currentPath && !inTrash() ? [state.currentPath] : []) },
  { id: 'close-window', label: 'Close Window', keys: ['Mod+W', 'Mod+Q'],
    run: () => app.quit() },
]);

// bro dispatches ClipboardEvents (copy/cut/paste) on Mod+C/X/V when no input is focused.
for (const evName of ['copy', 'cut', 'paste']) {
  window.addEventListener(evName, (e) => {
    if (isTyping(e) || Dialog.current) return;
    if (commands.isEnabled(evName)) {
      e.preventDefault();
      commands.run(evName);
    }
  });
}

const toolbar = new Toolbar(ui.toolbar, commands);
toolbar.button('back');
toolbar.button('forward');
toolbar.button('up');
toolbar.sep();
toolbar.add(locationBar.el);
toolbar.add(search.el);
toolbar.add(views.zoomWrap);
toolbar.add(views.viewSwitcher.el);
const moreBtn = h('button.icon-btn', {
  'aria-label': 'More actions',
  'data-tip': 'More actions',
  onclick: () => showOverflowMenu(moreBtn),
}, icon('more-h'));
toolbar.add(moreBtn);

function refreshChrome() {
  toolbar.refresh();
  vfsBanner.classList.toggle('hidden', hasVfs());
  trash.updateBanner(inTrash(), selected());
}
refreshChrome();

// ---- rendering & updates ----------------------------------------------------

function displayTitle(p) {
  if (!p) return 'Files';
  if (p === TRASH_URI) return 'Trash';
  if (p === homeDir()) return 'Home';
  return path.basename(p) || p;
}

function onModelChanged({ select = null, preserveSelection = false } = {}) {
  const p = state.currentPath;
  locationBar.setPath(p);
  sidebar.select(p);
  app.setTitle(displayTitle(p));

  if (views.list.sort !== state.sort) {
    views.list.setSort(state.sort);
  }
  views.list.setItems(model.entries);

  if (select) {
    const normSel = normalizePath(select);
    views.list.select([normSel], { scroll: true });
  } else if (!preserveSelection) {
    views.list.clearSelection();
  }

  refreshChrome();
  updateStatus();
}

function volumeForPath(p) {
  if (!p || p === TRASH_URI || !state.volumes.length) return null;
  const norm = p.replace(/\\/g, '/').toLowerCase();
  let best = null;
  for (const v of state.volumes) {
    if (!v.mountPoint) continue;
    const m = v.mountPoint.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (norm === m || norm.startsWith(m + '/')) {
      if (!best || m.length > best.mountPoint.length) best = v;
    }
  }
  return best;
}

function updateStatus() {
  const total = views.list.items.length;
  const sel = selected();

  let text = formatCount(total, 'item');
  if (sel.length > 0) {
    const fileBytes = sel.reduce((sum, it) => sum + (it.isDirectory ? 0 : (it.size || 0)), 0);
    const hasFiles = sel.some((it) => !it.isDirectory);
    text += `, ${formatCount(sel.length, 'selected', 'selected')}`;
    if (hasFiles) text += ` (${formatBytes(fileBytes)})`;
  }
  statusLeft.textContent = text;

  const vol = volumeForPath(state.currentPath);
  statusRight.textContent = vol ? `Free: ${formatBytes(vol.availableBytes)}` : '';
}

// ---- actions & menus --------------------------------------------------------

async function openPath(target, opts = {}) {
  if (state.searchRecursive || state.filterQuery) {
    search.clear();
  }
  return model.openPath(target, opts);
}

function show(target, opts = {}) {
  return openPath(target, opts);
}

function activateItem(item) {
  if (!item) return;
  if (inTrash()) {
    inspector.showProperties([item]);
    return;
  }
  if (item.isDirectory) {
    openPath(item.path);
  } else {
    if (!api('apps')) {
      toast('bro.apps is unavailable; cannot launch external applications', { error: true });
      return;
    }
    openFile(item.path).then((ok) => {
      if (!ok) toast(`No application available to open “${item.name}”`, { error: true });
    });
  }
}

async function copySelectedPaths() {
  const items = selected();
  if (!items.length) return;
  const text = items.map((it) => it.path).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(items.length === 1 ? 'Copied path' : `Copied ${items.length} paths`, { icon: 'copy' });
  } catch (err) {
    toast(`Could not copy path: ${err.message}`, { error: true });
  }
}

function buildOpenWithSubmenu(item) {
  if (!item || item.isDirectory || !api('apps')) return null;
  const mime = mimeOf(item.path, false);
  const candidates = appsFor(mime);
  if (!candidates || !candidates.length) return null;
  return candidates.map((a) => ({
    label: a.name || a.id,
    icon: 'external-link',
    action: () => openFile(item.path, a.id),
  }));
}

function showContextMenu(e, items) {
  if (inTrash()) {
    const trashMenu = [
      items.length ? commands.item('restore-trash') : null,
      items.length === 1 ? commands.item('properties') : null,
      { separator: true },
      commands.item('empty-trash'),
    ].filter(Boolean);
    menu.show(trashMenu, e.clientX, e.clientY);
    return;
  }

  if (!items || !items.length) {
    menu.show([
      commands.item('new-folder'),
      commands.item('paste'),
      { separator: true },
      commands.item('select-all'),
      commands.item('toggle-hidden'),
      commands.item('bookmark-folder'),
      commands.item('refresh'),
      { separator: true },
      commands.item('properties'),
    ], e.clientX, e.clientY);
    return;
  }

  const single = items.length === 1 ? items[0] : null;
  const openWithSub = single ? buildOpenWithSubmenu(single) : null;

  menu.show([
    { heading: single ? single.name : formatCount(items.length, 'item') },
    single ? commands.item('open', { label: single.isDirectory ? 'Open Folder' : 'Open' }) : null,
    openWithSub ? { label: 'Open With', icon: 'apps', submenu: openWithSub } : null,
    single && single.isDirectory ? {
      label: sidebar.isBookmarked(single.path) ? 'Remove Bookmark' : 'Bookmark Folder',
      icon: 'star',
      action: () => sidebar.toggleBookmark(single.path, single.name),
    } : null,
    { separator: true },
    commands.item('cut'),
    commands.item('copy'),
    commands.item('duplicate'),
    commands.item('copy-path'),
    single ? commands.item('rename') : null,
    { separator: true },
    commands.item('trash'),
    commands.item('delete-permanent'),
    { separator: true },
    commands.item('properties'),
  ], e.clientX, e.clientY);
}

function showOverflowMenu(anchorEl) {
  menu.showBelow([
    commands.item('new-folder'),
    commands.item('new-window'),
    { separator: true },
    commands.item('undo'),
    commands.item('redo'),
    { separator: true },
    commands.item('view-grid'),
    commands.item('view-list'),
    commands.item('toggle-hidden'),
    commands.item('bookmark-folder'),
    { separator: true },
    commands.item('properties'),
  ], anchorEl);
}

// ---- test & diagnostic helpers ----------------------------------------------

function setDisableVfs(disabled) {
  state.disableVfs = !!disabled;
  if (disabled) model.stopWatch();
  else if (state.currentPath && !inTrash()) model.setupWatch(state.currentPath);
  refreshChrome();
}

function setMockTrash(trashDir) {
  if (!trashDir) {
    trash.setProvider(null);
    return null;
  }
  return trash.createMockProvider(trashDir);
}

// ---- startup (non-blocking I/O after first frame) ---------------------------

sidebar.fillPlaces();
sidebar.fillDrives();
appsReady();

async function handleLaunchArgs({ argv = [], cwd = '', first = false } = {}) {
  // If a test or caller already opened a path before the first-tick launch timer fired, don't override it.
  if (first && (state.currentPath || model.openSeq > 0 || model.loadSeq > 0)) return;
  if (argv.includes('--new-window') && !first) {
    const targetArg = argv.find((a) => !a.startsWith('--'));
    app.newWindow(targetArg ? [path.resolve(cwd || '.', targetArg)] : []);
    return;
  }
  const targetArg = argv.find((a) => !a.startsWith('--'));
  if (targetArg) {
    const resolved = targetArg === TRASH_URI ? TRASH_URI : path.resolve(cwd || '.', targetArg);
    try {
      const st = resolved !== TRASH_URI ? await fs.promises.stat(resolved) : null;
      if (st && !st.isDirectory()) {
        await openPath(path.dirname(resolved), { select: resolved });
        return;
      }
    } catch (_) { /* let openPath handle error */ }
    await openPath(resolved);
    return;
  }
  if (first) {
    const saved = settings.get('lastFolder');
    if (saved) {
      const ok = await openPath(saved, { quiet: true });
      if (ok) return;
    }
    if (!app.headless) {
      await openPath(homeDir(), { quiet: true });
    }
  }
}

app.onLaunch((info) => handleLaunchArgs(info));

app.expose({
  state,
  model,
  list: views.list,
  views,
  sidebar,
  crumbs: locationBar.crumbs,
  locationBar,
  search,
  transfer,
  trash,
  inspector,
  openPath,
  show,
  handleLaunchArgs,
  setDisableVfs,
  setMockTrash,
});
