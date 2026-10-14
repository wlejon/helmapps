/**
 * Character Map (helm.charmap): Browse and copy Unicode characters, symbols,
 * blocks, and encodings (UTF-8, UTF-16, HTML entities, CSS & JS escapes).
 */

import { startApp } from '/lib/app.js';
import { h, clamp } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, SplitPane, emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { Slider, Segmented } from '/lib/controls.js';
import { formatCount, formatNumber } from '/lib/format.js';
import * as unicode from './unicode-data.js';
import { Inspector } from './inspector.js';

const {
  UNICODE_BLOCKS,
  TOTAL_CHAR_COUNT,
  getBlockById,
  getCharEntry,
  getBlockChars,
  getEncodings,
  searchCharacters,
} = unicode;

const MAX_RECENT = 64;

const app = startApp({
  settings: {
    favorites: { type: 'json', default: [0x2192, 0x221E, 0x20AC, 0x03BB, 0x2713, 0x00A9] },
    recent: { type: 'json', default: [] },
    zoom: { type: 'int', default: 68, min: 48, max: 120 },
    view: { type: 'string', default: 'grid' },
    lastBlock: { type: 'string', default: 'arrows' },
    showInspector: { type: 'bool', default: true },
    inspectorWidth: { type: 'int', default: 310, min: 240, max: 520 },
    columns: { type: 'json', default: {} },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  blockId: settings.get('lastBlock') || 'arrows',
  query: '',
  view: settings.get('view') === 'list' ? 'list' : 'grid',
  zoom: clamp(Number(settings.get('zoom')) || 68, 48, 120),
  showInspector: !!settings.get('showInspector'),
  favorites: Array.isArray(settings.get('favorites')) ? settings.get('favorites') : [],
  recent: Array.isArray(settings.get('recent')) ? settings.get('recent') : [],
  selectedCp: null,
  buffer: '',
  lastCopied: '',
  sort: { id: 'codepoint', dir: 1 },
};
const favSet = new Set(state.favorites);

// ---- window & chrome --------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const sidebar = new Sidebar({ onSelect: (item) => selectBlock(item.id) });
ui.sidebar.appendChild(sidebar.el);

// Block header bar above the list/grid
const blockTitleEl = h('span.title');
const blockRangeEl = h('span.cm-block-range');
const blockCountEl = h('span.dim.num');
const blockBar = h('div.cm-block-bar',
  h('div.cm-block-info', blockTitleEl, blockRangeEl),
  blockCountEl
);

// Grid cell renderer — reuses internal child nodes across scroll & block switches
function renderGridCell(item, el) {
  const isFav = favSet.has(item.cp);
  const glyphText = item.cp === 0x0020 ? '␣' : item.char;
  if (!el._cellEl || el.firstElementChild !== el._cellEl) {
    const favEl = h('span.cm-cell-fav.hidden');
    const glyphEl = h('div.cm-cell-glyph');
    const codeEl = h('div.cm-cell-code.num');
    const cellEl = h('div.cm-cell', favEl, glyphEl, codeEl);
    el._cellEl = cellEl;
    el._favEl = favEl;
    el._glyphEl = glyphEl;
    el._codeEl = codeEl;
    el.replaceChildren(cellEl);
  }
  el._cellEl.dataset.cp = String(item.cp);
  el._favEl.classList.toggle('hidden', !isFav);
  el._glyphEl.textContent = glyphText;
  el._codeEl.textContent = item.codepoint;
}

const emptyView = emptyState({
  icon: 'search',
  title: 'No matching characters',
  hint: 'Try searching by character name, keyword, or hex codepoint (such as U+2192).',
});

// Construct with layout: 'list' so VirtualList initializes its column header,
// then immediately apply the active layout ('grid' or 'list').
const list = new VirtualList({
  layout: 'list',
  rowHeight: 34,
  cellWidth: state.zoom,
  cellHeight: state.zoom,
  gap: 6,
  padding: 10,
  key: (it) => it.cp,
  label: (it) => it.name,
  sort: state.sort,
  columns: [
    { id: 'glyph', label: 'Glyph', width: 64, resizable: false,
      cell: (it) => h('span.cm-list-glyph', it.cp === 0x0020 ? '␣' : it.char) },
    { id: 'codepoint', label: 'Codepoint', width: 96, sortable: true,
      cell: (it) => h('span.mono.num', it.codepoint) },
    { id: 'name', label: 'Name', flex: 1, minWidth: 160, sortable: true,
      cell: (it) => [
        favSet.has(it.cp) ? h('span.cm-list-fav', icon('star', 'sm')) : null,
        h('span.ellipsis', it.name),
      ] },
    { id: 'block', label: 'Block', width: 150, sortable: true,
      cell: (it) => h('span.dim.ellipsis', it.blockName) },
    { id: 'utf8', label: 'UTF-8', width: 112,
      cell: (it) => h('span.mono.dim.num', it.utf8) },
  ],
  columnWidths: settings.get('columns'),
  onColumnResize: (w) => settings.set('columns', w),
  onSort: (id, dir) => { state.sort = { id, dir }; refreshCharacters(); },
  onActivate: (items) => { if (items[0]) activateChar(items[0]); },
  onContextMenu: (e, items) => showContextMenu(e, items),
  onSelectionChange: (items) => onSelectItems(items),
  empty: emptyView,
});

list.o.render = state.view === 'grid' ? renderGridCell : null;
list.setLayout(state.view, { cellWidth: state.zoom, cellHeight: state.zoom });

// Copy Buffer bar at the bottom of the main pane
const bufferInput = h('input.field.cm-buffer-input', {
  type: 'text',
  placeholder: 'Assemble characters here (double-click or press Enter on any glyph)…',
  'aria-label': 'Copy Buffer',
  oninput: () => {
    state.buffer = bufferInput.value;
    updateBufferChrome();
  },
});
const bufferCountEl = h('span.cm-buffer-count.num', '0 chars');
const copyBufferBtn = h('button.btn.primary.cm-copy-buffer-btn', {
  'data-tip': 'Copy Buffer',
  'data-keys': 'Mod+Shift+C',
  onclick: () => commands.run('copy-buffer'),
}, icon('copy'), 'Copy Buffer');
const clearBufferBtn = h('button.btn.cm-clear-buffer-btn', {
  'data-tip': 'Clear Buffer',
  onclick: () => commands.run('clear-buffer'),
}, 'Clear');

const bufferBar = h('div.cm-buffer-bar',
  h('span.cm-buffer-label', 'Buffer'),
  bufferInput,
  bufferCountEl,
  copyBufferBtn,
  clearBufferBtn
);

const mainPane = h('div.cm-main-pane', blockBar, list.el, bufferBar);

const inspector = new Inspector({
  onCopyValue: (val, label) => copyValue(val, label),
  onCopyChar: (entry) => copyChar(entry),
  onAppendChar: (entry) => appendToBuffer(entry),
  onToggleFavorite: (cp) => toggleFavorite(cp),
  onSelectChar: (cp) => selectCodepoint(cp, { switchBlock: true }),
});

const split = new SplitPane({
  fixed: 'second',
  size: settings.get('inspectorWidth') || 310,
  min: 240,
  max: 520,
  onResize: (px) => settings.set('inspectorWidth', px),
});
split.first.appendChild(mainPane);
split.second.appendChild(inspector.el);
split.setCollapsed(!state.showInspector);
ui.content.appendChild(split.el);

// Status bar
const statusLeft = h('span.grow');
const statusRight = h('span.num.dim');
// Pre-warm system fallback font faces (Segoe UI Symbol / Emoji / Noto) on the first frame
// so switching to symbol, braille, or emoji blocks never triggers a cold DirectWrite font load mid-scroll.
const fontWarmup = h('span', {
  'aria-hidden': 'true',
  style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', opacity: '0.01', pointerEvents: 'none', fontSize: '26px' },
}, 'A Ω Я → ∞ ⌘ ─ ▀ ■ ★ ✓ ⠁ ⤊ ' + getBlockChars('emoticons').map((x) => x.char).join(''));
ui.statusbar.append(statusLeft, statusRight, fontWarmup);

// ---- commands ---------------------------------------------------------------

const currentEntry = () => inspector.current || list.selectedItems()[0] || null;

commands.addAll([
  { id: 'find', label: 'Find Character', icon: 'search', keys: ['Mod+F'], inText: true,
    run: () => { searchInput.focus(); searchInput.select(); } },
  { id: 'clear-search', label: 'Clear Search', icon: 'x', keys: ['Escape'], inText: true,
    enabled: () => state.query.length > 0,
    run: () => setSearch('') },
  { id: 'copy-char', label: 'Copy Character', icon: 'copy', keys: ['Mod+C'],
    enabled: () => !!currentEntry(),
    run: () => copyChar(currentEntry()) },
  { id: 'copy-codepoint', label: 'Copy Codepoint', icon: 'hash', keys: ['Mod+Alt+C'],
    enabled: () => !!currentEntry(),
    run: () => { const e = currentEntry(); if (e) copyValue(e.codepoint, 'Codepoint'); } },
  { id: 'copy-utf8', label: 'Copy UTF-8 Bytes', icon: 'code',
    enabled: () => !!currentEntry(),
    run: () => { const e = currentEntry(); if (e) copyValue(e.utf8, 'UTF-8 Bytes'); } },
  { id: 'copy-html', label: 'Copy HTML Entity', icon: 'code',
    enabled: () => !!currentEntry(),
    run: () => {
      const e = currentEntry();
      if (e) {
        const enc = getEncodings(e.cp);
        copyValue(enc.htmlNamed || enc.htmlHex, 'HTML Entity');
      }
    } },
  { id: 'append-buffer', label: 'Append to Buffer', icon: 'plus',
    enabled: () => !!currentEntry(),
    run: () => appendToBuffer(currentEntry()) },
  { id: 'copy-buffer', label: 'Copy Buffer', icon: 'clipboard', keys: ['Mod+Shift+C', 'Mod+Shift+B'], inText: true,
    enabled: () => state.buffer.length > 0,
    run: () => copyBuffer() },
  { id: 'clear-buffer', label: 'Clear Buffer', icon: 'trash',
    enabled: () => state.buffer.length > 0,
    run: () => clearBuffer() },
  { id: 'toggle-favorite', label: 'Toggle Favorite', icon: 'star', keys: ['Mod+D'],
    enabled: () => !!currentEntry(),
    checked: () => { const e = currentEntry(); return !!e && favSet.has(e.cp); },
    run: () => { const e = currentEntry(); if (e) toggleFavorite(e.cp); } },
  { id: 'view-grid', label: 'Grid View', icon: 'grid', keys: ['Mod+1'],
    checked: () => state.view === 'grid',
    run: () => setView('grid') },
  { id: 'view-list', label: 'List View', icon: 'list', keys: ['Mod+2'],
    checked: () => state.view === 'list',
    run: () => setView('list') },
  { id: 'zoom-in', label: 'Zoom In', icon: 'zoom-in', keys: ['Mod+='],
    enabled: () => state.view === 'grid' && state.zoom < 120,
    run: () => setZoom(state.zoom + 8) },
  { id: 'zoom-out', label: 'Zoom Out', icon: 'zoom-out', keys: ['Mod+-'],
    enabled: () => state.view === 'grid' && state.zoom > 48,
    run: () => setZoom(state.zoom - 8) },
  { id: 'toggle-inspector', label: 'Toggle Inspector', icon: 'sidebar', keys: ['Mod+I'], inText: true,
    checked: () => state.showInspector,
    run: () => setInspectorVisible(!state.showInspector) },
  { id: 'new-window', label: 'New Window', keys: ['Mod+N'], inText: true, run: () => app.newWindow() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], inText: true, run: () => app.quit() },
]);

// ---- toolbar controls -------------------------------------------------------

const searchInput = h('input', {
  type: 'text',
  placeholder: 'Search name, symbol, or U+hex…',
  'aria-label': 'Search characters',
  oninput: () => setSearch(searchInput.value),
});
const searchClearBtn = h('button.icon-btn.small.hidden', {
  'aria-label': 'Clear search',
  'data-tip': 'Clear Search',
  onclick: () => setSearch(''),
}, icon('x', 'sm'));
const searchField = h('div.search-field', icon('search'), searchInput, searchClearBtn);

const zoomSlider = new Slider({
  min: 48,
  max: 120,
  step: 8,
  value: state.zoom,
  onInput: (v) => setZoom(v, { persist: false }),
  onChange: (v) => setZoom(v, { persist: true }),
});
const zoomControl = h('div.cm-toolbar-zoom',
  icon('zoom-out', 'sm'),
  zoomSlider.el,
  icon('zoom-in', 'sm')
);

const viewSwitch = new Segmented({
  options: [
    { value: 'grid', icon: 'grid', title: 'Grid View (Ctrl+1)' },
    { value: 'list', icon: 'list', title: 'List View (Ctrl+2)' },
  ],
  value: state.view,
  onChange: (v) => setView(v),
});

toolbar.add(searchField);
toolbar.spacer();
toolbar.add(zoomControl);
toolbar.sep();
toolbar.add(viewSwitch.el);
toolbar.sep();
toolbar.button('toggle-favorite');
toolbar.button('toggle-inspector');

// ---- sidebar & rendering ----------------------------------------------------

function drawSidebar() {
  const collections = [
    { id: 'favorites', label: 'Favorites', icon: 'star', count: state.favorites.length },
    { id: 'recent', label: 'Recently Copied', icon: 'history', count: state.recent.length },
    { id: 'all', label: 'All Characters', icon: 'apps', count: TOTAL_CHAR_COUNT },
  ];
  const blocks = UNICODE_BLOCKS.map((b) => ({
    id: b.id,
    label: b.name,
    icon: b.icon,
    count: b.count,
    title: `${b.name} (${b.rangeLabel})`,
  }));
  sidebar.setSections([
    { title: 'Collections', items: collections },
    { title: 'Unicode Blocks', items: blocks },
  ]);
  sidebar.select(state.blockId);
}

function updateSidebarCounts() {
  const favRow = sidebar.rows.get('favorites');
  if (favRow) {
    const c = favRow.querySelector('.count');
    if (c) c.textContent = String(state.favorites.length);
  }
  const recRow = sidebar.rows.get('recent');
  if (recRow) {
    const c = recRow.querySelector('.count');
    if (c) c.textContent = String(state.recent.length);
  }
}

function applyZoomStyle() {
  const glyphPx = Math.round(state.zoom * 0.38);
  list.el.style.setProperty('--cm-glyph-size', `${glyphPx}px`);
  zoomControl.classList.toggle('hidden', state.view !== 'grid');
}

function sortItems(items) {
  if (state.view !== 'list' || state.query) return items;
  const { id, dir } = state.sort;
  if (id === 'codepoint' && dir === 1) return items;
  return items.slice().sort((a, b) => {
    let va, vb;
    if (id === 'name') { va = a.name; vb = b.name; }
    else if (id === 'block') { va = a.blockName; vb = b.blockName; }
    else { va = a.cp; vb = b.cp; }
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.cp - b.cp;
  });
}

let suppressSelectionEmit = false;

function refreshCharacters({ preserveSelection = true } = {}) {
  const filtered = state.query
    ? searchCharacters(state.query)
    : sortItems(getBlockChars(state.blockId, {
        favorites: state.favorites,
        recent: state.recent,
      }));

  let selectedEntry = null;
  if (filtered.length > 0) {
    const keepEntry = preserveSelection && state.selectedCp != null
      ? filtered.find((x) => x.cp === state.selectedCp)
      : null;
    selectedEntry = keepEntry || filtered[0];
    state.selectedCp = selectedEntry.cp;
    list.selection = new Set([selectedEntry.cp]);
    if (!preserveSelection) {
      if (list.scroller.scrollTop !== 0) list.scroller.scrollTop = 0;
      list.cursor = -1;
      list.anchor = -1;
    }
  } else {
    state.selectedCp = null;
    list.selection.clear();
    list.cursor = -1;
    list.anchor = -1;
  }

  // Call list.setItems(filtered) FIRST while the layout tree is clean, so
  // list.paint() reads clientWidth/clientHeight with zero forced layouts.
  suppressSelectionEmit = true;
  list.setItems(filtered);
  suppressSelectionEmit = false;
  if (filtered.length > 0 && list.cursor < 0) {
    list.cursor = 0;
    list.anchor = 0;
  }

  const blk = getBlockById(state.blockId) || getBlockById('all');
  blockTitleEl.textContent = state.query ? 'Search Results' : blk.name;
  blockRangeEl.textContent = state.query ? `“${state.query}”` : blk.rangeLabel;
  blockCountEl.textContent = `${formatNumber(filtered.length)} ${filtered.length === 1 ? 'character' : 'characters'}`;

  inspector.setChar(selectedEntry, selectedEntry ? favSet.has(selectedEntry.cp) : false);
  if (selectedEntry) {
    statusLeft.textContent = `${selectedEntry.codepoint} · ${selectedEntry.name} (${selectedEntry.blockName})`;
  } else {
    statusLeft.textContent = 'No character selected';
  }
  statusRight.textContent = `${formatCount(filtered.length, 'character')} shown`;
  toolbar.refresh();
}

function onSelectItems(items) {
  if (suppressSelectionEmit) return;
  const first = items[0] || null;
  if (first) {
    state.selectedCp = first.cp;
    inspector.setChar(first, favSet.has(first.cp));
  } else if (list.items.length === 0) {
    state.selectedCp = null;
    inspector.setChar(null, false);
  }
  updateStatus();
  toolbar.refresh();
}

function updateStatus() {
  const entry = currentEntry();
  const count = list.items.length;
  if (entry) {
    statusLeft.textContent = `${entry.codepoint} · ${entry.name} (${entry.blockName})`;
  } else {
    statusLeft.textContent = 'No character selected';
  }
  statusRight.textContent = `${formatCount(count, 'character')} shown`;
}

function updateBufferChrome() {
  const cpLen = Array.from(state.buffer).length;
  bufferCountEl.textContent = formatCount(cpLen, 'char');
  copyBufferBtn.disabled = cpLen === 0;
  clearBufferBtn.disabled = cpLen === 0;
  toolbar.refresh();
}

// ---- actions ----------------------------------------------------------------

function selectBlock(blockId) {
  if (!getBlockById(blockId)) blockId = 'all';
  state.blockId = blockId;
  const hadQuery = state.query.length > 0;
  if (hadQuery) state.query = '';
  refreshCharacters({ preserveSelection: false });
  if (hadQuery) {
    searchInput.value = '';
    searchClearBtn.classList.add('hidden');
  }
  sidebar.select(blockId);
  settings.set('lastBlock', blockId);
}

function selectCodepoint(cp, { switchBlock = false } = {}) {
  const n = Number(cp);
  const entry = getCharEntry(n);
  if (switchBlock && !list.index.has(n)) {
    if (state.query) setSearch('', { refresh: false });
    state.blockId = entry.blockId && getBlockById(entry.blockId) ? entry.blockId : 'all';
    refreshCharacters({ preserveSelection: false });
    sidebar.select(state.blockId);
  }
  state.selectedCp = n;
  list.select([n], { scroll: true });
}

function setSearch(q, { refresh = true } = {}) {
  const val = String(q || '');
  state.query = val;
  if (refresh) refreshCharacters({ preserveSelection: false });
  if (searchInput.value !== val) searchInput.value = val;
  searchClearBtn.classList.toggle('hidden', val.length === 0);
  toolbar.refresh();
}

function setView(mode) {
  const next = mode === 'list' ? 'list' : 'grid';
  state.view = next;
  settings.set('view', next);
  viewSwitch.set(next);
  applyZoomStyle();
  list.o.render = next === 'grid' ? renderGridCell : null;
  list.setLayout(next, { cellWidth: state.zoom, cellHeight: state.zoom });
  toolbar.refresh();
}

function setZoom(px, { persist = true } = {}) {
  const z = clamp(Math.round(Number(px) || 68), 48, 120);
  state.zoom = z;
  zoomSlider.set(z);
  applyZoomStyle();
  if (persist) settings.set('zoom', z);
  if (state.view === 'grid') {
    list.setLayout('grid', { cellWidth: z, cellHeight: z });
  }
  toolbar.refresh();
}

function setInspectorVisible(vis) {
  state.showInspector = !!vis;
  settings.set('showInspector', state.showInspector);
  split.setCollapsed(!state.showInspector);
  toolbar.refresh();
}

function recordRecent(cp) {
  const n = Number(cp);
  state.recent = [n, ...state.recent.filter((x) => x !== n)].slice(0, MAX_RECENT);
  settings.set('recent', state.recent);
  updateSidebarCounts();
}

async function writeClipboard(text) {
  state.lastCopied = String(text);
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(state.lastCopied);
    }
  } catch (_) {
    // Headless or restricted clipboard fallback kept in state.lastCopied
  }
}

