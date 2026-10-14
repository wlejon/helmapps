/**
 * Archive Manager (helm.archives):
 * Create, inspect, browse, modify, and extract .zip, .tar, and .tar.gz archives.
 *
 * Follows docs/performance.md:
 *  - Builds and paints the window synchronously before any disk I/O.
 *  - Uses async fs.promises and Web CompressionStream/DecompressionStream.
 */

import { startApp } from '/lib/app.js';
import { h, api, replaceChildren, perFrame } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, SplitPane, Breadcrumbs, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { Dialog, confirmDialog, promptDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { Select } from '/lib/controls.js';
import { formatBytes, formatCount, formatDate, formatPercent } from '/lib/format.js';
import { kindOf, iconFor, addRecent } from '/lib/files.js';

import * as codec from './archive-codec.js';
import { ArchiveInspector } from './inspector.js';

const fs = require('fs');
const path = require('path');

const app = startApp({
  settings: {
    showInspector: { type: 'bool', default: true },
    inspectorWidth: { type: 'int', default: 300 },
    sortBy: { type: 'string', default: 'name' },
    sortDir: { type: 'int', default: 1 },
    recentArchives: { type: 'json', default: [] },
    lastFormat: { type: 'string', default: 'zip' },
    columns: { type: 'json', default: {} },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  archivePath: '',
  archive: null,
  currentDir: '',
  backStack: [],
  forwardStack: [],
  searchQuery: '',
  sort: {
    id: settings.get('sortBy') || 'name',
    dir: settings.get('sortDir') === -1 ? -1 : 1,
  },
  showInspector: settings.get('showInspector') !== false,
  loading: false,
  done: true,
  lastExtractedTo: '',
  maxRows: 5000,
};

// ---- the window (built synchronously before any disk I/O) -------------------

const ui = appFrame({ toolbar: true, sidebar: false, statusbar: true });
document.body.appendChild(ui.frame);

const crumbs = new Breadcrumbs({
  onNavigate: (dirPath) => navigateTo(dirPath),
});

const searchInput = h('input', {
  type: 'text',
  placeholder: 'Filter archive…',
  'aria-label': 'Filter archive entries',
});
const searchClearBtn = h('button.icon-btn.small.hidden', {
  'aria-label': 'Clear search',
  'data-tip': 'Clear search',
  onclick: (e) => {
    e.stopPropagation();
    setSearchQuery('');
    list.scroller.focus();
  },
}, icon('x', 'sm'));
const searchField = h('div.search-field', icon('search'), searchInput, searchClearBtn);

searchInput.addEventListener('input', () => {
  setSearchQuery(searchInput.value);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    setSearchQuery('');
    list.scroller.focus();
  }
});

const emptyFolderEl = emptyState({
  icon: 'folder-open',
  title: 'This folder is empty',
  hint: 'Add files to this archive with Add Files (Ctrl+I).',
});

const list = new VirtualList({
  layout: 'list',
  key: (item) => item.path,
  sort: state.sort,
  columnWidths: settings.get('columns'),
  onColumnResize: (w) => settings.set('columns', w),
  empty: emptyFolderEl,
  columns: [
    {
      id: 'name',
      label: 'Name',
      flex: 1,
      minWidth: 160,
      sortable: true,
      cell: (f) => [
        icon(iconFor({ name: f.name, isDir: f.isDirectory })),
        h('span.ellipsis', f.DisplayRelPath || f.name),
      ],
    },
    {
      id: 'size',
      label: 'Size',
      width: 96,
      align: 'right',
      sortable: true,
      cell: (f) => (f.isDirectory ? '—' : formatBytes(f.size)),
    },
    {
      id: 'packedSize',
      label: 'Packed',
      width: 96,
      align: 'right',
      sortable: true,
      cell: (f) => (f.isDirectory ? '—' : formatBytes(f.packedSize)),
    },
    {
      id: 'ratio',
      label: 'Ratio',
      width: 72,
      align: 'right',
      sortable: true,
      cell: (f) => (f.isDirectory ? '—' : formatPercent(f.ratio != null ? f.ratio : 1, 0)),
    },
    {
      id: 'mtimeMs',
      label: 'Modified',
      width: 128,
      align: 'right',
      sortable: true,
      cell: (f) => formatDate(f.mtimeMs),
    },
    {
      id: 'kind',
      label: 'Kind',
      width: 90,
      sortable: true,
      cell: (f) => kindOf(f.name, f.isDirectory),
    },
  ],
  onSort: (id, dir) => {
    state.sort = { id, dir };
    settings.set('sortBy', id);
    settings.set('sortDir', dir);
    renderCurrentFolder({ preserveSelection: true });
  },
  onActivate: (items) => {
    if (!items || !items.length) return;
    const item = items[0];
    if (item.isDirectory) {
      navigateTo(item.path);
    } else {
      if (!state.showInspector) {
        state.showInspector = true;
        settings.set('showInspector', true);
        split.setCollapsed(false);
        refreshChrome();
      }
      inspector.inspect(state.archive, [item]);
    }
  },
  onSelectionChange: (items) => {
    refreshChrome();
    updateStatus();
    if (state.showInspector) {
      scheduleInspector(state.archive, items);
    }
  },
  onContextMenu: (e, items) => showContextMenu(e, items),
  label: (f) => f.name,
});

const inspector = new ArchiveInspector();
const scheduleInspector = perFrame((arch, items) => {
  if (state.showInspector) inspector.inspect(arch, items);
});

const split = new SplitPane({
  fixed: 'second',
  size: settings.get('inspectorWidth') || 300,
  min: 220,
  max: 520,
  onResize: (px) => settings.set('inspectorWidth', px),
});
split.first.appendChild(list.el);
split.second.appendChild(inspector.el);
split.setCollapsed(!state.showInspector);

const welcomeEl = h('div.archives-welcome');
ui.content.append(welcomeEl, split.el);

const statusLeft = h('span.grow.num');
const statusRight = h('span.dim.num');
ui.statusbar.append(statusLeft, statusRight);

// ---- commands & shortcuts ---------------------------------------------------

const selected = () => list.selectedItems();
const hasArchive = () => !!state.archive;

commands.addAll([
  {
    id: 'open-archive',
    label: 'Open Archive…',
    icon: 'folder-open',
    keys: ['Mod+O'],
    run: () => promptOpenArchive(),
  },
  {
    id: 'new-archive',
    label: 'New Archive…',
    icon: 'file-plus',
    keys: ['Mod+N'],
    run: () => promptNewArchive(),
  },
  {
    id: 'extract-all',
    label: 'Extract All…',
    icon: 'download',
    keys: ['Mod+E'],
    enabled: () => hasArchive() && state.archive.entries.length > 0,
    run: () => promptExtract(false),
  },
  {
    id: 'extract-selected',
    label: 'Extract Selected…',
    icon: 'download',
    keys: ['Mod+Shift+E'],
    enabled: () => hasArchive() && selected().length > 0,
    run: () => promptExtract(true),
  },
  {
    id: 'add-files',
    label: 'Add Files…',
    icon: 'plus',
    keys: ['Mod+I'],
    enabled: () => hasArchive() && !!state.archivePath,
    run: () => promptAddFiles(),
  },
  {
    id: 'delete-selected',
    label: 'Delete from Archive…',
    icon: 'trash',
    keys: ['Delete'],
    danger: true,
    enabled: () => hasArchive() && !!state.archivePath && selected().length > 0,
    run: () => deleteSelectedEntries({ skipConfirm: false }),
  },
  {
    id: 'back',
    label: 'Back',
    icon: 'arrow-left',
    keys: ['Alt+ArrowLeft', 'Backspace'],
    enabled: () => hasArchive() && state.backStack.length > 0,
    run: () => goBack(),
  },
  {
    id: 'up',
    label: 'Enclosing Folder',
    icon: 'arrow-up',
    keys: ['Alt+ArrowUp'],
    enabled: () => hasArchive() && !!state.currentDir,
    run: () => goUp(),
  },
  {
    id: 'search',
    label: 'Filter Archive…',
    icon: 'search',
    keys: ['Mod+F'],
    inText: true,
    enabled: () => hasArchive(),
    run: () => {
      searchInput.focus();
      if (searchInput.select) searchInput.select();
    },
  },
  {
    id: 'toggle-inspector',
    label: 'Toggle Inspector',
    icon: 'sidebar',
    keys: ['Mod+P'],
    checked: () => state.showInspector,
    run: () => {
      state.showInspector = !state.showInspector;
      settings.set('showInspector', state.showInspector);
      split.setCollapsed(!state.showInspector);
      if (state.showInspector) inspector.inspect(state.archive, selected());
      refreshChrome();
    },
  },
  {
    id: 'select-all',
    label: 'Select All',
    keys: ['Mod+A'],
    enabled: () => hasArchive() && list.items.length > 0,
    run: () => list.selectAll(),
  },
  {
    id: 'refresh',
    label: 'Reload Archive',
    icon: 'refresh',
    keys: ['F5', 'Mod+R'],
    enabled: () => hasArchive() && !!state.archivePath,
    run: () => openArchive(state.archivePath, { preserveDir: true }),
  },
  {
    id: 'quit',
    label: 'Quit',
    keys: ['Mod+Q', 'Mod+W'],
    run: () => app.quit(),
  },
]);

const toolbar = new Toolbar(ui.toolbar, commands);
toolbar.button('back');
toolbar.button('up');
toolbar.sep();
toolbar.button('open-archive');
toolbar.button('new-archive');
toolbar.button('add-files');
toolbar.button('extract-all', { label: true });
toolbar.button('delete-selected');
toolbar.sep();
toolbar.add(crumbs.el);
toolbar.spacer();
toolbar.add(searchField);
toolbar.button('toggle-inspector');

// ---- view rendering ---------------------------------------------------------

function refreshChrome() {
  toolbar.refresh();
  const open = hasArchive();
  welcomeEl.classList.toggle('hidden', open);
  split.el.classList.toggle('hidden', !open);
  searchField.classList.toggle('hidden', !open);
  crumbs.el.classList.toggle('hidden', !open);
}

function renderWelcome() {
  const recents = (settings.get('recentArchives') || []).filter((p) => typeof p === 'string' && p);
  const recentSection = recents.length > 0
    ? h('div.archives-recent',
      h('div.micro', 'RECENT ARCHIVES'),
      h('div.archives-recent-list',
        ...recents.slice(0, 6).map((p) =>
          h('button.archives-recent-row', {
            onclick: () => openArchive(p),
            title: p,
          },
          icon('file-archive'),
          h('div.archives-recent-meta',
            h('span.ellipsis', path.basename(p)),
            h('span.archives-recent-path.mono', p),
          )),
        ),
      ),
    )
    : null;

  replaceChildren(welcomeEl,
    h('div.archives-welcome-card',
      h('div.empty-glyph', icon('file-archive')),
      h('div.empty-title', 'Archive Manager'),
      h('div.empty-hint', 'Inspect, extract, and create .zip, .tar, and .tar.gz archives without external tools.'),
      h('div.archives-welcome-actions',
        h('button.btn.primary', { onclick: () => commands.run('open-archive') }, icon('folder-open'), 'Open Archive…'),
        h('button.btn', { onclick: () => commands.run('new-archive') }, icon('file-plus'), 'New Archive…'),
      ),
    ),
    recentSection,
  );
}

function updateBreadcrumbs() {
  if (!state.archive) {
    crumbs.set([]);
    return;
  }
  const segs = [{
    label: state.archive.name || path.basename(state.archivePath) || 'Archive',
    value: '',
    icon: 'file-archive',
  }];
  if (state.currentDir) {
    const parts = state.currentDir.split('/');
    let acc = '';
    for (const part of parts) {
      if (!part) continue;
      acc = acc ? `${acc}/${part}` : part;
      segs.push({ label: part, value: acc });
    }
  }
  crumbs.set(segs);
}

function sortEntries(items) {
  const { id, dir } = state.sort || { id: 'name', dir: 1 };
  const copy = items.slice();
  copy.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    let cmp = 0;
    if (id === 'size') cmp = (a.size || 0) - (b.size || 0);
    else if (id === 'packedSize') cmp = (a.packedSize || 0) - (b.packedSize || 0);
    else if (id === 'ratio') cmp = (a.ratio || 0) - (b.ratio || 0);
    else if (id === 'mtimeMs') cmp = (a.mtimeMs || 0) - (b.mtimeMs || 0);
    else if (id === 'kind') {
      const ka = kindOf(a.name, a.isDirectory);
      const kb = kindOf(b.name, b.isDirectory);
      cmp = ka < kb ? -1 : (ka > kb ? 1 : 0);
    }
    if (cmp === 0) {
      const na = a.nameLower || a.name.toLowerCase();
      const nb = b.nameLower || b.name.toLowerCase();
      cmp = na < nb ? -1 : (na > nb ? 1 : 0);
    }
    return cmp * dir;
  });
  return copy;
}

