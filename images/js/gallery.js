/**
 * The folder's images as previews: the folder grid (a kit VirtualList grid)
 * and the thumbnail strip along the bottom (one row that scrolls sideways).
 *
 * The kit's VirtualList grid only flows downwards, so the strip is a small
 * subclass that lays the same cells out in one horizontal row and keeps the
 * kit's selection, keyboard and recycling. GAPS.md: a horizontal orientation
 * belongs in the kit.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { VirtualList } from '/lib/list.js';
import { FAILED } from './thumbs.js';

const OVERSCAN = 3;

/**
 * Fill a cell with an item's preview; its name is the cell's tooltip. Every
 * live cell is in `cells`, so a preview that arrives later can be put into
 * the cell still showing that item.
 */
export function cellRenderer(thumbs, cells) {
  // bro decodes an <img> again every time its src is set, so each list keeps
  // the decoded preview elements and moves them between recycled cells.
  const images = new ImageShelf();
  return (item, el) => {
    cells.add(el);
    el._images = images;
    el._path = item.path;
    el.title = item.name;
    if (!el._box) {
      el._box = h('div.iv-thumb');
      el.replaceChildren(el._box);
    }
    paintThumb(el, thumbs.url(item.path));
  };
}

/** Put a preview URL (or the "no preview" icon, or nothing yet) into a cell. */
export function paintThumb(el, url) {
  const box = el._box;
  if (!box) return;
  if (url === FAILED) {
    if (!box.querySelector('.icon')) box.replaceChildren(icon('file-image', 'lg'));
    box.classList.remove('loading');
    return;
  }
  if (!url) {
    box.replaceChildren();
    box.classList.add('loading');
    return;
  }
  box.classList.remove('loading');
  const img = el._images.get(url);
  if (box.firstChild !== img) box.replaceChildren(img);
}

/** Decoded preview <img> elements by URL, the most recent few hundred. */
class ImageShelf {
  constructor(limit = 400) {
    this.limit = limit;
    this.map = new Map();
  }

  get(url) {
    let img = this.map.get(url);
    if (img) {
      this.map.delete(url);
    } else {
      img = h('img', { alt: '' });
      img.src = url;
    }
    this.map.set(url, img);
    if (this.map.size > this.limit) {
      const [oldest] = this.map.keys();
      const old = this.map.get(oldest);
      if (!old.isConnected) this.map.delete(oldest);
    }
    return img;
  }

  /** Forget a preview (its file changed). */
  forget(url) {
    this.map.delete(url);
  }
}

/** One row of cells that scrolls sideways. */
export class StripList extends VirtualList {
  constructor(o) {
    super({ ...o, layout: 'grid', multiSelect: false });
    this.el.classList.add('iv-strip');
  }

  columnsPerRow() {
    return Math.max(1, this.items.length);
  }

  rectOf(i) {
    return { x: this.padding + i * this.cellWidth, y: this.padding, w: this.cellWidth, h: this.cellHeight };
  }

  indexAt(e) {
    const r = this.scroller.getBoundingClientRect();
    const x = e.clientX - r.left + this.scroller.scrollLeft;
    const i = Math.floor((x - this.padding) / this.cellWidth);
    return i >= 0 && i < this.items.length ? i : -1;
  }

  /** Bring item i into view: centred, so its neighbours show on both sides. */
  scrollToIndex(i) {
    if (i < 0 || i >= this.items.length) return;
    const view = this.scroller.clientWidth;
    const r = this.rectOf(i);
    const left = this.scroller.scrollLeft;
    if (r.x < left || r.x + r.w > left + view) {
      this.scroller.scrollLeft = Math.max(0, r.x + r.w / 2 - view / 2);
    }
    this.paint();
  }

  paint() {
    const n = this.items.length;
    // All reads first: one layout for the whole paint.
    const left = this.scroller.scrollLeft;
    const view = this.scroller.clientWidth || 800;
    this.spacer.style.width = `${this.padding * 2 + n * this.cellWidth}px`;
    this.spacer.style.height = `${this.padding * 2 + this.cellHeight}px`;
    const first = Math.max(0, Math.floor((left - this.padding) / this.cellWidth) - OVERSCAN);
    const last = Math.min(n - 1, Math.ceil((left + view) / this.cellWidth) + OVERSCAN);
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
        this.fill(el, item, i);
      }
      const r = this.rectOf(i);
      el.style.left = `${r.x}px`;
      el.style.top = `${r.y}px`;
      el.style.width = `${r.w - 6}px`;
      el.style.height = `${r.h - 6}px`;
      el.classList.toggle('selected', this.isSelected(item, i));
      el.classList.toggle('cursor', i === this.cursor);
    }
  }
}

/** The paths of the cells a list has on screen now. */
export function visiblePaths(list) {
  const out = [];
  for (const el of list.pool.values()) if (el._path) out.push(el._path);
  return out;
}
