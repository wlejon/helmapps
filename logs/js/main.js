/**
 * Logs (helm.logs): Inspect and filter application, desktop, and system logs.
 *
 * Built for fast startup and responsive browsing of 10,000+ log lines:
 *  - Builds the window synchronously before any disk I/O.
 *  - Discovers and reads up to the tail 2 MB of real log files asynchronously.
 *  - Uses VirtualList (rowHeight: 30) for O(visible) rendering.
 *  - Uses bro.search.Regex (when available) or RegExp for fast regex filtering.
 *  - Supports live tailing via bro.vfs.watch + async byte-offset tailing.
 */

import { startApp } from '/lib/app.js';
import { h, api } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { Segmented } from '/lib/controls.js';
import { formatCount, formatNumber } from '/lib/format.js';
import {
  normalizeSeverity,
  severityBadgeText,
  parseLogLine,
  parseLogText,
  filterLogEntries,
} from './log-parser.js';
import { LogSourceManager } from './log-sources.js';

const fs = require('fs');
const path = require('path');

const app = startApp({
  settings: {
    lastSource: { type: 'string', default: '' },
    severity: { type: 'string', default: 'all' },
    useRegex: { type: 'bool', default: false },
    tail: { type: 'bool', default: false },
    columns: { type: 'json', default: {} },
  },
});

const { commands, settings } = app;
const searchApi = api('search');
const sources = new LogSourceManager();

// ---- state ------------------------------------------------------------------

const state = {
  activeSourceId: '',
  entries: [],
  filtered: [],
  severity: 'all',
  query: '',
  useRegex: false,
  tail: false,
  selectedEntry: null,
  loading: false,
  ready: false,
};

// ---- the window -------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const sidebar = new Sidebar({
  onSelect: (item) => selectSource(item.id),
  onContextMenu: (e, item) => sourceContextMenu(e, item),
});
ui.sidebar.appendChild(sidebar.el);

// Status bar elements
const statusText = h('span.grow', 'Ready');
const statusCounts = h('span.num.dim', '');
const statusLive = h('span.statusbar-live.hidden', h('span.statusbar-dot'), 'Live Follow');
ui.statusbar.append(statusText, statusCounts, statusLive);

// VirtualList for log entries
const severityCell = (entry) => h(
  `span.sev-badge.sev-${entry.severity}`,
  severityBadgeText(entry.severity),
);

const messageCell = (entry) => {
  const parts = [h('span.logs-msg.mono.ellipsis', entry.message)];
  if (entry.details || entry.json) {
    parts.push(h('span.logs-has-details.mono', entry.json ? 'JSON' : 'trace'));
  }
  return parts;
};

const list = new VirtualList({
  layout: 'list',
  rowHeight: 30,
  key: (e) => e.id,
  label: (e) => e.message,
  typeAhead: false,
  rowClass: (e) => `row-${e.severity}`,
  columns: [
    { id: 'severity', label: 'Level', width: 68, resizable: false, cell: severityCell },
    { id: 'timestamp', label: 'Time', width: 140, sortable: true,
      cell: (e) => h('span.num.dim.ellipsis', e.timeDisplay || '—') },
    { id: 'source', label: 'Source', width: 130, sortable: true,
      cell: (e) => h('span.ellipsis.dim', e.source || '—') },
    { id: 'message', label: 'Message', flex: 1, minWidth: 200, cell: messageCell },
  ],
  columnWidths: settings.get('columns'),
  onColumnResize: (w) => settings.set('columns', w),
  onSort: (id, dir) => sortFiltered(id, dir),
  onSelectionChange: (items) => {
    const first = items.length ? items[0] : null;
    showDrawer(first);
    toolbar.refresh();
    updateStatus();
  },
  onContextMenu: (e, items) => entryContextMenu(e, items),
  empty: emptyState({
    icon: 'file-text',
    title: 'No log entries',
    hint: 'No log entries match the current filter, or the selected source is empty.',
  }),
});