function renderCurrentFolder({ preserveSelection = false } = {}) {
  if (!state.archive) {
    renderWelcome();
    refreshChrome();
    updateStatus();
    return;
  }

  refreshChrome();
  updateBreadcrumbs();
  const q = (state.searchQuery || '').trim();
  let visible;

  if (q) {
    const prefix = state.currentDir ? `${state.currentDir}/` : '';
    const candidates = state.archive.entries.filter((e) =>
      !state.currentDir || e.parentPath === state.currentDir || e.path.startsWith(prefix)
    );
    const searchApi = api('search');
    let matched;
    if (searchApi && typeof searchApi.fuzzy === 'function') {
      matched = searchApi.fuzzy(q, candidates, { key: (e) => e.name }).map((m) => m.item);
    } else {
      const lower = q.toLowerCase();
      matched = candidates.filter((e) => (e.nameLower || e.name.toLowerCase()).includes(lower) || e.path.toLowerCase().includes(lower));
    }
    visible = matched.map((e) => {
      const rel = prefix && e.path.startsWith(prefix) ? e.path.slice(prefix.length) : e.path;
      return rel !== e.name ? { ...e, DisplayRelPath: rel } : e;
    });
  } else {
    visible = state.archive.entries.filter((e) => e.parentPath === state.currentDir);
  }

  const sorted = sortEntries(visible);
  const capped = sorted.length > state.maxRows ? sorted.slice(0, state.maxRows) : sorted;
  state.totalFolderItems = sorted.length;

  if (!preserveSelection && list.selection.size > 0) {
    list.selection.clear();
  }
  if (list.sort !== state.sort) list.setSort(state.sort);
  list.setItems(capped);
  updateStatus();
}

