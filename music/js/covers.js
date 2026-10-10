/**
 * Album covers on screen. Each cover is a small JPEG the scan worker made
 * (js/library-worker.js); bro decodes an <img> again every time its src is
 * set (see ../images/GAPS.md), so decoded cover elements are kept on a shelf
 * and moved between the recycled grid cells instead of re-pointed.
 *
 *   artBox(cover, 'lg')   a .mu-art box with the cover, or a disc glyph when there is none
 *   setArt(box, cover)    put another cover into a box made by artBox
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';

const LIMIT = 300;
const shelf = new Map();          // cover path -> <img>

/** The decoded <img> for a cover, the most recent LIMIT of them kept. */
function image(cover) {
  let img = shelf.get(cover);
  if (img) {
    shelf.delete(cover);
  } else {
    img = h('img', { alt: '' });
    img.src = cover;
  }
  shelf.set(cover, img);
  if (shelf.size > LIMIT) {
    for (const [k, el] of shelf) {
      if (shelf.size <= LIMIT) break;
      if (!el.isConnected) shelf.delete(k);
    }
  }
  return img;
}

export function artBox(cover, size = '') {
  const box = h(`div.mu-art${size ? `.${size}` : ''}`);
  setArt(box, cover);
  return box;
}

/**
 * Show `cover` in a box. `own` makes a fresh <img> that is not shelved (for
 * a box that always stays on screen, like the now-playing bar, where a
 * shared element would be taken away by a grid cell showing the same album).
 */
export function setArt(box, cover, { own = false } = {}) {
  if (box._cover === cover && box.firstChild) return;
  box._cover = cover;
  if (!cover) {
    box.classList.add('empty');
    box.replaceChildren(icon('disc'));
    return;
  }
  box.classList.remove('empty');
  if (own) {
    let img = box.querySelector('img');
    if (!img) { img = h('img', { alt: '' }); box.replaceChildren(img); }
    img.src = cover;
    return;
  }
  const img = image(cover);
  if (box.firstChild === img) return;
  if (img.isConnected) {
    // On screen in another box too (two albums with one folder picture): a copy.
    const copy = h('img', { alt: '' });
    copy.src = cover;
    box.replaceChildren(copy);
    return;
  }
  box.replaceChildren(img);
}
