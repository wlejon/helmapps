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
 * After changing something every row reads, call list.refresh(); when only
 * rowClass reads it (the playing song is marked), list.refreshClasses().
 *
 *   // One row of cells that scrolls sideways (a thumbnail strip): cells are
 *   // cellWidth x cellHeight, the arrows are Left/Right, and a plain vertical
 *   // wheel scrolls it sideways.
 *   new VirtualList({ orientation: 'horizontal', cellWidth: 88, cellHeight: 76, render });
 *   // scrollAlign: 'center' brings an item into view centred, not just inside.
 *   // typeAhead: false leaves letters to the app's own shortcuts (a strip of
 *   // pictures, whose names nobody types).
 *
 *   // Drag to reorder (list layout or horizontal): a row dragged more than a
 *   // few px shows a drop marker, the list scrolls when the pointer nears an
 *   // edge, and Alt+Up / Alt+Down (Alt+Left / Alt+Right sideways) move the
 *   // cursor's item by one. The list moves the item in its own copy at once
 *   // and calls onReorder(from, to) (`to` is the index it now has); the app
 *   // applies the move to its model and calls setItems as usual. Items need a
 *   // `key`. `reorderable` may be a function (false while a filter is on).
 *   new VirtualList({ key: (r) => r.id, reorderable: true, onReorder: (from, to) => model.move(from, to), ... });
 *
 * A list that is not shown (display: none, a 0 px pane) paints nothing; it
 * paints when it is shown again, and a scrollToIndex/select made while it
 * was hidden is applied then.
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
    this.horizontal = o.orientation === 'horizontal';
    this.layout = o.layout === 'grid' && !this.horizontal ? 'grid' : 'list';
    this.pendingScroll = null;       // key to bring into view once the list is shown
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
    if (this.horizontal) {
      this.scroller.classList.add('horizontal');
      this.scroller.setAttribute('aria-orientation', 'horizontal');
      // A plain (vertical) wheel scrolls a strip sideways; a sideways wheel
      // or Shift+wheel already does.
      this.scroller.addEventListener('wheel', (e) => {
        if (e.deltaX || e.shiftKey || !e.deltaY) return;
        e.preventDefault();
        this.scroller.scrollLeft += e.deltaY;
      }, { passive: false });
    }
    this.header = null;
    if (this.layout === 'list' && !this.horizontal && o.columns && o.columns.length && o.header !== false) {
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
   *
   * With a `key`, what is on screen stays put: the cursor's item (else the
   * first item in view) keeps its place in the view when items come or go
   * before it, and the cursor and the range anchor stay on their items.
   */
  setItems(items) {
    const keyed = !!this.o.key;
    const hold = keyed ? this.heldInView() : null;
    const keyAt = (i) => (i >= 0 && i < this.items.length ? this.keyOf(this.items[i], i) : undefined);
    const cursorKey = keyed ? keyAt(this.cursor) : undefined, anchorKey = keyed ? keyAt(this.anchor) : undefined;
    this.items = items || [];
    this.reindex();
    for (const k of Array.from(this.selection)) if (!this.index.has(k)) this.selection.delete(k);
    if (cursorKey !== undefined && this.index.has(cursorKey)) this.cursor = this.index.get(cursorKey);
    if (anchorKey !== undefined && this.index.has(anchorKey)) this.anchor = this.index.get(anchorKey);
    if (this.cursor >= this.items.length) this.cursor = this.items.length - 1;
    if (this.emptyEl) {
      this.emptyEl.classList.toggle('hidden', this.items.length > 0);
      this.scroller.classList.toggle('hidden', this.items.length === 0);
    }
    this.paint();
    if (hold && this.index.has(hold.key)) {
      const sc = this.scroller;
      const r = this.rectOf(this.index.get(hold.key), sc.clientWidth);
      const to = Math.max(0, (this.horizontal ? r.x : r.y) - hold.offset);
      const pos = this.horizontal ? sc.scrollLeft : sc.scrollTop;
      if (Math.abs(to - pos) >= 1) {
        if (this.horizontal) sc.scrollLeft = to; else sc.scrollTop = to;
        this.paint();
      }
    }
    this.emitSelection();
  }

  /** The item setItems keeps in place: { key, offset } (its start less the scroll position), or null. */
  heldInView() {
    const n = this.items.length;
    const sc = this.scroller;
    const width = sc.clientWidth;
    const view = this.horizontal ? width : sc.clientHeight;
    if (!n || !width || !view) return null;
    const pos = this.horizontal ? sc.scrollLeft : sc.scrollTop;
    const startOf = (i) => { const r = this.rectOf(i, width); return this.horizontal ? [r.x, r.w] : [r.y, r.h]; };
    let i = this.cursor;
    const [a, len] = i >= 0 && i < n ? startOf(i) : [0, 0];
    if (!(i >= 0 && i < n && a + len > pos && a < pos + view)) {
      // At the very start, the start stays in view (as a browser's scroll anchoring does).
      if (pos <= 0) return null;
      // The first item in view.
      if (this.horizontal) i = Math.floor((pos - this.padding) / this.cellWidth);
      else if (this.layout === 'grid') { const { cols, rowH } = this.gridMetrics(width); i = Math.floor((pos - this.padding) / rowH) * cols; }
      else i = Math.floor((pos - this.padding) / this.rowHeight);
      i = Math.max(0, Math.min(n - 1, i));
    }
    return { key: this.keyOf(this.items[i], i), offset: startOf(i)[0] - pos };
  }

  reindex() {
    this.index.clear();
    this.items.forEach((it, i) => this.index.set(this.keyOf(it, i), i));
  }

  /** Re-render the rows on screen (an item changed in place). */
  refresh() {
    this.recycleAll();
    this.paint();
  }

  /** Switch between 'list' and 'grid' (columns are list-only). */
  setLayout(layout, { cellWidth, cellHeight } = {}) {
    this.layout = layout === 'grid' && !this.horizontal ? 'grid' : 'list';
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
    if (this.horizontal) return { x: this.padding + i * this.cellWidth, y: this.padding, w: this.cellWidth, h: this.cellHeight };
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
    return this.indexAtPoint(e.clientX - r.left + this.scroller.scrollLeft, e.clientY - r.top + this.scroller.scrollTop);
  }

  /** The item at a point in the spacer's coordinates (scrolled content), or -1. */
  indexAtPoint(x, y) {
    if (this.horizontal) {
      const i = Math.floor((x - this.padding) / this.cellWidth);
      return i >= 0 && i < this.items.length ? i : -1;
    }
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

  /**
   * Scroll item i into view (just inside, or centred with scrollAlign:
   * 'center'). A hidden list remembers it and scrolls when it is shown.
   */
  scrollToIndex(i) {
    if (i < 0 || i >= this.items.length) return;
    const sc = this.scroller;
    const width = sc.clientWidth;
    const view = this.horizontal ? width : sc.clientHeight;
    if (!width || !view) { this.pendingScroll = this.keyOf(this.items[i], i); return; }
    this.pendingScroll = null;
    const r = this.rectOf(i, width);
    const pos = this.horizontal ? sc.scrollLeft : sc.scrollTop;
    const a = this.horizontal ? r.x : r.y;
    const len = this.horizontal ? r.w : r.h;
    let to = null;
    if (a < pos || a + len > pos + view) {
      if (this.o.scrollAlign === 'center') to = a + len / 2 - view / 2;
      else to = a < pos ? a - this.padding : a + len - view + this.padding;
    }
    if (to != null) {
      if (this.horizontal) sc.scrollLeft = Math.max(0, to);
      else sc.scrollTop = Math.max(0, to);
    }
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
    const height = this.scroller.clientHeight;
    // Not shown (display: none, a collapsed pane): nothing to lay out. The
    // ResizeObserver paints it when it gets a size again. Rows past the end
    // go now, so no row shows an item that is gone; the rest wait to be
    // reused when it is shown.
    if (!width || !height) {
      for (const [i, el] of this.pool) if (i >= n) { el.remove(); this.free.push(el); this.pool.delete(i); }
      return;
    }
    if (this.horizontal) {
      this.spacer.style.width = `${this.padding * 2 + n * this.cellWidth}px`;
      this.spacer.style.height = `${this.padding * 2 + this.cellHeight}px`;
    } else {
      this.spacer.style.height = `${this.totalHeight(width)}px`;
    }
    if (this.pendingScroll != null) {
      // A scroll asked for while hidden, now that the spacer has its size.
      const i = this.index.get(this.pendingScroll);
      this.pendingScroll = null;
      if (i != null) { this.scrollToIndex(i); return; }   // scrolls, then paints
    }
    const top = this.horizontal ? this.scroller.scrollLeft : this.scroller.scrollTop;
    const view = this.horizontal ? width : height;
    if (width !== this.lastWidth) {
      this.lastWidth = width;
      if (this.layout === 'grid') this.recycleAll();
    }
    let first, last;
    if (this.horizontal) {
      first = Math.max(0, Math.floor((top - this.padding) / this.cellWidth) - OVERSCAN);
      last = Math.min(n - 1, Math.ceil((top + view) / this.cellWidth) + OVERSCAN);
    } else if (this.layout === 'grid') {
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
      if (this.cellKind() === 'cell') {
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

  applyRowClass(el, item) {
    const rc = this.o.rowClass ? this.o.rowClass(item) || '' : '';
    if (rc === (el._rowClass || '')) return;
    if (el._rowClass) el.classList.remove(...el._rowClass.split(' '));
    if (rc) el.classList.add(...rc.split(' '));
    el._rowClass = rc;
  }

  /**
   * Re-apply rowClass to the rows on screen (the app state it reads changed:
   * which song is playing). Rows are not rebuilt: far cheaper than refresh().
   */
  refreshClasses() {
    for (const el of this.pool.values()) this.applyRowClass(el, el._item);
  }

  /** 'cell' (a grid or a sideways strip: positioned boxes) or 'row'. */
  cellKind() {
    return this.layout === 'grid' || this.horizontal ? 'cell' : 'row';
  }

  makeRow() {
    const kind = this.cellKind();
    const el = h(kind === 'cell' ? 'div.vgrid-cell' : 'div.vlist-row', { role: 'option' });
    el._layout = kind;
    return el;
  }

  fill(el, item, i) {
    const kind = this.cellKind();
    if (el._layout !== kind) {
      el.className = kind === 'cell' ? 'vgrid-cell' : 'vlist-row';
      el._layout = kind;
      el._rowClass = '';
      el.removeAttribute('style');
    }
    el._item = item;
    el.dataset.index = String(i);
    this.applyRowClass(el, item);
    if (kind === 'row' && this.o.columns && !this.o.render) {
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
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && this.canReorder()) this.dragToReorder(e, i);
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
    const x0 = e.clientX - r0.left + this.scroller.scrollLeft;
    const y0 = e.clientY - r0.top + this.scroller.scrollTop;
    const base = new Set(this.selection);
    let band = null;
    const move = (ev) => {
      const x1 = ev.clientX - r0.left + this.scroller.scrollLeft;
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

  // ---- reordering -------------------------------------------------------------

  canReorder() {
    const r = this.o.reorderable;
    return !!this.o.onReorder && this.layout === 'list' && (typeof r === 'function' ? !!r() : !!r);
  }

  /**
   * Move item `from` to index `to` in the list's own copy, keep it selected
   * and in view, and tell the app (onReorder). Returns whether it moved.
   */
  reorder(from, to) {
    const n = this.items.length;
    to = clamp(to, 0, n - 1);
    if (from < 0 || from >= n || from === to) return false;
    const items = this.items.slice();
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    this.items = items;
    this.reindex();
    this.selection = new Set([this.keyOf(item, to)]);
    this.cursor = this.anchor = to;
    this.scrollToIndex(to);
    this.emitSelection();
    this.o.onReorder(from, to);
    return true;
  }

  /**
   * A press on row `from`: once the pointer has moved a few px it drags the
   * row, a marker shows where it would land, and the list scrolls while the
   * pointer is near (or past) an edge.
   */
  dragToReorder(e, from) {
    const sc = this.scroller;
    const hz = this.horizontal;
    const r0 = sc.getBoundingClientRect();
    const pitch = hz ? this.cellWidth : this.rowHeight;
    const along = (ev) => (hz ? ev.clientX - r0.left : ev.clientY - r0.top);   // in the viewport
    const p0 = along(e);
    const q0 = hz ? e.clientY : e.clientX;
    const key = this.keyOf(this.items[from], from);
    let last = e;
    let marker = null;
    let slot = from;
    let raf = 0;
    const place = () => {
      const pos = along(last) + (hz ? sc.scrollLeft : sc.scrollTop);
      slot = clamp(Math.round((pos - this.padding) / pitch), 0, this.items.length);
      marker.style[hz ? 'left' : 'top'] = `${this.padding + slot * pitch - 1}px`;
    };
    const edge = () => {
      raf = 0;
      if (!marker) return;
      const p = along(last);
      const view = hz ? r0.width : r0.height;
      const zone = Math.min(32, view / 4);
      let v = 0;
      if (p < zone) v = -Math.min(24, Math.ceil((zone - p) / 2));
      else if (p > view - zone) v = Math.min(24, Math.ceil((p - (view - zone)) / 2));
      if (!v) return;
      if (hz) sc.scrollLeft += v; else sc.scrollTop += v;
      place();
      raf = requestAnimationFrame(edge);
    };
    const move = (ev) => {
      last = ev;
      if (!marker) {
        if (Math.abs(along(ev) - p0) + Math.abs((hz ? ev.clientY : ev.clientX) - q0) < 4) return;
        marker = h(hz ? 'div.vlist-drop.vertical' : 'div.vlist-drop');
        this.spacer.appendChild(marker);
        this.el.classList.add('reordering');
      }
      place();
      if (!raf) raf = requestAnimationFrame(edge);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      if (raf) cancelAnimationFrame(raf);
      if (!marker) return;
      marker.remove();
      marker = null;
      this.el.classList.remove('reordering');
      // By key: the app may have refreshed the items while the row was held.
      const f = this.index.get(key);
      if (f != null) this.reorder(f, slot > f ? slot - 1 : slot);
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
    const hz = this.horizontal;
    if (e.key && e.key.startsWith('Arrow') && (e.altKey || e.ctrlKey || e.metaKey)) {
      // Alt+Up / Alt+Down (sideways: Alt+Left / Alt+Right) move the item in a
      // reorderable list. Any other arrow with Alt, Ctrl or Meta is not a
      // plain arrow: it passes through (Alt+Left is Back).
      const d = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 }[e.key];
      const ours = hz ? e.key === 'ArrowLeft' || e.key === 'ArrowRight' : e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (ours && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && this.cursor >= 0 && this.canReorder()) {
        this.reorder(this.cursor, this.cursor + d);
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    const cols = this.columnsPerRow();
    const step = hz ? this.cellWidth : this.layout === 'grid' ? this.gridMetrics().rowH : this.rowHeight;
    const page = Math.max(1, Math.floor((hz ? this.scroller.clientWidth : this.scroller.clientHeight) / step) * cols);
    let to = null;
    const cur = this.cursor < 0 ? -1 : this.cursor;
    const sideways = this.layout === 'grid' || hz;
    switch (e.key) {
      case 'ArrowDown': if (!hz) to = cur < 0 ? 0 : cur + cols; break;
      case 'ArrowUp': if (!hz) to = cur < 0 ? 0 : cur - cols; break;
      case 'ArrowRight': if (sideways) to = cur < 0 ? 0 : cur + 1; break;
      case 'ArrowLeft': if (sideways) to = cur < 0 ? 0 : cur - 1; break;
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
    if (this.o.typeAhead !== false && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key !== ' ' || continuing)) {
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