function updateStatus() {
  if (!state.archive) {
    statusLeft.textContent = 'No archive open';
    statusRight.textContent = '';
    return;
  }
  const shown = list.items.length;
  const totalInView = state.totalFolderItems || shown;
  const sel = selected();

  let left = totalInView > shown
    ? `Showing ${formatCount(shown, 'item')} of ${formatCount(totalInView, 'item')}`
    : formatCount(shown, 'item');

  if (sel.length > 0) {
    const selBytes = sel.reduce((s, e) => s + (e.isDirectory ? 0 : (e.size || 0)), 0);
    left += ` • ${formatCount(sel.length, 'selected', 'selected')} (${formatBytes(selBytes)})`;
  }
  statusLeft.textContent = left;

  const fmt = (state.archive.format || 'zip').toUpperCase();
  statusRight.textContent = `${fmt} • ${formatCount(state.archive.fileCount, 'file')} • ` +
    `${formatBytes(state.archive.totalPackedSize)} packed / ${formatBytes(state.archive.totalSize)} unpacked`;
}

// ---- navigation & search ----------------------------------------------------

export function navigateTo(dirPath, { push = true } = {}) {
  if (!state.archive) return;
  const clean = String(dirPath || '').replace(/^\/+|\/+$/g, '');
  if (clean === state.currentDir && !state.searchQuery) return;
  if (push && state.currentDir !== clean) {
    state.backStack.push(state.currentDir);
    state.forwardStack = [];
  }
  state.currentDir = clean;
  if (state.searchQuery) {
    state.searchQuery = '';
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
  }
  renderCurrentFolder();
}