async function copyValue(val, label = 'Value') {
  if (val == null) return;
  await writeClipboard(val);
  toast(`Copied ${label}: ${val}`, { icon: 'copy', key: 'charmap-copy' });
}

async function copyChar(entryOrCp) {
  const entry = typeof entryOrCp === 'number' ? getCharEntry(entryOrCp) : (entryOrCp || currentEntry());
  if (!entry) return;
  recordRecent(entry.cp);
  await writeClipboard(entry.char);
  toast(`Copied ${entry.char} (${entry.codepoint})`, { icon: 'copy', key: 'charmap-copy' });
}

function appendToBuffer(entryOrCp) {
  const entry = typeof entryOrCp === 'number' ? getCharEntry(entryOrCp) : (entryOrCp || currentEntry());
  if (!entry) return;
  state.buffer += entry.char;
  bufferInput.value = state.buffer;
  recordRecent(entry.cp);
  updateBufferChrome();
}

function setBuffer(text) {
  state.buffer = String(text || '');
  bufferInput.value = state.buffer;
  updateBufferChrome();
}

function clearBuffer() {
  setBuffer('');
}

async function copyBuffer() {
  if (!state.buffer) return;
  await writeClipboard(state.buffer);
  const cpLen = Array.from(state.buffer).length;
  toast(`Copied buffer (${formatCount(cpLen, 'character')})`, { icon: 'clipboard', key: 'charmap-copy' });
}

