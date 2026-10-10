/**
 * VirtualList: a scrolling list or icon grid that renders only the rows on
 * screen, so 100 000 items cost what 40 do. With selection (click, Ctrl/Shift
 * click, rubber band, keyboard), type-ahead, activation and context menus.
 * Every app that shows a collection uses this rather than building one.
 *
 *   import { VirtualList } from '/lib/list.js';
 *   const list = new VirtualList({
 *     layout: 'list',                         // or 'grid'
 *     key: (f) => f.path,
 *     columns: [                              // list layout: a header + cells
 *       { id: 'name', label: 'Name', flex: 1, sortable: true,
 *         cell: (f) => [icon(f.isDir ? 'folder' : 'file'), h('span.ellipsis', f.name)] },
 *       { id: 'size', label: 'Size', width: 90, align: 'right', sortable: true, cell: (f) => formatBytes(f.size) },
 *     ],
 *     sort: { id: 'name', dir: 1 },           // shown in the header; you sort the items
 *     onSort: (id, dir) => { ...; list.setItems(sorted); },
 *     onActivate: (items) => open(items),     // double-click / Enter
 *     onContextMenu: (e, items) => menu.show(..., e.clientX, e.clientY),
 *     onSelectionChange: (items) => updateStatus(items),
 *     label: (f) => f.name,                   // type-ahead
 *     rowClass: (f) => f.hidden ? 'dimmed' : '',  // classes on the row, from its item
 *     columnWidths: settings.get('columns'),      // sizes the user dragged, by column id
 *     onColumnResize: (w) => settings.set('columns', w),
 *   });
 * The dividers between header cells drag to resize (double-click resets);
 * a column with `resizable: false` keeps its size, `minWidth` bounds a drag.
 *   parent.appendChild(list.el);
 *   list.setItems(files);
 *
 *   // Grid: cellWidth/cellHeight and render(item, el) fill each cell.
 *   new VirtualList({ layout: 'grid', cellWidth: 112, cellHeight: 112,
 *                     render: (f, el) => { el.replaceChildren(thumb(f), h('span', f.name)); } });
 *   // A fluid grid (a photo wall): cells widen so the columns fill the row,
 *   // `aspect` makes their height follow (height / width), `gap` is the space
 *   // between cells (default 6), `padding` the space around them.
 *   new VirtualList({ layout: 'grid', cellWidth: 220, fill: true, aspect: 1, gap: 0, padding: 0, render });
 *
 * render(item, el, index) may be given in list layout too, instead of
 * columns. Rows are reused as the user scrolls: render must set everything
 * it shows, every time (no "if (!el.firstChild)" shortcuts).
 *
 * A row shows its item and nothing else: setItems() keeps a row whose new
 * item has the same fields as the old one, so a cell that also reads app
 * state (a share of the folder's total, "is this the playing track") goes
 * stale. Put such a value on the item (item.share = bytes / total) instead.
 * After changing something every row reads, call list.refresh().
 */

import { h, clamp, isTyping } from './dom.js';
import { icon } from './icons.js';

const OVERSCAN = 4;