function goBack() {
  if (!state.backStack.length) return;
  const prev = state.backStack.pop();
  state.forwardStack.push(state.currentDir);
  navigateTo(prev, { push: false });
}

function goUp() {
  if (!state.currentDir) return;
  const idx = state.currentDir.lastIndexOf('/');
  const parent = idx < 0 ? '' : state.currentDir.slice(0, idx);
  navigateTo(parent, { push: true });
}

export function setSearchQuery(query) {
  state.searchQuery = String(query || '');
  if (searchInput.value !== state.searchQuery) searchInput.value = state.searchQuery;
  searchClearBtn.classList.toggle('hidden', !state.searchQuery);
  renderCurrentFolder();
}

// ---- archive operations -----------------------------------------------------

function recordRecentArchive(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const existing = (settings.get('recentArchives') || []).filter((p) => p !== resolved);
  existing.unshift(resolved);
  settings.set('recentArchives', existing.slice(0, 10));
  addRecent(resolved);
}

export async function openArchive(archivePath, { preserveDir = false, quiet = false } = {}) {
  if (!archivePath) return false;
  const resolved = path.resolve(archivePath);
  state.loading = true;
  state.done = false;
  welcomeEl.classList.add('hidden');
  split.el.classList.remove('hidden');
  statusLeft.textContent = `Loading ${path.basename(resolved)}…`;

  try {
    const parsed = await codec.readArchive(resolved);
    parsed.name = path.basename(resolved);
    state.archivePath = resolved;
    state.archive = parsed;
    if (!preserveDir) {
      state.currentDir = '';
      state.backStack = [];
      state.forwardStack = [];
      state.searchQuery = '';
      searchInput.value = '';
      searchClearBtn.classList.add('hidden');
    }
    if (parsed.entries.length > 300 && typeof requestAnimationFrame === 'function') {
      await new Promise((r) => requestAnimationFrame(r));
    }
    state.loading = false;
    state.done = true;
    app.setTitle(parsed.name);
    recordRecentArchive(resolved);
    renderCurrentFolder({ preserveSelection: preserveDir });
    return true;
  } catch (err) {
    state.loading = false;
    state.done = true;
    if (!quiet) toast(`Could not open archive: ${err.message}`, { error: true });
    updateStatus();
    return false;
  }
}