// Detail Drawer at bottom of main content area
const drawerBadge = h('span.sev-badge.sev-info', 'INFO');
const drawerTime = h('span.num.dim', '');
const drawerSource = h('span.dim.ellipsis', '');
const drawerCopyBtn = h('button.btn.small', {
  onclick: () => commands.run('copy-entry'),
  'data-tip': 'Copy Entry',
}, icon('copy'), 'Copy Entry');
const drawerCloseBtn = h('button.icon-btn.small', {
  'aria-label': 'Close Details',
  'data-tip': 'Close Details',
  onclick: () => {
    list.clearSelection();
    showDrawer(null);
  },
}, icon('x'));

const drawerMessage = h('div.logs-drawer-message.selectable');
const drawerDetailsSection = h('div.logs-drawer-section.hidden');
const drawerDetailsTitle = h('div.micro', 'Details');
const drawerDetailsPre = h('pre.logs-pre.mono.selectable');
drawerDetailsSection.append(drawerDetailsTitle, drawerDetailsPre);

const drawerRawSection = h('div.logs-drawer-section');
const drawerRawTitle = h('div.micro', 'Raw Entry');
const drawerRawPre = h('pre.logs-pre.mono.selectable');
drawerRawSection.append(drawerRawTitle, drawerRawPre);

const drawer = h('div.logs-drawer.hidden',
  h('div.logs-drawer-head',
    h('div.logs-drawer-meta', drawerBadge, drawerTime, drawerSource),
    drawerCopyBtn,
    drawerCloseBtn),
  h('div.logs-drawer-body',
    drawerMessage,
    drawerDetailsSection,
    drawerRawSection));

ui.content.append(list.el, drawer);

// ---- toolbar controls & commands --------------------------------------------

const severitySeg = new Segmented({
  options: [
    { value: 'all', label: 'All', title: 'Show all log levels' },
    { value: 'error', label: 'Errors', title: 'Show errors only' },
    { value: 'warn', label: 'Warnings', title: 'Show warnings only' },
    { value: 'info', label: 'Info', title: 'Show info only' },
    { value: 'debug', label: 'Debug', title: 'Show debug only' },
  ],
  value: state.severity,
  onChange: (val) => setSeverity(val),
});

const searchInput = h('input', {
  type: 'text',
  placeholder: 'Search logs…',
  'aria-label': 'Search logs',
  oninput: () => setQuery(searchInput.value),
  onkeydown: (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (searchInput.value) {
        setQuery('');
      } else {
        searchInput.blur();
      }
    }
  },
});

const regexBtn = h('button.logs-regex-btn', {
  type: 'button',
  'data-tip': 'Use Regular Expression',
  'aria-label': 'Use Regular Expression',
  onclick: () => commands.run('toggle-regex'),
}, '.*');

const searchBox = h('div.search-field.logs-search',
  icon('search'),
  searchInput,
  regexBtn);