function activateChar(entry) {
  if (!entry) return;
  appendToBuffer(entry);
  copyChar(entry);
}

function isFavorite(cp) {
  return favSet.has(Number(cp));
}

function toggleFavorite(cp) {
  const n = Number(cp != null ? cp : (currentEntry() && currentEntry().cp));
  if (!n) return false;
  if (favSet.has(n)) {
    favSet.delete(n);
    state.favorites = state.favorites.filter((x) => x !== n);
  } else {
    favSet.add(n);
    state.favorites = [n, ...state.favorites.filter((x) => x !== n)];
  }
  settings.set('favorites', state.favorites);
  updateSidebarCounts();
  if (state.blockId === 'favorites') {
    refreshCharacters({ preserveSelection: true });
  } else {
    for (const el of list.pool.values()) {
      if (el._item && el._item.cp === n && el._favEl) {
        el._favEl.classList.toggle('hidden', !favSet.has(n));
      }
    }
    if (state.view === 'list') list.refresh();
  }
  if (inspector.current && inspector.current.cp === n) {
    inspector.setFavoriteState(favSet.has(n));
  }
  toolbar.refresh();
  return favSet.has(n);
}

function showContextMenu(e, items) {
  const entry = items[0] || currentEntry();
  if (!entry) return;
  menu.show([
    { heading: `${entry.char}  ${entry.codepoint} · ${entry.name}` },
    commands.item('copy-char'),
    commands.item('copy-codepoint'),
    commands.item('copy-utf8'),
    commands.item('copy-html'),
    { separator: true },
    commands.item('append-buffer'),
    commands.item('toggle-favorite', { label: favSet.has(entry.cp) ? 'Remove from Favorites' : 'Add to Favorites' }),
  ], e.clientX, e.clientY);
}

// ---- initial render & launch ------------------------------------------------

applyZoomStyle();
drawSidebar();
updateBufferChrome();
refreshCharacters({ preserveSelection: false });

app.onLaunch(({ argv, first }) => {
  if (argv && argv.includes('--new-window') && !first) {
    app.newWindow();
    return;
  }
  const qArg = argv && argv.find((a) => !a.startsWith('--'));
  if (qArg) setSearch(qArg);
});

app.expose({
  state,
  list,
  sidebar,
  inspector,
  split,
  searchInput,
  bufferInput,
  zoomSlider,
  viewSwitch,
  selectBlock,
  selectCodepoint,
  setSearch,
  setView,
  setZoom,
  setInspectorVisible,
  copyChar,
  copyValue,
  appendToBuffer,
  setBuffer,
  clearBuffer,
  copyBuffer,
  toggleFavorite,
  isFavorite,
  unicode,
});