export async function createArchiveFromPaths(outputPath, inputPaths, opts = {}) {
  const resolvedOut = path.resolve(outputPath);
  state.loading = true;
  state.done = false;
  try {
    const res = await codec.createArchive(resolvedOut, inputPaths, opts);
    await openArchive(resolvedOut, { quiet: true });
    toast(`Created ${path.basename(resolvedOut)} (${formatCount(res.entryCount, 'entry', 'entries')})`);
    return res;
  } catch (err) {
    state.loading = false;
    state.done = true;
    toast(`Could not create archive: ${err.message}`, { error: true });
    throw err;
  }
}

export async function extractAllTo(destDir, opts = {}) {
  if (!state.archive) throw new Error('No archive open');
  const resolvedDest = path.resolve(destDir);
  const res = await codec.extractEntries(state.archive, resolvedDest, opts);
  state.lastExtractedTo = resolvedDest;
  toast(`Extracted ${formatCount(res.extractedCount, 'file')} to ${path.basename(resolvedDest)}`);
  return res;
}

export async function extractSelectedTo(destDir, opts = {}) {
  if (!state.archive) throw new Error('No archive open');
  const sel = opts.entries || selected();
  if (!sel.length) return { extractedCount: 0, extractedPaths: [], destDir };
  const resolvedDest = path.resolve(destDir);
  const res = await codec.extractEntries(state.archive, resolvedDest, {
    ...opts,
    entries: sel,
  });
  state.lastExtractedTo = resolvedDest;
  toast(`Extracted ${formatCount(res.extractedCount, 'file')} to ${path.basename(resolvedDest)}`);
  return res;
}