commands.addAll([
  { id: 'open-file', label: 'Open Log File…', icon: 'folder-open', keys: ['Mod+O'],
    run: (arg) => (typeof arg === 'string' && arg ? openLogFile(arg) : pickLogFile()) },
  { id: 'filter-all', label: 'All Levels',
    checked: () => state.severity === 'all', run: () => setSeverity('all') },
  { id: 'filter-error', label: 'Errors',
    checked: () => state.severity === 'error', run: () => setSeverity('error') },
  { id: 'filter-warn', label: 'Warnings',
    checked: () => state.severity === 'warn', run: () => setSeverity('warn') },
  { id: 'filter-info', label: 'Info',
    checked: () => state.severity === 'info', run: () => setSeverity('info') },
  { id: 'filter-debug', label: 'Debug',
    checked: () => state.severity === 'debug', run: () => setSeverity('debug') },
  { id: 'focus-search', label: 'Find in Logs', icon: 'search', keys: ['Mod+F'], inText: true,
    run: () => { searchInput.focus(); searchInput.select(); } },
  { id: 'clear-filter', label: 'Clear Filter', keys: ['Escape'],
    enabled: () => Boolean(state.query || state.severity !== 'all' || state.selectedEntry),
    run: () => {
      if (state.query) setQuery('');
      else if (state.severity !== 'all') setSeverity('all');
      else if (state.selectedEntry) { list.clearSelection(); showDrawer(null); }
    } },
  { id: 'toggle-regex', label: 'Regular Expression Search', icon: 'code', keys: ['Mod+Alt+R'], inText: true,
    checked: () => state.useRegex,
    run: () => setUseRegex(!state.useRegex) },
  { id: 'toggle-tail', label: 'Live Follow (Tail)', icon: 'activity', keys: ['Mod+T'],
    checked: () => state.tail,
    run: () => setTail(!state.tail) },
  { id: 'copy-entry', label: 'Copy Entry', icon: 'copy', keys: ['Mod+C', 'Mod+Shift+C'],
    enabled: () => list.selectedItems().length > 0 || Boolean(state.selectedEntry),
    run: () => copySelectedEntries() },
  { id: 'export-filtered', label: 'Export Filtered…', icon: 'download', keys: ['Mod+S'], inText: true,
    enabled: () => state.filtered.length > 0,
    run: (targetPath) => exportFiltered(typeof targetPath === 'string' ? targetPath : undefined) },
  { id: 'clear-view', label: 'Clear View', icon: 'trash', keys: ['Mod+K'],
    enabled: () => state.entries.length > 0,
    run: () => clearView() },
  { id: 'refresh', label: 'Refresh', icon: 'refresh', keys: ['F5', 'Mod+R'],
    run: () => refresh() },
  { id: 'new-window', label: 'New Window', keys: ['Mod+N'], run: () => app.newWindow() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

toolbar.button('open-file');
toolbar.sep();
toolbar.add(severitySeg.el);
toolbar.spacer();
toolbar.add(searchBox);
toolbar.sep();
toolbar.button('toggle-tail');
toolbar.button('refresh');
toolbar.button('clear-view');
toolbar.button('export-filtered');

function refreshChrome() {
  regexBtn.classList.toggle('active', state.useRegex);
  if (severitySeg.value !== state.severity) severitySeg.set(state.severity);
  if (searchInput.value !== state.query) searchInput.value = state.query;
  statusLive.classList.toggle('hidden', !state.tail);
  toolbar.refresh();
}
refreshChrome();

// ---- sidebar & source management --------------------------------------------

function drawSidebar() {
  const { desktop, system, opened } = sources.getSections();
  const sections = [];
  if (desktop.length) sections.push({ title: 'Desktop & Apps', items: desktop });
  if (system.length) sections.push({ title: 'System', items: system });
  if (opened.length) sections.push({ title: 'Opened Files', items: opened });
  if (!sections.length) {
    sections.push({
      title: 'Desktop & Apps',
      items: [{ id: 'empty', label: 'No logs found', icon: 'info', sub: 'Open a log file with Ctrl+O' }],
    });
  }
  sidebar.setSections(sections);
  if (state.activeSourceId) sidebar.select(state.activeSourceId);
}

async function discoverSources({ selectDefault = true } = {}) {
  state.loading = true;
  const res = await sources.discover();
  if (!res) return; // superseded by a newer discover/setRoot call
  drawSidebar();

  if (selectDefault) {
    const { desktop, system, opened } = res;
    const allItems = [...desktop, ...system, ...opened];
    const preferred = allItems.find((i) => i.id === state.activeSourceId)
      || allItems.find((i) => i.id === 'all')
      || allItems[0];
    if (preferred && preferred.id !== 'empty') {
      await selectSource(preferred.id, { reload: false });
    } else {
      state.entries = [];
      applyFilter();
    }
  } else {
    drawSidebar();
  }
  state.loading = false;
  state.ready = true;
}

async function selectSource(id, { reload = false } = {}) {
  if (!id || id === 'empty') return;
  state.activeSourceId = id;
  sidebar.select(id);
  settings.set('lastSource', id);

  if (reload) {
    await sources.loadSource(id);
    drawSidebar();
  }

  const src = sources.getSource(id);
  state.entries = src ? src.entries.slice() : [];
  app.setTitle(src ? `${src.label} — Logs` : 'Logs');
  showDrawer(null);
  applyFilter();
  syncWatcher();
}

function syncWatcher() {
  sources.stopWatch();
  if (state.tail && state.activeSourceId) {
    sources.watchSource(state.activeSourceId, (_added, allEntries) => {
      state.entries = allEntries.slice();
      drawSidebar();
      applyFilter({ scrollToEnd: true });
    });
  }
}

// ---- filtering, sorting, and detail drawer ----------------------------------

function applyFilter({ scrollToEnd = false } = {}) {
  state.filtered = filterLogEntries(state.entries, {
    severity: state.severity,
    query: state.query,
    useRegex: state.useRegex,
    searchApi,
  });
  list.setItems(state.filtered);
  if (scrollToEnd && state.filtered.length > 0) {
    list.scrollToIndex(state.filtered.length - 1);
  }
  refreshChrome();
  updateStatus();
}

function sortFiltered(colId, dir) {
  const keyFn = colId === 'timestamp'
    ? (e) => e.timestamp || ''
    : colId === 'source'
      ? (e) => (e.source || '').toLowerCase()
      : (e) => e.id;
  state.filtered = state.filtered.slice().sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    if (ka < kb) return -dir;
    if (ka > kb) return dir;
    return (a.id - b.id) * dir;
  });
  list.setItems(state.filtered);
}

function showDrawer(entry) {
  state.selectedEntry = entry || null;
  if (!entry) {
    drawer.classList.add('hidden');
    return;
  }
  drawer.classList.remove('hidden');
  drawerBadge.className = `sev-badge sev-${entry.severity}`;
  drawerBadge.textContent = severityBadgeText(entry.severity);
  drawerTime.textContent = entry.timestamp || entry.timeDisplay || '—';
  drawerSource.textContent = entry.source || '—';
  drawerMessage.textContent = entry.message || '';

  if (entry.json && !entry.details) {
    entry.details = JSON.stringify(entry.json, null, 2);
  }
  if (entry.details) {
    drawerDetailsSection.classList.remove('hidden');
    drawerDetailsTitle.textContent = entry.json ? 'Structured Fields (JSON)' : 'Stack Trace / Details';
    drawerDetailsPre.textContent = entry.details;
  } else {
    drawerDetailsSection.classList.add('hidden');
    drawerDetailsPre.textContent = '';
  }

  drawerRawPre.textContent = entry.raw || entry.message || '';
}

function updateStatus() {
  const src = sources.getSource(state.activeSourceId);
  const total = state.entries.length;
  const shown = state.filtered.length;
  const sel = list.selectedItems();

  if (sel.length > 1) {
    statusText.textContent = `${formatCount(sel.length, 'entry', 'entries')} selected`;
  } else if (src) {
    statusText.textContent = src.path ? `${src.label} (${src.path})` : src.label;
  } else {
    statusText.textContent = 'Ready';
  }

  let errors = 0;
  let warns = 0;
  for (let i = 0; i < state.entries.length; i++) {
    const s = state.entries[i].severity;
    if (s === 'error') errors++;
    else if (s === 'warn') warns++;
  }

  const filterNote = shown !== total
    ? `Showing ${formatNumber(shown)} of ${formatCount(total, 'entry', 'entries')}`
    : formatCount(total, 'entry', 'entries');
  statusCounts.textContent = `${filterNote} • ${formatCount(errors, 'error')} • ${formatCount(warns, 'warning')}`;
}

// ---- actions & API methods --------------------------------------------------

export function setSeverity(sev) {
  state.severity = sev || 'all';
  settings.set('severity', state.severity);
  applyFilter();
}

export function setQuery(q) {
  state.query = String(q ?? '');
  applyFilter();
}

export function setUseRegex(on) {
  state.useRegex = Boolean(on);
  settings.set('useRegex', state.useRegex);
  applyFilter();
}

export function setTail(on) {
  state.tail = Boolean(on);
  settings.set('tail', state.tail);
  refreshChrome();
  syncWatcher();
  if (state.tail && state.filtered.length > 0) {
    list.scrollToIndex(state.filtered.length - 1);
  }
}

export async function setRoot(rootDir) {
  sources.stopWatch();
  sources.setRoot(rootDir);
  state.activeSourceId = '';
  await discoverSources({ selectDefault: true });
}

export async function openLogFile(filePath) {
  if (!filePath) return null;
  const src = await sources.addOpenedFile(filePath);
  if (!src) {
    toast(`Could not open log file: ${filePath}`, { error: true });
    return null;
  }
  drawSidebar();
  await selectSource(src.id, { reload: false });
  return src;
}

async function pickLogFile() {
  const picked = typeof showOpenFileDialog === 'function'
    ? showOpenFileDialog('Log Files|log;jsonl;txt', false)
    : [];
  if (picked && picked.length) {
    await openLogFile(picked[0]);
  }
}

export async function refresh() {
  if (!state.activeSourceId) {
    await discoverSources({ selectDefault: true });
    return;
  }
  await selectSource(state.activeSourceId, { reload: true });
}

function clearView() {
  state.entries = [];
  state.filtered = [];
  showDrawer(null);
  list.setItems([]);
  refreshChrome();
  updateStatus();
}

async function copySelectedEntries() {
  const items = list.selectedItems();
  const target = items.length ? items : (state.selectedEntry ? [state.selectedEntry] : []);
  if (!target.length) return;
  const text = target.map((e) => e.raw).join('\n');
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
    }
    toast(target.length === 1 ? 'Copied log entry' : `Copied ${target.length} log entries`, { icon: 'copy', key: 'copy' });
  } catch (_) {
    toast('Copied log entry', { icon: 'copy', key: 'copy' });
  }
}

