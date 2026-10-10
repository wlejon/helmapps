/**
 * The decoder thread. Decoding a photo takes tens of milliseconds (an 8 MP
 * JPEG about 45 ms, a 24 MP one over 200), and the page's thread draws the
 * window, so every decode happens here and the page only receives finished
 * pixels.
 *
 *   { id, op: 'picture', path, maxSide }  -> { id, bitmap, width, height, orientation }
 *       bitmap at most maxSide px on its long side (0: full size); width and
 *       height are always the picture's own, upright
 *   { id, op: 'tile', path, tx, ty, tile } -> { id, bitmap, x, y }   one full-resolution
 *       tile (tile px square, plus a 1 px border so neighbours blend), placed at x, y
 *   { id, op: 'thumb', path, size }       -> { id, png }   a small PNG, for the strip and the grid
 *   any may answer { id, error }           bro.image could not decode it (the page tries <img>)
 *
 * Why a screen-sized bitmap first: taking delivery of an ImageBitmap costs
 * the page about 0.3 ms per MB (GAPS.md), and its first upload to the GPU
 * more, so a 24 MP photo (96 MB) in one piece would cost a 30-50 ms frame.
 * Fitted on screen it needs a tenth of that. Zoomed past what the preview
 * holds, the page asks for the full-resolution tiles on screen, one at a
 * time, and the last decode is kept here so those do not decode again.
 *
 * bro.image.decodeOriented applies the EXIF orientation, so a phone photo
 * comes out upright. It does not read WebP or SVG (it answers a 0x0 or 1x1
 * image); the page decodes those with an <img> instead (see GAPS.md).
 */

const fs = require('fs');

/** The last decode: { key, result }. */
let last = null;

function decode(path) {
  let key = path;
  try { key = `${path}\n${fs.statSync(path).mtimeMs}`; } catch (_) { /* decodeFile reports it */ }
  if (last && last.key === key) return last.result;
  last = null;
  const result = decodeFile(path);
  last = { key, result };
  return result;
}

function decodeFile(path) {
  const bytes = fs.readFileSync(path);
  const probe = bro.image.probeDimensions(bytes);
  const img = bro.image.decodeOriented(bytes);
  if (!img || img.width <= 1 || img.height <= 1 || (probe && probe.width > 1 && img.width * img.height < 4)) {
    throw new Error('bro.image cannot decode this file');
  }
  const orientation = bro.image.readExifOrientation(bytes) || 1;
  return { img, orientation };
}

/** RGBA in, RGBA at most `size` px on its long side out (area filter: no aliasing). */
function shrink(img, size) {
  const scale = size > 0 ? Math.min(1, size / Math.max(img.width, img.height)) : 1;
  if (scale >= 1) return img;
  const w = Math.max(1, Math.round(img.width * scale));
  const hgt = Math.max(1, Math.round(img.height * scale));
  const dst = new Uint8Array(w * hgt * 4);
  bro.image.resizeU8(dst, img.pixels, { srcW: img.width, srcH: img.height, dstW: w, dstH: hgt, channels: 4, filter: 'area' });
  return { width: w, height: hgt, channels: 4, pixels: dst };
}

/**
 * Tile (tx, ty) of a full decode, with one pixel of its neighbours on every
 * side, so smoothing across the seam samples real pixels. { x, y } is where
 * the cut starts in the picture.
 */
function cut(img, tx, ty, tile) {
  const x = Math.max(0, tx * tile - 1);
  const y = Math.max(0, ty * tile - 1);
  const x1 = Math.min(img.width, (tx + 1) * tile + 1);
  const y1 = Math.min(img.height, (ty + 1) * tile + 1);
  const w = x1 - x, hgt = y1 - y;
  if (w <= 0 || hgt <= 0) throw new Error('no such tile');
  const dst = new Uint8Array(w * hgt * 4);
  const row = img.width * 4;
  for (let r = 0; r < hgt; r++) {
    const from = (y + r) * row + x * 4;
    dst.set(img.pixels.subarray(from, from + w * 4), r * w * 4);
  }
  return { width: w, height: hgt, pixels: dst, x, y };
}

/** A copy of the bytes in a buffer of their own (the decode stays cached). */
const copyBuffer = (u8) => u8.slice().buffer;

self.onmessage = async (e) => {
  const { id, op, path, size, maxSide } = e.data || {};
  try {
    const { img, orientation } = decode(path);
    if (op === 'thumb') {
      const small = shrink(img, size || 256);
      const png = bro.image.encodePng(small.pixels, small.width, small.height, 4);
      if (!png) throw new Error('could not encode the preview');
      const buf = copyBuffer(png);
      self.postMessage({ id, png: buf }, [buf]);
      return;
    }
    const out = op === 'tile' ? cut(img, e.data.tx, e.data.ty, e.data.tile) : shrink(img, maxSide || 0);
    if (op === 'tile') {
      const view = new Uint8ClampedArray(out.pixels.buffer, 0, out.width * out.height * 4);
      const bitmap = await createImageBitmap(new ImageData(view, out.width, out.height));
      self.postMessage({ id, bitmap, x: out.x, y: out.y }, [bitmap]);
      return;
    }
    const meta = { id, width: img.width, height: img.height, orientation };
    // An ImageBitmap made here moves to the page with its pixels. Raw pixels
    // are the fallback where a worker cannot make one.
    if (typeof createImageBitmap === 'function' && typeof ImageData === 'function') {
      const view = new Uint8ClampedArray(out.pixels.buffer, out.pixels.byteOffset, out.width * out.height * 4);
      const bitmap = await createImageBitmap(new ImageData(view, out.width, out.height));
      self.postMessage({ ...meta, bitmap }, [bitmap]);
      return;
    }
    const pixels = copyBuffer(out.pixels);
    self.postMessage({ ...meta, pixels, pixelWidth: out.width, pixelHeight: out.height }, [pixels]);
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
};