export async function addFilesToArchive(inputPaths, opts = {}) {
  if (!state.archivePath) throw new Error('No archive open');
  const targetDir = opts.targetDir !== undefined ? opts.targetDir : state.currentDir;
  await codec.addEntriesToArchive(state.archivePath, inputPaths, { ...opts, targetDir });
  await openArchive(state.archivePath, { preserveDir: true, quiet: true });
  toast(`Added ${formatCount(inputPaths.length, 'item')} to ${path.basename(state.archivePath)}`);
  return true;
}

export async function deleteSelectedEntries({ skipConfirm = false, entries = null } = {}) {
  if (!state.archivePath) return false;
  const targets = entries || selected();
  if (!targets || !targets.length) return false;

  if (!skipConfirm) {
    const label = targets.length === 1 ? `“${targets[0].name}”` : formatCount(targets.length, 'item');
    const ok = await confirmDialog({
      title: `Delete ${label} from archive?`,
      body: 'This will permanently remove the selected entries from the archive file.',
      ok: 'Delete',
      danger: true,
    });
    if (!ok) return false;
  }

  await codec.deleteEntriesFromArchive(state.archivePath, targets);
  await openArchive(state.archivePath, { preserveDir: true, quiet: true });
  toast(`Deleted ${formatCount(targets.length, 'item')} from archive`, { icon: 'trash' });
  return true;
}

// ---- interactive dialogs & menus --------------------------------------------

async function promptOpenArchive() {
  if (!app.headless && typeof showOpenFileDialogAsync === 'function') {
    const picked = await showOpenFileDialogAsync({
      title: 'Open Archive',
      filters: [{ name: 'Archives', extensions: ['zip', 'tar', 'gz', 'tgz'] }],
    });
    if (picked && picked.length) await openArchive(picked[0]);
    return;
  }
  const p = await promptDialog({
    title: 'Open Archive',
    placeholder: '/path/to/archive.zip',
    ok: 'Open',
  });
  if (p) await openArchive(p.trim());
}

async function promptNewArchive() {
  const d = new Dialog({ title: 'New Archive', icon: 'file-plus', wide: true });
  const pathInput = h('input.field', {
    type: 'text',
    placeholder: 'Output archive path (e.g. archive.zip)',
    value: '',
  });
  const formatSelect = new Select({
    options: [
      { value: 'zip', label: 'ZIP (.zip)' },
      { value: 'tar.gz', label: 'Compressed TAR (.tar.gz)' },
      { value: 'tar', label: 'TAR (.tar)' },
    ],
    value: settings.get('lastFormat') || 'zip',
    onChange: (fmt) => settings.set('lastFormat', fmt),
  });
  const filesInput = h('input.field', {
    type: 'text',
    placeholder: 'Files or folders to include (comma-separated paths)',
    value: '',
  });

  d.body.appendChild(h('div.dialog-form',
    h('div.dialog-field-group',
      h('span.micro', 'ARCHIVE PATH & FORMAT'),
      h('div.dialog-field-row', pathInput, formatSelect.el),
    ),
    h('div.dialog-field-group',
      h('span.micro', 'SOURCE FILES OR FOLDERS'),
      filesInput,
    ),
  ));

  d.addButton('Cancel', { value: null });
  d.addButton('Create', { primary: true, value: 'create' });
  const r = await d.open();
  if (r === 'create' && pathInput.value.trim()) {
    const outPath = pathInput.value.trim();
    const sources = filesInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    await createArchiveFromPaths(outPath, sources, { format: formatSelect.value });
  }
}

