/**
 * The image formats Image Viewer opens, and how each is decoded. Found by
 * testing bro (see GAPS.md): AVIF and HEIC do not decode at all, so they are
 * not listed, and a folder's AVIFs are skipped like any other file.
 *
 *   'worker'  bro.image in the decoder thread (EXIF orientation applied)
 *   'img'     an <img> on the page: bro.image does not read it
 *   'vector'  an <img> drawn at the size it is shown, so it stays sharp
 */

const path = require('path');

const FORMATS = {
  png: { type: 'PNG image', mime: 'image/png', decode: 'worker' },
  jpg: { type: 'JPEG image', mime: 'image/jpeg', decode: 'worker' },
  jpeg: { type: 'JPEG image', mime: 'image/jpeg', decode: 'worker' },
  jpe: { type: 'JPEG image', mime: 'image/jpeg', decode: 'worker' },
  gif: { type: 'GIF image', mime: 'image/gif', decode: 'worker' },
  bmp: { type: 'BMP image', mime: 'image/bmp', decode: 'worker' },
  ico: { type: 'Windows icon', mime: 'image/x-icon', decode: 'worker' },
  tif: { type: 'TIFF image', mime: 'image/tiff', decode: 'worker' },
  tiff: { type: 'TIFF image', mime: 'image/tiff', decode: 'worker' },
  webp: { type: 'WebP image', mime: 'image/webp', decode: 'img' },
  svg: { type: 'SVG drawing', mime: 'image/svg+xml', decode: 'vector' },
};

/** Lower-case extension without the dot. */
export function extOf(p) {
  return path.extname(p).slice(1).toLowerCase();
}

/** Whether Image Viewer can show this file (by its name). */
export function isImage(p) {
  return Object.prototype.hasOwnProperty.call(FORMATS, extOf(p));
}

/** { type, mime, decode } for a file, or null. */
export function formatOf(p) {
  return FORMATS[extOf(p)] || null;
}

/** For the Open dialog: 'Images|png;jpg;...'. */
export function dialogFilter() {
  return `Images|${Object.keys(FORMATS).join(';')}`;
}

/**
 * Name order as people expect it: case-insensitive, and numbers by value,
 * so img2 comes before img10.
 */
export function compareNames(a, b) {
  return compareKeyed(nameKey(a), nameKey(b), a, b);
}

/**
 * A name as one string that sorts by plain comparison: lower case, every run
 * of digits padded to a fixed width so it compares by value. Sorting a big
 * folder then costs one key per name and a string compare per step.
 */
export function nameKey(name) {
  return name.toLowerCase().replace(/\d+/g, padDigits);
}

function padDigits(d) {
  const t = d.replace(/^0+(?=\d)/, '');
  return t.length >= 24 ? t : '0'.repeat(24 - t.length) + t;
}

/** Sort names in name order, keying each name once. */
export function sortNames(names) {
  const keyed = names.map((n) => ({ n, k: nameKey(n) }));
  keyed.sort((x, y) => compareKeyed(x.k, y.k, x.n, y.n));
  return keyed.map((x) => x.n);
}

function compareKeyed(ka, kb, a, b) {
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;       // img01 / img1, Img / img: still a fixed order
}

/** EXIF orientation 1..8 in words ('' for 0/1). */
export function orientationText(o) {
  return ({
    2: 'Mirrored', 3: 'Rotated 180°', 4: 'Flipped vertically', 5: 'Mirrored, rotated 90° left',
    6: 'Rotated 90° right', 7: 'Mirrored, rotated 90° right', 8: 'Rotated 90° left',
  })[o] || '';
}
