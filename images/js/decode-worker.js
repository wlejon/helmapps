/**
 * The decoder thread. Decoding a photo takes tens of milliseconds (an 8 MP
 * JPEG about 45 ms, a 24 MP one over 200), and the page's thread draws the
 * window, so every decode happens here and the page only receives finished
 * pixels.
 *
 *   { id, op: 'picture', path, maxSide }  -> { id, bitmap, width, height, orientation }
 *       bitmap at most maxSide px on its long side (0: full size); width and
 *       height are always the picture's own, upright
 *   { id, op: 'thumb', path, size }       -> { id, png }   a small PNG, for the strip and the grid
 *   { id, op: 'png', path }               -> { id, png }   the whole picture as a PNG (upright), to copy
 *   'picture' also answers `exif`: bro.image.readExif's fields, or null
 *   any may answer { id, error }           bro.image could not decode it (the page tries <img>)
 *
 * A transferred ImageBitmap moves to the page as a handle, and bro uploads it
 * to the GPU ahead of its first draw, so even a 24 MP photo arrives without
 * costing the page a frame. The page still asks for a screen-sized one first
 * (that is all a fitted view shows, and the neighbours it keeps stay small);
 * zoomed past it, it asks for maxSide 0, and the last decode is kept here so
 * that does not decode again.
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
  let exif = null;
  try { exif = bro.image.readExif(bytes); } catch (_) { exif = null; }
  return { img, orientation, exif };
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

/** A copy of the bytes in a buffer of their own (the decode stays cached). */
const copyBuffer = (u8) => u8.slice().buffer;

self.onmessage = async (e) => {
  const { id, op, path, size, maxSide } = e.data || {};
  try {
    const { img, orientation, exif } = decode(path);
    if (op === 'png') {
      const png = bro.image.encodePng(img.pixels, img.width, img.height, 4);
      if (!png) throw new Error('could not encode the image');
      const buf = copyBuffer(png);
      self.postMessage({ id, png: buf }, [buf]);
      return;
    }
    if (op === 'thumb') {
      const small = shrink(img, size || 256);
      const png = bro.image.encodePng(small.pixels, small.width, small.height, 4);
      if (!png) throw new Error('could not encode the preview');
      const buf = copyBuffer(png);
      self.postMessage({ id, png: buf }, [buf]);
      return;
    }
    const out = shrink(img, maxSide || 0);
    const meta = { id, width: img.width, height: img.height, orientation, exif };
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