async function promptExtract(onlySelected = false) {
  if (!state.archive) return;
  const defaultDest = state.archivePath
    ? path.join(path.dirname(state.archivePath), archiveStem(state.archivePath))
    : '';

  if (!app.headless && typeof showOpenFolderDialogAsync === 'function') {
    const dest = await showOpenFolderDialogAsync({ title: 'Extract To Folder', defaultPath: defaultDest });
    if (dest) {
      if (onlySelected) await extractSelectedTo(dest);
      else await extractAllTo(dest);
    }
    return;
  }

  const dest = await promptDialog({
    title: onlySelected ? 'Extract Selected To' : 'Extract All To',
    value: defaultDest,
    ok: 'Extract',
  });
  if (dest) {
    if (onlySelected) await extractSelectedTo(dest.trim());
    else await extractAllTo(dest.trim());
  }
}

async function promptAddFiles() {
  if (!state.archivePath) return;
  if (!app.headless && typeof showOpenFileDialogAsync === 'function') {
    const picked = await showOpenFileDialogAsync({ title: 'Add Files to Archive', multiSelections: true });
    if (picked && picked.length) await addFilesToArchive(picked);
    return;
  }
  const p = await promptDialog({
    title: 'Add Files to Archive',
    placeholder: '/path/to/file',
    ok: 'Add',
  });
  if (p) {
    const listPaths = p.split(',').map((s) => s.trim()).filter(Boolean);
    if (listPaths.length) await addFilesToArchive(listPaths);
  }
}

function showContextMenu(e, items) {
  const single = items && items.length === 1 ? items[0] : null;
  menu.show([
    single && single.isDirectory ? {
      label: 'Open Folder',
      icon: 'folder-open',
      action: () => navigateTo(single.path),
    } : null,
    items && items.length > 0 ? commands.item('extract-selected') : null,
    commands.item('extract-all'),
    { separator: true },
    commands.item('add-files'),
    items && items.length > 0 ? commands.item('delete-selected') : null,
    { separator: true },
    commands.item('select-all'),
    commands.item('refresh'),
  ].filter(Boolean), e.clientX, e.clientY);
}

// ---- CLI / Launch handling --------------------------------------------------

export function archiveStem(filePath) {
  const base = path.basename(filePath);
  return base.replace(/\.(tar\.gz|tgz|zip|tar|gz)$/i, '') || `${base}-extracted`;
}

export async function handleLaunchArgs({ argv = [], cwd = '' } = {}) {
  const args = Array.from(argv || []);
  if (!args.length) return;

  const extractIdx = args.indexOf('--extract-here');
  if (extractIdx >= 0 && args[extractIdx + 1]) {
    const archiveFile = path.resolve(cwd || '.', args[extractIdx + 1]);
    const destDir = path.join(path.dirname(archiveFile), archiveStem(archiveFile));
    await openArchive(archiveFile, { quiet: true });
    await extractAllTo(destDir);
    return;
  }

  const createIdx = args.indexOf('--create');
  if (createIdx >= 0 && args[createIdx + 1]) {
    const outFile = path.resolve(cwd || '.', args[createIdx + 1]);
    const inputFiles = args.slice(createIdx + 2).filter((a) => !a.startsWith('--')).map((p) => path.resolve(cwd || '.', p));
    await createArchiveFromPaths(outFile, inputFiles);
    return;
  }

  const target = args.find((a) => !a.startsWith('--'));
  if (target) {
    await openArchive(path.resolve(cwd || '.', target));
  }
}

renderWelcome();
refreshChrome();
updateStatus();

app.onLaunch((info) => handleLaunchArgs(info));

app.expose({
  state,
  list,
  crumbs,
  split,
  inspector,
  searchInput,
  codec,
  openArchive,
  createArchiveFromPaths,
  extractAllTo,
  extractSelectedTo,
  addFilesToArchive,
  deleteSelectedEntries,
  navigateTo,
  setSearchQuery,
  handleLaunchArgs,
});