export async function exportFiltered(targetPath) {
  let outPath = targetPath;
  if (!outPath && typeof showSaveFileDialog === 'function') {
    outPath = showSaveFileDialog('Log Files|log;txt;jsonl', 'filtered.log');
  }
  if (!outPath) return false;
  const resolved = path.resolve(outPath);
  const content = state.filtered.map((e) => e.raw).join('\n') + (state.filtered.length ? '\n' : '');
  try {
    await fs.promises.writeFile(resolved, content, 'utf8');
    toast(`Exported ${formatCount(state.filtered.length, 'entry', 'entries')} to ${path.basename(resolved)}`, {
      icon: 'download',
      key: 'export',
    });
    return true;
  } catch (err) {
    toast(`Could not export: ${err.message}`, { error: true });
    return false;
  }
}

function entryContextMenu(e, items) {
  menu.show([
    items.length ? commands.item('copy-entry') : null,
    commands.item('export-filtered'),
    { separator: true },
    commands.item('toggle-tail'),
    commands.item('clear-view'),
    commands.item('refresh'),
  ], e.clientX, e.clientY);
}

function sourceContextMenu(e, item) {
  if (!item || item.id === 'empty') return;
  menu.show([
    { heading: item.label },
    commands.item('refresh'),
    commands.item('toggle-tail'),
    commands.item('export-filtered'),
  ], e.clientX, e.clientY);
}

// ---- launch -----------------------------------------------------------------

discoverSources({ selectDefault: true });

app.onLaunch(({ argv, cwd, first }) => {
  if (argv.includes('--new-window') && !first) {
    app.newWindow();
    return;
  }
  const target = argv.find((a) => !a.startsWith('--'));
  if (target) {
    openLogFile(path.resolve(cwd || '.', target));
  }
});

app.expose({
  state,
  list,
  sidebar,
  sources,
  drawer,
  openLogFile,
  selectSource,
  setRoot,
  setSeverity,
  setQuery,
  setUseRegex,
  setTail,
  exportFiltered,
  refresh,
  clearView,
  parsers: {
    normalizeSeverity,
    severityBadgeText,
    parseLogLine,
    parseLogText,
    filterLogEntries,
  },
});
