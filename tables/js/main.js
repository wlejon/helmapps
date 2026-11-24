/**
 * Tables Workbench (helm.tables):
 * Inspect, filter, sort, group, profile, and export .brotable, Parquet, and CSV/TSV files.
 */

import { startApp } from '/lib/app.js';
import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { toast } from '/lib/toast.js';
import { formatCount, formatNumber } from '/lib/format.js';
import { MAX_DISPLAY_ROWS, TableSession, isNumericColType } from './table-session.js';
import { drawProfileChart } from './charts.js';

const path = require('path');

const app = startApp({
  settings: {
    lastFile: { type: 'string', default: '' },
    showProfiler: { type: 'bool', default: true },
  },
});
const { commands, settings } = app;
const session = new TableSession();

const state = {
  filterCol: '',
  filterOp: 'contains',
  filterVal: '',
  sortCol: '',
  sortDir: 'asc',
  groupCol: '',
  aggCol: '',
  profileCol: '',
  showProfiler: settings.get('showProfiler') !== false,
  displayedRows: 0,
};

// ---- frame & chrome (built synchronously before disk I/O) ------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const sidebar = new Sidebar({
  onSelect: (item) => {
    if (item.id.startsWith('tbl:')) {
      selectBundleTable(item.id.slice(4));
    } else if (item.id.startsWith('col:')) {
      selectColumn(item.id.slice(4));
    }
  },
});
ui.sidebar.appendChild(sidebar.el);

// Filter / group bar
const filterColSelect = h('select.tbl-select', { 'aria-label': 'Filter column' });
const filterOpSelect = h('select.tbl-select', { 'aria-label': 'Filter operator' },
  h('option', { value: 'contains' }, 'contains'),
  h('option', { value: 'eq' }, '='),
  h('option', { value: 'ne' }, '!='),
  h('option', { value: 'gt' }, '>'),
  h('option', { value: 'ge' }, '>='),
  h('option', { value: 'lt' }, '<'),
  h('option', { value: 'le' }, '<='));
const filterValInput = h('input.tbl-input', {
  type: 'text',
  placeholder: 'Filter value…',
  'aria-label': 'Filter value',
});
const groupColSelect = h('select.tbl-select', { 'aria-label': 'Group by column' });
const aggColSelect = h('select.tbl-select', { 'aria-label': 'Aggregate column' });
const clearFilterBtn = h('button.btn.small', {
  onclick: () => clearFilter(),
}, 'Reset');

filterColSelect.addEventListener('change', () => {
  state.filterCol = filterColSelect.value;
  if (state.filterVal) applyQueryAndRender();
});
filterOpSelect.addEventListener('change', () => {
  state.filterOp = filterOpSelect.value;
  if (state.filterVal) applyQueryAndRender();
});
filterValInput.addEventListener('input', () => {
  state.filterVal = filterValInput.value;
  applyQueryAndRender();
});
groupColSelect.addEventListener('change', () => setGroupBy(groupColSelect.value, aggColSelect.value));
aggColSelect.addEventListener('change', () => setGroupBy(groupColSelect.value, aggColSelect.value));

const filterBar = h('div.tbl-filter-bar',
  h('div.tbl-filter-group', h('span.tbl-label', 'Where'), filterColSelect, filterOpSelect, filterValInput),
  h('div.tbl-filter-group', h('span.tbl-label', 'Group'), groupColSelect, h('span.tbl-label', 'Agg'), aggColSelect),
  clearFilterBtn);

const gridWrap = h('div.tbl-grid-wrap');
const emptyView = emptyState({
  icon: 'layers',
  title: 'Open a table to inspect',
  hint: 'Supports .brotable (v1-v4 + bundles), .parquet, .csv, and .tsv datasets.',
});

// Column profiler drawer
const profTitle = h('span.title', 'Column Profile');
const profTypeBadge = h('span.tbl-badge', '');
const profExplainText = h('span.dim.num.ellipsis', '');
const profCloseBtn = h('button.icon-btn.small', {
  'aria-label': 'Hide Profiler',
  onclick: () => toggleProfiler(false),
}, icon('x'));
const profStatsEl = h('div.tbl-profiler-stats');
const profCanvas = h('canvas.tbl-canvas');
const profWrap = h('div.tbl-profiler.hidden',
  h('div.tbl-profiler-head', profTitle, profTypeBadge, profExplainText, h('span.grow'), profCloseBtn),
  h('div.tbl-profiler-body', profStatsEl, h('div.tbl-canvas-wrap', profCanvas)));

ui.content.append(h('div.tbl-main', filterBar, emptyView, gridWrap, profWrap));

const statusLeft = h('span.grow.num', 'Ready');
const statusRight = h('span.dim.num', '');
ui.statusbar.append(statusLeft, statusRight);

let activeList = null;

