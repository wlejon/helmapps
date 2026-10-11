/**
 * The burst's media thread: the small pictures the stabilize view draws, and
 * the export, rendered from each photo's full resolution and encoded here
 * (bro's encoders run in a worker) so no frame crosses to the page.
 *
 *   { id, op: 'preview', path, maxSide }   -> { id, bitmap, width, height }
 *       an ImageBitmap at most maxSide on its long side; width / height the photo's own
 *   { id, op: 'export', format: 'gif' | 'webm', out, crop, width, height, fps,
 *     frames: [{ path, T, delayCs?, repeats? }] }
 *       -> { id, progress, done: i, total } after each frame, then
 *          { id, finished: true, frames, bytes }
 *       crop [x, y, w, h] in stabilized coordinates, T each frame's
 *       stabilized -> photo matrix (js/burst/stabilize.js), width x height the
 *       output; a GIF frame shows for delayCs, a WebM frame is written
 *       `repeats` times at fps
 *   { op: 'cancel' }                        stops a running export (its file is removed)
 *   any may answer { id, error }
 *
 * Each output frame: the part of the photo the crop lands on (plus a margin)
 * is cropped from the full decode, resized toward the output's scale with
 * an area filter (no aliasing from a 24 MP photo shrunk to 720 px), then
 * warped into place with a bicubic filter.
 */

import { FrameCache, cropResize } from './frames.js';
import { compose, translate, scaling, bounds, mapRect, scaleOf } from './affine.js';

const fs = require('fs');

const cache = new FrameCache(2);
let cancelled = false;

/** Output pixel (continuous) -> stabilized coordinates. */
function outputToStabilized(crop, w, h) {
  return compose(translate(crop[0], crop[1]), scaling(crop[2] / w, crop[3] / h));
}

/** Render one output frame (RGBA, w x h) of photo `path` through T. */
export function renderFrame(img, T, crop, w, h) {
  const F = compose(T, outputToStabilized(crop, w, h));         // output -> photo
  const k = w / (crop[2] * scaleOf(T));                          // output px per photo px
  const margin = 4 / Math.min(1, k);
  const b = bounds(mapRect(F, [0, 0, w, h]));
  const x0 = Math.max(0, Math.floor(b[0] - margin)), y0 = Math.max(0, Math.floor(b[1] - margin));
  const x1 = Math.min(img.width, Math.ceil(b[0] + b[2] + margin)), y1 = Math.min(img.height, Math.ceil(b[1] + b[3] + margin));
  const out = new Uint8Array(w * h * 4);
  if (x1 <= x0 || y1 <= y0) { for (let i = 3; i < out.length; i += 4) out[i] = 255; return out; }
  const B = [x0, y0, x1 - x0, y1 - y0];
  const rw = k < 1 ? Math.max(1, Math.round(B[2] * k)) : B[2];
  const rh = k < 1 ? Math.max(1, Math.round(B[3] * k)) : B[3];
  const src = cropResize(img, B, rw, rh);
  const M = compose(compose(scaling(rw / B[2], rh / B[3]), translate(-B[0], -B[1])), F);
  bro.image.warpAffineU8(out, src, { srcW: rw, srcH: rh, dstW: w, dstH: h, channels: 4, matrix: M,
    filter: 'bicubic', fill: [0, 0, 0, 255] });
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function exportAnimation(id, msg) {
  const { format, out, crop, width, height, fps = 30, frames } = msg;
  cancelled = false;
  const enc = format === 'gif'
    ? new GifEncoder({ path: out, width, height, loopCount: 0 })
    : new VideoEncoder({ path: out, width, height, fps, quality: 'good', threads: 4 });
  let written = 0;
  try {
    for (let i = 0; i < frames.length; i++) {
      await tick();                                  // a cancel gets in between frames
      if (cancelled) break;
      const f = frames[i];
      const px = renderFrame(cache.get(f.path), f.T, crop, width, height);
      if (format === 'gif') {
        enc.setNextFrameDelayCs(f.delayCs);
        enc.addFrameRGBA(px);
        written++;
      } else {
        for (let r = 0; r < (f.repeats || 1); r++) { enc.addFrameRGBA(px); written++; }
      }
      self.postMessage({ id, progress: (i + 1) / frames.length, done: i + 1, total: frames.length });
    }
  } finally {
    enc.finish();
  }
  if (cancelled) {
    try { fs.unlinkSync(out); } catch (_) { /* nothing written */ }
    self.postMessage({ id, cancelled: true });
    return;
  }
  let bytes = 0;
  try { bytes = fs.statSync(out).size; } catch (_) { bytes = 0; }
  self.postMessage({ id, finished: true, frames: written, bytes });
}

async function preview(id, { path, maxSide }) {
  const d = bro.image.decodeScaled(path, { width: maxSide, height: maxSide });
  if (!d || !d.width) throw new Error((d && d.error) || `cannot decode ${path}`);
  const view = new Uint8ClampedArray(d.pixels.buffer, d.pixels.byteOffset, d.width * d.height * 4);
  const bitmap = await createImageBitmap(new ImageData(view, d.width, d.height));
  self.postMessage({ id, bitmap, width: d.sourceWidth, height: d.sourceHeight }, [bitmap]);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  const { id, op } = msg;
  if (op === 'cancel') { cancelled = true; return; }
  try {
    if (op === 'preview') await preview(id, msg);
    else if (op === 'export') await exportAnimation(id, msg);
    else throw new Error(`unknown op ${op}`);
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
};
