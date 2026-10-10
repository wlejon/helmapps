/**
 * Album covers on screen. Each cover is a small JPEG the scan worker made
 * (js/library-worker.js). A box holds one plain <img> whose src is set to the
 * cover it shows: bro decodes off the page thread into a decoded-image cache
 * every element shares, so a recycled grid cell re-pointed at a cover it (or
 * any cell) showed before draws it without decoding again.
 *
 *   artBox(cover, 'lg')   a .mu-art box with the cover, or a disc glyph when there is none
 *   setArt(box, cover)    put another cover into a box made by artBox
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';

export function artBox(cover, size = '') {
  const box = h(`div.mu-art${size ? `.${size}` : ''}`);
  setArt(box, cover);
  return box;
}

/** Show `cover` in a box. */
export function setArt(box, cover) {
  if (box._cover === cover && box.firstChild) return;
  box._cover = cover;
  if (!cover) {
    box.classList.add('empty');
    box.replaceChildren(icon('disc'));
    return;
  }
  box.classList.remove('empty');
  let img = box.firstChild;
  if (!img || img.tagName !== 'IMG') {
    img = h('img', { alt: '' });
    box.replaceChildren(img);
  }
  img.src = cover;
}
