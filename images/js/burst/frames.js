/**
 * Pixels from photos, for the burst workers (never the page): whole decodes
 * kept for the frames in use, crops resized to a working size, masks moved
 * between crops. Rects are integer [x, y, w, h] in the photo's upright full
 * resolution pixels.
 *
 *   const cache = new FrameCache(3);
 *   const img = cache.get(path);                       // { width, height, pixels } upright RGBA
 *   const px = cropResize(img, rect, 512, 512);        // RGBA bytes, area filter
 *   const m = maskInto(mask, rect, 512, 512);          // a stored mask resampled into that crop
 */

import { compose, translate, scaling } from './affine.js';

const fs = require('fs');

export class FrameCache {
  constructor(keep = 3) {
    this.keep = keep;
    this.map = new Map();
  }

  get(path) {
    let img = this.map.get(path);
    if (img) {
      this.map.delete(path);
      this.map.set(path, img);
      return img;
    }
    const d = bro.image.decodeOriented(fs.readFileSync(path));
    if (!d || !d.width || !d.height) throw new Error((d && d.error) || `cannot decode ${path}`);
    img = { width: d.width, height: d.height, pixels: d.pixels };
    this.map.set(path, img);
    while (this.map.size > this.keep) this.map.delete(this.map.keys().next().value);
    return img;
  }

  drop(path) { this.map.delete(path); }
  clear() { this.map.clear(); }
}

/** Width, height (upright) and EXIF time of a photo, without decoding it whole. */
export function photoInfo(path) {
  let exif = null;
  try { exif = bro.image.readExif(path); } catch (_) { exif = null; }
  const small = bro.image.decodeScaled(path, { width: 32, height: 32 });
  if (!small || !small.sourceWidth) throw new Error((small && small.error) || `cannot read ${path}`);
  return { width: small.sourceWidth, height: small.sourceHeight, dateTaken: (exif && exif.dateTaken) || '' };
}

/** An integer square of side `side` centred at (cx, cy), moved to lie inside w x h where it fits. */
export function squareAround(cx, cy, side, w, h) {
  const s = Math.max(16, Math.round(side));
  let x = Math.round(cx - s / 2), y = Math.round(cy - s / 2);
  if (s <= w) x = Math.min(Math.max(0, x), w - s);
  if (s <= h) y = Math.min(Math.max(0, y), h - s);
  return [x, y, s, s];
}

/**
 * The rect [x, y, w, h] of `img` resized to outW x outH (RGBA). Parts of the
 * rect outside the photo repeat its edge. Area filter when shrinking,
 * bicubic when enlarging.
 */
export function cropResize(img, rect, outW, outH) {
  const [x, y, w, h] = rect;
  const crop = new Uint8Array(w * h * 4);
  bro.image.cropU8(crop, img.pixels, { srcW: img.width, srcH: img.height, channels: 4, x, y, w, h });
  if (w === outW && h === outH) return crop;
  const out = new Uint8Array(outW * outH * 4);
  bro.image.resizeU8(out, crop, { srcW: w, srcH: h, dstW: outW, dstH: outH, channels: 4,
    filter: outW < w ? 'area' : 'bicubic' });
  return out;
}

/**
 * A mask { rect, size, data } (data: size x size bytes, nonzero = subject,
 * covering rect) resampled into the crop `rect` at outW x outH, as 0/255.
 */
export function maskInto(mask, rect, outW, outH) {
  const [mx, my, mw, mh] = mask.rect;
  // Destination pixel -> full coordinates -> the mask's pixels.
  const toFull = compose(translate(rect[0], rect[1]), scaling(rect[2] / outW, rect[3] / outH));
  const toMask = compose(scaling(mask.size / mw, mask.size / mh), translate(-mx, -my));
  const out = new Uint8Array(outW * outH);
  bro.image.warpAffineU8(out, binary(mask.data), { srcW: mask.size, srcH: mask.size, dstW: outW, dstH: outH,
    channels: 1, matrix: compose(toMask, toFull), filter: 'nearest' });
  return out;
}

function binary(data) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ? 255 : 0;
  return out;
}

/** The mask grown by r pixels (a square neighbourhood), in place of a copy. */
export function dilate(mask, w, h, r) {
  if (r < 1) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  // Rows, then columns: a running count of set pixels in the window.
  for (let y = 0; y < h; y++) {
    let n = 0;
    const row = y * w;
    for (let x = 0; x < Math.min(w, r); x++) if (mask[row + x]) n++;
    for (let x = 0; x < w; x++) {
      if (x + r < w && mask[row + x + r]) n++;
      if (x - r - 1 >= 0 && mask[row + x - r - 1]) n--;
      tmp[row + x] = n > 0 ? 255 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < Math.min(h, r); y++) if (tmp[y * w + x]) n++;
    for (let y = 0; y < h; y++) {
      if (y + r < h && tmp[(y + r) * w + x]) n++;
      if (y - r - 1 >= 0 && tmp[(y - r - 1) * w + x]) n--;
      out[y * w + x] = n > 0 ? 255 : 0;
    }
  }
  return out;
}

/**
 * What a model's mask (w x h, over the crop `rect`) says about the subject,
 * in full coordinates: { area, centroid: [x, y], bbox: [x, y, w, h], touches }
 * (touches: the mask reaches the crop's edge, so the crop was too small).
 */
export function measureMask(data, w, h, rect) {
  let n = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!data[row + x]) continue;
      n++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const kx = rect[2] / w, ky = rect[3] / h;
  if (!n) return { area: 0, centroid: [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2], bbox: [0, 0, 0, 0], touches: false };
  return {
    area: n * kx * ky,
    centroid: [rect[0] + (sx / n + 0.5) * kx, rect[1] + (sy / n + 0.5) * ky],
    bbox: [rect[0] + x0 * kx, rect[1] + y0 * ky, (x1 - x0 + 1) * kx, (y1 - y0 + 1) * ky],
    touches: x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1,
  };
}

/**
 * The mask's connected regions of at least `minShare` of the largest one
 * (a stray leaf or a splash the model added away from the bird goes), as a
 * new 0/1 mask.
 */
export function keepMain(data, w, h, minShare = 0.15) {
  const label = new Int32Array(w * h);
  const sizes = [0];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!data[s] || label[s]) continue;
    const id = sizes.length;
    let n = 0;
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop();
      n++;
      const x = i % w;
      if (x > 0 && data[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && data[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (i >= w && data[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
      if (i + w < w * h && data[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
    }
    sizes.push(n);
  }
  const largest = Math.max(0, ...sizes);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (label[i] && sizes[label[i]] >= largest * minShare) out[i] = 1;
  return out;
}

/** A mask shrunk to size x size for keeping (and sending to the page): area-averaged, thresholded. */
export function shrinkMask(data, w, h, size) {
  const src = binary(data);
  if (w === size && h === size) return src;
  const out = new Uint8Array(size * size);
  bro.image.resizeU8(out, src, { srcW: w, srcH: h, dstW: size, dstH: size, channels: 1, filter: 'area' });
  for (let i = 0; i < out.length; i++) out[i] = out[i] >= 128 ? 255 : 0;
  return out;
}