// ---- commands ---------------------------------------------------------------

commands.addAll([
  { id: 'open-file', label: 'Open Dataset…', icon: 'folder-open', keys: ['Mod+O'],
    run: (arg) => (typeof arg === 'string' && arg ? openFile(arg) : pickOpenFile()) },
  { id: 'toggle-profiler', label: 'Profiler', icon: 'bar-chart', keys: ['Mod+P'],
    checked: () => state.showProfiler,
    run: () => toggleProfiler(!state.showProfiler) },
  { id: 'export-brotable', label: 'Save .brotable…', icon: 'layers',
    enabled: () => !!(session.viewTable || session.source),
    run: (p) => exportFile(typeof p === 'string' ? p : undefined, 'brotable') },
  { id: 'export-parquet', label: 'Export Parquet…', icon: 'file-text',
    enabled: () => !!(session.viewTable || session.source),
    run: (p) => exportFile(typeof p === 'string' ? p : undefined, 'parquet') },
  { id: 'export-csv', label: 'Export CSV…', icon: 'download', keys: ['Mod+S'],
    enabled: () => !!(session.viewTable || session.source),
    run: (p) => exportFile(typeof p === 'string' ? p : undefined, 'csv') },
  { id: 'clear-filter', label: 'Reset Query', icon: 'refresh', keys: ['Escape'],
    enabled: () => !!(state.filterVal || state.groupCol || state.sortCol),
    run: () => clearFilter() },
  { id: 'new-window', label: 'New Window', keys: ['Mod+N'], run: () => app.newWindow() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

toolbar.button('open-file', { label: true });
toolbar.sep();
toolbar.button('toggle-profiler', { label: true });
toolbar.spacer();
toolbar.button('export-brotable', { label: true });
toolbar.button('export-parquet', { label: true });
toolbar.button('export-csv');

// ---- helpers ----------------------------------------------------------------

function formatCellValue(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : Number(v.toFixed(4)).toString();
  }
  return String(v);
}

function rebuildControlsForSource() {
  const cols = session.sourceSchema();
  const fPrev = state.filterCol;
  const gPrev = state.groupCol;
  const aPrev = state.aggCol;

  filterColSelect.replaceChildren(
    ...cols.map((c) => h('option', { value: c.name }, `${c.name} (${c.type})`)),
  );
  if (cols.length > 0) {
    state.filterCol = cols.some((c) => c.name === fPrev) ? fPrev : cols[0].name;
    filterColSelect.value = state.filterCol;
  } else {
    state.filterCol = '';
  }

  groupColSelect.replaceChildren(
    h('option', { value: '' }, '(none)'),
    ...cols.map((c) => h('option', { value: c.name }, c.name)),
  );
  state.groupCol = cols.some((c) => c.name === gPrev) ? gPrev : '';
  groupColSelect.value = state.groupCol;

  const numCols = cols.filter((c) => isNumericColType(c.type));
  aggColSelect.replaceChildren(
    h('option', { value: '' }, 'COUNT(*)'),
    ...numCols.map((c) => h('option', { value: c.name }, c.name)),
  );
  state.aggCol = numCols.some((c) => c.name === aPrev) ? aPrev : '';
  aggColSelect.value = state.aggCol;
}

function buildGridForViewSchema() {
  const cols = session.schema();
  const listCols = cols.map((c, idx) => ({
    id: c.name,
    label: c.name,
    width: cols.length <= 5 ? Math.max(130, Math.floor(760 / Math.max(1, cols.length))) : 140,
    flex: idx === cols.length - 1 ? 1 : 0,
    minWidth: 80,
    align: isNumericColType(c.type) ? 'right' : 'left',
    sortable: true,
    cell: (row) => h('span.num.ellipsis', formatCellValue(row[c.name])),
  }));

  activeList = new VirtualList({
    layout: 'list',
    rowHeight: 30,
    key: (r) => r._rowIdx,
    label: (r) => String(r[cols[0]?.name || '_rowIdx'] ?? ''),
    columns: listCols,
    sort: state.sortCol ? { id: state.sortCol, dir: state.sortDir === 'desc' ? -1 : 1 } : null,
    onSort: (colId, dir) => setSort(colId, dir === -1 ? 'desc' : 'asc'),
    empty: emptyState({ icon: 'search', title: 'No matching rows', hint: 'Try clearing or adjusting the filter.' }),
  });
  gridWrap.replaceChildren(activeList.el);
  app.list = activeList;
}

function renderSidebar() {
  const info = session.info();
  const sections = [];
  if (info.bundleNames.length > 0) {
    sections.push({
      title: 'Bundle Tables',
      items: info.bundleNames.map((n) => ({
        id: `tbl:${n}`,
        label: n,
        icon: 'layers',
      })),
    });
  }
  const srcCols = session.sourceSchema();
  if (srcCols.length > 0) {
    sections.push({
      title: 'Schema Columns',
      items: srcCols.map((c) => ({
        id: `col:${c.name}`,
        label: c.name,
        sub: c.type,
        icon: isNumericColType(c.type) ? 'hash' : 'tag',
      })),
    });
  }
  sidebar.setSections(sections);
  if (state.profileCol && srcCols.some((c) => c.name === state.profileCol)) {
    sidebar.select(`col:${state.profileCol}`);
  } else if (info.activeBundleName) {
    sidebar.select(`tbl:${info.activeBundleName}`);
  }
}

function renderProfiler() {
  const viewCols = session.schema();
  const hasSource = !!session.source;
  if (!hasSource || !state.showProfiler) {
    profWrap.classList.add('hidden');
    return;
  }
  if (!state.profileCol || !viewCols.some((c) => c.name === state.profileCol)) {
    state.profileCol = viewCols.length ? viewCols[0].name : '';
  }
  if (!state.profileCol) {
    profWrap.classList.add('hidden');
    return;
  }

  profWrap.classList.remove('hidden');
  const prof = session.profileColumn(state.profileCol);
  profTitle.textContent = `Column: ${prof.column}`;
  profTypeBadge.textContent = prof.type || 'unknown';

  const ex = session.explain;
  profExplainText.textContent = ex
    ? `${ex.strategy} • simd=${ex.willUseSimd ? ex.simdWidth + 'b' : 'off'} • idx=${ex.willUseIndex || ex.willUseRangeIndex}`
    : '';

  const rows = [
    h('div.tbl-stat-row', h('span.dim', 'Rows'), h('span.num', formatNumber(prof.count))),
  ];
  if (prof.stats) {
    rows.push(
      h('div.tbl-stat-row', h('span.dim', 'Non-Null'), h('span.num', formatNumber(prof.stats.count))),
      h('div.tbl-stat-row', h('span.dim', 'Min'), h('span.num', formatCellValue(prof.stats.min))),
      h('div.tbl-stat-row', h('span.dim', 'Max'), h('span.num', formatCellValue(prof.stats.max))),
      h('div.tbl-stat-row', h('span.dim', 'Avg'), h('span.num', formatCellValue(prof.stats.avg))),
    );
  } else {
    rows.push(
      h('div.tbl-stat-row', h('span.dim', 'Top Buckets'), h('span.num', String(prof.buckets.length))),
    );
  }
  profStatsEl.replaceChildren(...rows);
  drawProfileChart(profCanvas, prof);
}

function updateStatus() {
  const info = session.info();
  if (!session.source) {
    statusLeft.textContent = 'No dataset open';
    statusRight.textContent = session.supported ? 'bro.table ready' : 'bro.table unavailable';
    return;
  }
  const view = session.viewTable || session.source;
  const shownNote = info.viewRows > MAX_DISPLAY_ROWS
    ? ` (showing first ${formatNumber(MAX_DISPLAY_ROWS)})`
    : '';
  const namePrefix = info.activeBundleName ? `${info.fileName}:${info.activeBundleName}` : info.fileName;
  statusLeft.textContent = `${namePrefix} — ${formatCount(info.viewRows, 'row')} × ${formatCount(info.columnCount, 'col')}${shownNote}`;
  const ex = info.explain;
  const strat = ex && ex.strategy ? ` • ${ex.strategy}` : '';
  statusRight.textContent = `${info.formatLabel}${strat} • ${info.queryMs.toFixed(1)} ms`;
  void view;
}

function applyQueryAndRender() {
  if (!session.source) {
    emptyView.classList.remove('hidden');
    gridWrap.classList.add('hidden');
    profWrap.classList.add('hidden');
    toolbar.refresh();
    updateStatus();
    return;
  }
  emptyView.classList.add('hidden');
  gridWrap.classList.remove('hidden');

  const prevColsKey = session.schema().map((c) => `${c.name}:${c.type}`).join('|');
  session.applyQuery({
    filterCol: state.filterCol,
    filterOp: state.filterOp,
    filterVal: state.filterVal,
    sortCol: state.sortCol,
    sortDir: state.sortDir,
    groupCol: state.groupCol,
    aggCol: state.aggCol,
  });
  const nextColsKey = session.schema().map((c) => `${c.name}:${c.type}`).join('|');
  if (!activeList || prevColsKey !== nextColsKey) {
    buildGridForViewSchema();
  }
  const rows = session.displayRows({ offset: 0, limit: MAX_DISPLAY_ROWS });
  state.displayedRows = rows.length;
  if (activeList) activeList.setItems(rows);

  renderSidebar();
  renderProfiler();
  toolbar.refresh();
  updateStatus();
}

// ---- public / command API ---------------------------------------------------

export function openFile(filePath) {
  if (!filePath) return null;
  try {
    const info = session.openFile(filePath);
    state.filterVal = '';
    filterValInput.value = '';
    state.sortCol = '';
    state.groupCol = '';
    state.profileCol = info.columnCount > 0 ? session.schema()[0].name : '';
    settings.set('lastFile', info.filePath);
    app.setTitle(info.fileName);
    rebuildControlsForSource();
    buildGridForViewSchema();
    applyQueryAndRender();
    return info;
  } catch (err) {
    toast(`Could not open ${path.basename(filePath)}: ${err.message || err}`, { error: true });
    return null;
  }
}

export function selectBundleTable(name) {
  if (!session.selectBundleTable(name)) return false;
  state.filterVal = '';
  filterValInput.value = '';
  state.sortCol = '';
  state.groupCol = '';
  const sc = session.schema();
  state.profileCol = sc.length ? sc[0].name : '';
  rebuildControlsForSource();
  buildGridForViewSchema();
  applyQueryAndRender();
  return true;
}

export function setFilter(col, op, val) {
  if (col != null) {
    state.filterCol = String(col);
    filterColSelect.value = state.filterCol;
  }
  if (op != null) {
    state.filterOp = String(op);
    filterOpSelect.value = state.filterOp;
  }
  if (val != null) {
    state.filterVal = String(val);
    filterValInput.value = state.filterVal;
  }
  applyQueryAndRender();
}

export function clearFilter() {
  state.filterVal = '';
  filterValInput.value = '';
  state.sortCol = '';
  state.groupCol = '';
  groupColSelect.value = '';
  applyQueryAndRender();
}

export function setSort(col, dir = 'asc') {
  state.sortCol = col || '';
  state.sortDir = dir === 'desc' ? 'desc' : 'asc';
  applyQueryAndRender();
}

export function setGroupBy(groupCol, aggCol = '') {
  state.groupCol = groupCol || '';
  state.aggCol = aggCol || '';
  groupColSelect.value = state.groupCol;
  aggColSelect.value = state.aggCol;
  state.sortCol = '';
  applyQueryAndRender();
}

export function selectColumn(colName) {
  state.profileCol = colName || '';
  state.showProfiler = true;
  settings.set('showProfiler', true);
  renderSidebar();
  renderProfiler();
  toolbar.refresh();
}

export function toggleProfiler(on) {
  state.showProfiler = !!on;
  settings.set('showProfiler', state.showProfiler);
  renderProfiler();
  toolbar.refresh();
}

export function profileColumn(colName) {
  return session.profileColumn(colName);
}

let pickingOpen = false;
async function pickOpenFile() {
  if (pickingOpen) return;
  pickingOpen = true;
  try {
    let picked = [];
    if (typeof showOpenFileDialogAsync === 'function') {
      picked = await showOpenFileDialogAsync('Data Tables|brotable;parquet;csv;tsv', false);
    } else if (typeof showOpenFileDialog === 'function') {
      picked = showOpenFileDialog('Data Tables|brotable;parquet;csv;tsv', false);
    }
    if (picked && picked.length) openFile(picked[0]);
  } finally {
    pickingOpen = false;
  }
}

export async function exportFile(targetPath, format = 'brotable') {
  let outPath = targetPath;
  const defaultName = format === 'parquet' ? 'table.parquet' : (format === 'csv' ? 'table.csv' : 'table.brotable');
  const filter = format === 'parquet' ? 'Parquet|parquet' : (format === 'csv' ? 'CSV|csv' : 'BroTable|brotable');
  if (!outPath) {
    if (typeof showSaveFileDialogAsync === 'function') {
      outPath = await showSaveFileDialogAsync(filter, defaultName);
    } else if (typeof showSaveFileDialog === 'function') {
      outPath = showSaveFileDialog(filter, defaultName);
    }
  }
  if (!outPath) return false;
  try {
    const ok = session.exportAs(outPath, format, { compress: true });
    if (ok) toast(`Saved ${path.basename(outPath)}`, { icon: 'download', key: 'export' });
    return ok;
  } catch (err) {
    toast(`Export failed: ${err.message || err}`, { error: true });
    return false;
  }
}

// ---- startup ----------------------------------------------------------------

applyQueryAndRender();

app.onLaunch(({ argv, cwd, first }) => {
  if (argv && argv.includes('--new-window') && !first) {
    app.newWindow();
    return;
  }
  const target = (argv || []).find((a) => !a.startsWith('--'));
  if (target) {
    openFile(path.resolve(cwd || '.', target));
  }
});

app.expose({
  session,
  state,
  list: activeList,
  openFile,
  selectBundleTable,
  setFilter,
  clearFilter,
  setSort,
  setGroupBy,
  selectColumn,
  toggleProfiler,
  profileColumn,
  exportFile,
});