/** Whether two items have the same own fields (===): their rows look the same. */
function sameFields(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

export class VirtualList {
  constructor(o = {}) {
    // Columns are copied: a user resizing one changes the list's copy.
    if (o.columns) {
      this.defaultWidths = o.columns.map((c) => c.width || 0);
      const saved = o.columnWidths || {};
      o = { ...o, columns: o.columns.map((c) => ({ ...c, width: saved[c.id] || c.width })) };
    }
    this.o = o;
    this.layout = o.layout === 'grid' ? 'grid' : 'list';
    this.rowHeight = o.rowHeight || 32;
    this.cellWidth = o.cellWidth || 112;
    this.cellHeight = o.cellHeight || 112;
    this.padding = o.padding == null ? 6 : o.padding;
    this.gap = o.gap == null ? 6 : o.gap;
    this.fillRow = !!o.fill;
    this.aspect = o.aspect || 0;
    this.keyOf = o.key || ((item, i) => i);
    this.items = [];
    this.index = new Map();          // key -> index
    this.selection = new Set();      // keys
    this.anchor = -1;                // range-selection anchor
    this.cursor = -1;                // keyboard focus row
    this.pool = new Map();           // index -> element on screen
    this.free = [];
    this.typed = '';
    this.typedAt = 0;
    this.sort = o.sort || null;

    this.spacer = h('div.vlist-spacer');
    this.scroller = h('div.vlist', { tabindex: '0', role: this.layout === 'grid' ? 'grid' : 'listbox' }, this.spacer);
    this.header = null;
    if (this.layout === 'list' && o.columns && o.columns.length && o.header !== false) {
      this.header = h('div.list-header');
      this.renderHeader();
    }
    this.el = h('div.vlist-wrap', { style: { display: 'flex', flexDirection: 'column', flex: '1 1 0px', minHeight: '0', minWidth: '0' } },
      this.header, this.scroller);
    if (o.empty) {
      this.emptyEl = o.empty;
      this.emptyEl.classList.add('hidden');
      this.el.appendChild(this.emptyEl);
    }

    this.scroller.addEventListener('scroll', () => this.paint());
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    this.scroller.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.scroller.addEventListener('dblclick', (e) => {
      const i = this.indexAt(e);
      if (i >= 0 && this.o.onActivate) this.o.onActivate([this.items[i]]);
    });
    this.scroller.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.lastWidth = 0;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.paint());
      this.ro.observe(this.scroller);
    }
    window.addEventListener('resize', () => this.paint());
  }

  // ---- data ---------------------------------------------------------------

  /**
   * Replace the items. Selection survives for keys still present. A row on
   * screen whose new item has the same fields as its old one is kept as it
   * is, so a list refreshed often (live totals, a folder being written to)
   * rebuilds only the rows that changed.
   */
  setItems(items) {
    this.items = items || [];
    this.index.clear();
    this.items.forEach((it, i) => this.index.set(this.keyOf(it, i), i));
    for (const k of Array.from(this.selection)) if (!this.index.has(k)) this.selection.delete(k);
    if (this.cursor >= this.items.length) this.cursor = this.items.length - 1;
    if (this.emptyEl) {
      this.emptyEl.classList.toggle('hidden', this.items.length > 0);
      this.scroller.classList.toggle('hidden', this.items.length === 0);
    }
    this.paint();
    this.emitSelection();
  }

  /** Re-render the rows on screen (an item changed in place). */
  refresh() {
    this.recycleAll();
    this.paint();
  }

  /** Switch between 'list' and 'grid' (columns are list-only). */
  setLayout(layout, { cellWidth, cellHeight } = {}) {
    this.layout = layout === 'grid' ? 'grid' : 'list';
    if (cellWidth) this.cellWidth = cellWidth;
    if (cellHeight) this.cellHeight = cellHeight;
    if (this.header) this.header.classList.toggle('hidden', this.layout !== 'list');
    this.recycleAll();
    this.paint();
  }

  setSort(sort) {
    this.sort = sort;
    if (this.header) this.renderHeader();
  }

  // ---- selection ----------------------------------------------------------

  selectedItems() {
    const out = [];
    for (const k of this.selection) {
      const i = this.index.get(k);
      if (i != null) out.push({ i, item: this.items[i] });
    }
    return out.sort((a, b) => a.i - b.i).map((x) => x.item);
  }

  /** Select exactly these keys (and put the cursor on the first). */
  select(keys, { scroll = true } = {}) {
    this.selection = new Set(keys.filter((k) => this.index.has(k)));
    const first = keys.length ? this.index.get(keys[0]) : -1;
    if (first != null && first >= 0) {
      this.cursor = first;
      this.anchor = first;
      if (scroll) this.scrollToIndex(first);
    }
    this.paint();
    this.emitSelection();
  }

  selectAll() {
    if (this.o.multiSelect === false) return;
    this.selection = new Set(this.items.map((it, i) => this.keyOf(it, i)));
    this.paint();
    this.emitSelection();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.paint();
    this.emitSelection();
  }

  isSelected(item, i) {
    return this.selection.has(this.keyOf(item, i));
  }

  emitSelection() {
    if (this.o.onSelectionChange) this.o.onSelectionChange(this.selectedItems());
  }

  // ---- geometry -------------------------------------------------------------

  // Reading a box (clientWidth, scrollTop, getBoundingClientRect) after a
  // style write lays the page out again first, so paint() reads the
  // scroller's geometry once up front and hands `width` to these.

  columnsPerRow(width = this.scroller.clientWidth) {
    if (this.layout !== 'grid') return 1;
    return Math.max(1, Math.floor((width - this.padding * 2) / this.cellWidth));
  }

  /**
   * The grid's geometry at a width: columns, the pitch from one cell to the
   * next (cellWidth, or the share of the row when it fills), the row height,
   * and the left edge of the first column (a fixed grid is centred).
   */
  gridMetrics(width = this.scroller.clientWidth) {
    const cols = this.columnsPerRow(width);
    const pitch = this.fillRow ? Math.max(1, (width - this.padding * 2) / cols) : this.cellWidth;
    const rowH = this.aspect ? Math.round(pitch * this.aspect) : this.cellHeight;
    const x0 = this.fillRow ? this.padding : Math.max(this.padding, Math.floor((width - cols * pitch) / 2));
    return { cols, pitch, rowH, x0 };
  }

  /** Top-left of item i inside the spacer, and its size. */
  rectOf(i, width = this.scroller.clientWidth) {
    if (this.layout === 'grid') {
      const { cols, pitch, rowH, x0 } = this.gridMetrics(width);
      const c = i % cols;
      const x = Math.round(x0 + c * pitch);
      return { x, y: this.padding + Math.floor(i / cols) * rowH, w: Math.round(x0 + (c + 1) * pitch) - x, h: rowH };
    }
    return { x: 0, y: this.padding + i * this.rowHeight, w: width, h: this.rowHeight };
  }

  totalHeight(width = this.scroller.clientWidth) {
    const n = this.items.length;
    if (this.layout === 'grid') {
      const { cols, rowH } = this.gridMetrics(width);
      return this.padding * 2 + Math.ceil(n / cols) * rowH;
    }
    return this.padding * 2 + n * this.rowHeight;
  }

  /** The item index under a pointer event, or -1. */
  indexAt(e) {
    const r = this.scroller.getBoundingClientRect();
    return this.indexAtPoint(e.clientX - r.left, e.clientY - r.top + this.scroller.scrollTop);
  }

  indexAtPoint(x, y) {
    if (this.layout === 'grid') {
      const { cols, pitch, rowH, x0 } = this.gridMetrics();
      const c = Math.floor((x - x0) / pitch);
      const row = Math.floor((y - this.padding) / rowH);
      if (c < 0 || c >= cols || row < 0) return -1;
      const i = row * cols + c;
      return i < this.items.length ? i : -1;
    }
    const i = Math.floor((y - this.padding) / this.rowHeight);
    return i >= 0 && i < this.items.length ? i : -1;
  }

  scrollToIndex(i) {
    if (i < 0 || i >= this.items.length) return;
    const r = this.rectOf(i);
    const top = this.scroller.scrollTop;
    const view = this.scroller.clientHeight;
    if (r.y < top) this.scroller.scrollTop = Math.max(0, r.y - this.padding);
    else if (r.y + r.h > top + view) this.scroller.scrollTop = r.y + r.h - view + this.padding;
    this.paint();
  }

  // ---- rendering --------------------------------------------------------------

  renderHeader() {
    const cols = this.o.columns;
    this.header.replaceChildren(...cols.map((c, i) => {
      const el = h('div.col', c.label || '');
      applyColumnStyle(el, c);
      if (i < cols.length - 1 && c.resizable !== false && cols[i + 1].resizable !== false) {
        const grip = h('div.col-grip', { 'aria-label': 'Resize column' });
        grip.addEventListener('pointerdown', (e) => this.dragColumn(e, i));
        grip.addEventListener('click', (e) => e.stopPropagation());
        grip.addEventListener('dblclick', (e) => { e.stopPropagation(); this.resetColumns(i); });
        el.appendChild(grip);
      }
      if (c.sortable) {
        el.classList.add('sortable');
        if (this.sort && this.sort.id === c.id) {
          el.classList.add('sorted');
          el.appendChild(icon(this.sort.dir < 0 ? 'chevron-down' : 'chevron-up'));
        }
        el.addEventListener('click', () => {
          const dir = this.sort && this.sort.id === c.id ? -this.sort.dir : 1;
          this.setSort({ id: c.id, dir });
          if (this.o.onSort) this.o.onSort(c.id, dir);
        });
      }
      return el;
    }));
  }

  /**
   * Drag the divider after column i; it follows the pointer. The column on
   * the side it moves away from grows; the columns on the side it moves into
   * give the width, nearest first, each down to its minimum, until a flexible
   * column (a Name column) takes the rest. The row never overflows.
   */
  dragColumn(e, i) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cols = this.o.columns;
    const start = Array.from(this.header.children, (c) => c.getBoundingClientRect().width);
    const min = (k) => cols[k].minWidth || 48;
    const x0 = e.clientX;
    this.header.classList.add('resizing');
    const move = (ev) => {
      const d = Math.round(ev.clientX - x0);
      const grow = d > 0 ? i : i + 1;
      const order = [];
      if (d > 0) for (let k = i + 1; k < cols.length; k++) order.push(k);
      else for (let k = i; k >= 0; k--) order.push(k);
      let rest = Math.abs(d);
      cols.forEach((c, k) => { if (c.width) c.width = Math.round(start[k]); });
      for (const k of order) {
        const take = Math.min(rest, Math.max(0, start[k] - min(k)));
        rest -= take;
        if (!cols[k].width) break;           // the flexible column gives implicitly
        cols[k].width = Math.round(start[k] - take);
        if (!rest) break;
      }
      if (cols[grow].width) cols[grow].width = Math.round(start[grow] + Math.abs(d) - rest);
      this.applyColumnStyles();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      this.header.classList.remove('resizing');
      if (this.o.onColumnResize) this.o.onColumnResize(this.columnWidths());
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  /** The columns the user has sized, by id ({ size: 120 }); for saving. */
  columnWidths() {
    const out = {};
    this.o.columns.forEach((c, i) => { if (c.width && c.width !== this.defaultWidths[i]) out[c.id] = c.width; });
    return out;
  }

  /** Back to the widths the app gave (both sides of divider i). */
  resetColumns(i) {
    for (const k of [i, i + 1]) this.o.columns[k].width = this.defaultWidths[k] || undefined;
    this.applyColumnStyles();
    if (this.o.onColumnResize) this.o.onColumnResize(this.columnWidths());
  }

  /** Re-apply the column widths to the header and every row on screen. */
  applyColumnStyles() {
    const cols = this.o.columns;
    const apply = (parent) => {
      const kids = parent.children;
      for (let k = 0; k < cols.length && k < kids.length; k++) applyColumnStyle(kids[k], cols[k]);
    };
    if (this.header) apply(this.header);
    if (this.layout === 'list' && !this.o.render) for (const el of this.pool.values()) apply(el);
  }

  recycleAll() {
    for (const el of this.pool.values()) { el.remove(); this.free.push(el); }
    this.pool.clear();
  }

  paint() {
    const n = this.items.length;
    // All reads first: one layout, however many rows are written below.
    const width = this.scroller.clientWidth;
    const top = this.scroller.scrollTop;
    const view = this.scroller.clientHeight || 600;
    this.spacer.style.height = `${this.totalHeight(width)}px`;
    if (width !== this.lastWidth) {
      this.lastWidth = width;
      if (this.layout === 'grid') this.recycleAll();
    }
    let first, last;
    if (this.layout === 'grid') {
      const { cols, rowH } = this.gridMetrics(width);
      const r0 = Math.max(0, Math.floor((top - this.padding) / rowH) - 1);
      const r1 = Math.ceil((top + view) / rowH) + 1;
      first = r0 * cols;
      last = Math.min(n - 1, r1 * cols + cols - 1);
    } else {
      first = Math.max(0, Math.floor((top - this.padding) / this.rowHeight) - OVERSCAN);
      last = Math.min(n - 1, Math.ceil((top + view) / this.rowHeight) + OVERSCAN);
    }
    for (const [i, el] of this.pool) {
      if (i < first || i > last) { el.remove(); this.free.push(el); this.pool.delete(i); }
    }
    for (let i = first; i <= last; i++) {
      let el = this.pool.get(i);
      const item = this.items[i];
      if (!el) {
        el = this.free.pop() || this.makeRow();
        this.pool.set(i, el);
        this.fill(el, item, i);
        this.spacer.appendChild(el);
      } else if (el._item !== item) {
        if (sameFields(el._item, item)) el._item = item;
        else this.fill(el, item, i);
      }
      const r = this.rectOf(i, width);
      el.style.top = `${r.y}px`;
      if (this.layout === 'grid') {
        el.style.left = `${r.x}px`;
        el.style.width = `${r.w - this.gap}px`;
        el.style.height = `${r.h - this.gap}px`;
      } else {
        el.style.height = `${r.h}px`;
      }
      el.classList.toggle('selected', this.isSelected(item, i));
      el.classList.toggle('cursor', i === this.cursor);
    }
  }

  makeRow() {
    const el = h(this.layout === 'grid' ? 'div.vgrid-cell' : 'div.vlist-row', { role: 'option' });
    el._layout = this.layout;
    return el;
  }

  fill(el, item, i) {
    if (el._layout !== this.layout) {
      el.className = this.layout === 'grid' ? 'vgrid-cell' : 'vlist-row';
      el._layout = this.layout;
      el.removeAttribute('style');
    }
    el._item = item;
    el.dataset.index = String(i);
    const rc = this.o.rowClass ? this.o.rowClass(item) || '' : '';
    if (rc !== (el._rowClass || '')) {
      if (el._rowClass) el.classList.remove(...el._rowClass.split(' '));
      if (rc) el.classList.add(...rc.split(' '));
      el._rowClass = rc;
    }
    if (this.layout === 'list' && this.o.columns && !this.o.render) {
      el.replaceChildren(...this.o.columns.map((c) => {
        const cell = h('div.col');
        applyColumnStyle(cell, c);
        const v = c.cell ? c.cell(item, i) : item[c.id];
        if (Array.isArray(v)) cell.append(...v.filter((x) => x != null));
        else if (v instanceof Node) cell.appendChild(v);
        else cell.textContent = v == null ? '' : String(v);
        return cell;
      }));
    } else if (this.o.render) {
      this.o.render(item, el, i);
    } else {
      el.textContent = this.o.label ? this.o.label(item) : String(item);
    }
  }

  // ---- input --------------------------------------------------------------------

  onPointerDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    this.scroller.focus();
    const i = this.indexAt(e);
    if (e.button === 2) {
      // Right-click on an unselected item selects just it.
      if (i >= 0 && !this.isSelected(this.items[i], i)) this.clickSelect(i, {});
      return;
    }
    if (i < 0) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) this.clearSelection();
      if (this.o.multiSelect !== false) this.startBand(e);
      return;
    }
    this.clickSelect(i, e);
  }

  clickSelect(i, e) {
    const key = this.keyOf(this.items[i], i);
    const multi = this.o.multiSelect !== false;
    if (multi && e.shiftKey && this.anchor >= 0) {
      const [a, b] = this.anchor < i ? [this.anchor, i] : [i, this.anchor];
      if (!(e.ctrlKey || e.metaKey)) this.selection.clear();
      for (let j = a; j <= b; j++) this.selection.add(this.keyOf(this.items[j], j));
    } else if (multi && (e.ctrlKey || e.metaKey)) {
      if (this.selection.has(key)) this.selection.delete(key); else this.selection.add(key);
      this.anchor = i;
    } else {
      this.selection = new Set([key]);
      this.anchor = i;
    }
    this.cursor = i;
    this.paint();
    this.emitSelection();
  }

  startBand(e) {
    const r0 = this.scroller.getBoundingClientRect();
    const x0 = e.clientX - r0.left;
    const y0 = e.clientY - r0.top + this.scroller.scrollTop;
    const base = new Set(this.selection);
    let band = null;
    const move = (ev) => {
      const x1 = ev.clientX - r0.left;
      const y1 = ev.clientY - r0.top + this.scroller.scrollTop;
      if (!band && Math.abs(x1 - x0) + Math.abs(y1 - y0) < 4) return;
      if (!band) { band = h('div.vlist-band'); this.spacer.appendChild(band); }
      const L = Math.min(x0, x1), T = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
      Object.assign(band.style, { left: `${L}px`, top: `${T}px`, width: `${W}px`, height: `${H}px` });
      const sel = new Set(base);
      for (let i = 0; i < this.items.length; i++) {
        const r = this.rectOf(i);
        if (r.y > T + H) break;
        if (r.x < L + W && r.x + r.w > L && r.y < T + H && r.y + r.h > T) sel.add(this.keyOf(this.items[i], i));
      }
      this.selection = sel;
      this.paint();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      if (band) { band.remove(); this.emitSelection(); }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  onContextMenu(e) {
    e.preventDefault();
    if (!this.o.onContextMenu) return;
    const i = this.indexAt(e);
    this.o.onContextMenu(e, i >= 0 ? this.selectedItems() : []);
  }

  onKey(e) {
    if (isTyping(e)) return;
    const n = this.items.length;
    if (!n) return;
    const cols = this.columnsPerRow();
    const step = this.layout === 'grid' ? this.gridMetrics().rowH : this.rowHeight;
    const page = Math.max(1, Math.floor(this.scroller.clientHeight / step) * cols);
    let to = null;
    const cur = this.cursor < 0 ? -1 : this.cursor;
    switch (e.key) {
      case 'ArrowDown': to = cur < 0 ? 0 : cur + cols; break;
      case 'ArrowUp': to = cur < 0 ? 0 : cur - cols; break;
      case 'ArrowRight': if (this.layout === 'grid') to = cur + 1; break;
      case 'ArrowLeft': if (this.layout === 'grid') to = cur - 1; break;
      case 'PageDown': to = cur + page; break;
      case 'PageUp': to = cur - page; break;
      case 'Home': to = 0; break;
      case 'End': to = n - 1; break;
      case 'Enter':
        if (this.o.onActivate && this.selection.size) this.o.onActivate(this.selectedItems());
        e.preventDefault();
        return;
      case 'a':
      case 'A':
        if (e.ctrlKey || e.metaKey) { this.selectAll(); e.preventDefault(); return; }
        break;
      case 'Escape':
        if (this.selection.size) { this.clearSelection(); e.preventDefault(); e.stopPropagation(); }
        return;
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return;
        if (this.o.onContextMenu && this.cursor >= 0) {
          const el = this.pool.get(this.cursor);
          const r = el ? el.getBoundingClientRect() : this.scroller.getBoundingClientRect();
          this.o.onContextMenu({ clientX: r.left + 16, clientY: r.top + r.height / 2, preventDefault() {} }, this.selectedItems());
          e.preventDefault();
        }
        return;
    }
    if (to != null) {
      to = clamp(to, 0, n - 1);
      e.preventDefault();
      this.clickSelect(to, { shiftKey: e.shiftKey, ctrlKey: false });
      if (!e.shiftKey) this.anchor = to;
      this.scrollToIndex(to);
      return;
    }
    // Type-ahead: letters typed within a second jump to the next match. A
    // space only continues a run already being typed ('my fi'); alone it is
    // left for the app (preview, toggle).
    const now = Date.now();
    const continuing = this.typed && now - this.typedAt < 1000;
    if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key !== ' ' || continuing)) {
      this.typed = continuing ? this.typed + e.key.toLowerCase() : e.key.toLowerCase();
      this.typedAt = now;
      const label = this.o.label || ((it) => String(it));
      const start = this.typed.length === 1 ? cur + 1 : Math.max(0, cur);
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (String(label(this.items[i])).toLowerCase().startsWith(this.typed)) {
          this.clickSelect(i, {});
          this.scrollToIndex(i);
          break;
        }
      }
      e.preventDefault();
    }
  }

  focus() {
    this.scroller.focus();
  }

  destroy() {
    if (this.ro) this.ro.disconnect();
    this.el.remove();
  }
}

function applyColumnStyle(el, c) {
  if (c.width) { el.style.width = `${c.width}px`; el.style.flex = 'none'; }
  else { el.style.width = ''; el.style.flex = `${c.flex || 1} 1 0px`; }
  if (c.align === 'right') el.classList.add('right');
}
