/**
 * The folder's images as previews: the folder grid (a kit VirtualList grid)
 * and the thumbnail strip along the bottom (a horizontal kit VirtualList: one
 * row that scrolls sideways, the current picture kept centred).
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { VirtualList } from '/lib/list.js';
import { FAILED } from './thumbs.js';

/**
 * Fill a cell with an item's preview; its name is the cell's tooltip. Every
 * live cell is in `cells`, so a preview that arrives later can be put into
 * the cell still showing that item.
 */
export function cellRenderer(thumbs, cells) {
  return (item, el) => {
    cells.add(el);
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
  // One <img> per cell, its src swapped as the cell is recycled: bro decodes
  // off the page thread and keeps decoded pictures by URL, so a preview seen
  // before shows at once.
  let img = el._img;
  if (!img) img = el._img = h('img', { alt: '' });
  if (img.getAttribute('src') !== url) img.src = url;
  if (box.firstChild !== img) box.replaceChildren(img);
}

/**
 * The strip: one row of cells that scrolls sideways (a plain wheel too), one
 * picture selected, the current one brought to the middle so its neighbours
 * show on both sides.
 */
export function stripList(o) {
  const list = new VirtualList({ ...o, orientation: 'horizontal', multiSelect: false, scrollAlign: 'center' });
  list.el.classList.add('iv-strip');
  return list;
}

/** The paths of the cells a list has on screen now. */
export function visiblePaths(list) {
  const out = [];
  for (const el of list.pool.values()) if (el._path) out.push(el._path);
  return out;
}
