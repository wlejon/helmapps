/**
 * Screen capture: bro.window.captureScreen({ display, cursor }) reads the
 * desktop on every platform (bro's docs/screen-capture.md), behind the
 * `screen` capability. Tests install a source of their own instead
 * (`setCaptureSource`).
 */

import { api, clamp } from '/lib/dom.js';

const fs = require('fs');

let customSource = null;
let lastError = '';

/**
 * Replace the screen capture source (used by headless acceptance tests).
 * Passing null restores native screen capture.
 * @param {((display?: number|'all'|'primary') => ({width:number,height:number,pixels:Uint8Array}|Promise<{width:number,height:number,pixels:Uint8Array}>))|null} fn
 */
export function setCaptureSource(fn) {
  customSource = fn || null;
}

export function getCaptureSource() {
  return customSource;
}

/** The displays bro can capture ([] where it can read no desktop). */
export function captureDisplays() {
  const win = typeof bro !== 'undefined' && bro.window ? bro.window : null;
  if (!win || typeof win.captureDisplays !== 'function') return [];
  try {
    return win.captureDisplays() || [];
  } catch (_) {
    return [];
  }
}

/** Whether capture can run right now. */
export function hasCaptureAvailable() {
  return typeof customSource === 'function' || captureDisplays().length > 0;
}

/** Why the last capture failed ('' after a success). */
export function lastCaptureError() {
  return lastError;
}

/** Human-readable explanation when screen capture is unavailable. */
export function captureUnavailableReason() {
  if (hasCaptureAvailable()) return '';
  return 'Screen capture is unavailable here: bro sees no desktop to read. You can still open and annotate existing images.';
}

/**
 * Generate a deterministic RGBA8 image buffer for testing.
 * @param {number} [width=800]
 * @param {number} [height=500]
 * @param {number[]|null} [fill=null] Optional solid [r, g, b, a] fill color
 * @returns {{width: number, height: number, channels: number, pixels: Uint8Array}}
 */
export function createSyntheticSource(width = 800, height = 500, fill = null) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const pixels = new Uint8Array(w * h * 4);
  if (Array.isArray(fill) && fill.length >= 3) {
    const r = fill[0] & 255;
    const g = fill[1] & 255;
    const b = fill[2] & 255;
    const a = fill.length >= 4 ? (fill[3] & 255) : 255;
    const packed = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    new Uint32Array(pixels.buffer).fill(packed);
    return { width: w, height: h, channels: 4, pixels };
  }
  const hm1 = Math.max(1, h - 1);
  const wm1 = Math.max(1, w - 1);
  for (let y = 0; y < h; y++) {
    const ry = ((y * 140) / hm1 + 32) | 0;
    const gridY = (y & 63) === 0;
    let idx = y * w * 4;
    for (let x = 0; x < w; x++, idx += 4) {
      const rx = ((x * 160) / wm1 + 40) | 0;
      const grid = gridY || (x & 63) === 0;
      pixels[idx] = grid ? (rx + 35 > 255 ? 255 : rx + 35) : rx;
      pixels[idx + 1] = grid ? (ry + 35 > 255 ? 255 : ry + 35) : ry;
      pixels[idx + 2] = grid ? 195 : 150;
      pixels[idx + 3] = 255;
    }
  }
  return { width: w, height: h, channels: 4, pixels };
}

/** Wait for N animation frames so window state settles before capture. */
export function waitFrames(count = 2) {
  return new Promise((resolve) => {
    let left = Math.max(1, count);
    const step = () => {
      if (--left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function normalizeFrame(frame) {
  if (!frame || !frame.width || !frame.height || !frame.pixels) return null;
  const pixels = frame.pixels instanceof Uint8Array
    ? frame.pixels
    : new Uint8Array(frame.pixels.buffer || frame.pixels);
  return { width: frame.width, height: frame.height, channels: 4, pixels };
}

/**
 * The capture display the app's window is on (its centre), else the primary.
 * @returns {number|'primary'}
 */
export function currentDisplay() {
  const displays = captureDisplays();
  const win = typeof bro !== 'undefined' && bro.window ? bro.window : null;
  try {
    const pos = win && typeof win.getPosition === 'function' ? win.getPosition() : null;
    const size = win && typeof win.getSize === 'function' ? win.getSize() : null;
    if (pos && size) {
      const cx = pos.x + size.width / 2;
      const cy = pos.y + size.height / 2;
      const hit = displays.find((d) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height);
      if (hit) return hit.index;
    }
  } catch (_) {}
  return 'primary';
}

/**
 * Capture the desktop (or run the custom capture source when installed).
 * Hides the app window for two frames during a real capture so our own
 * window never appears in the screenshot.
 * @param {{display?: number|'all'|'primary', cursor?: boolean}} [options]
 * @returns {Promise<{width: number, height: number, channels: number, pixels: Uint8Array}|null>}
 */
export async function captureOutput({ display = 'all', cursor = false } = {}) {
  lastError = '';
  if (typeof customSource === 'function') {
    return normalizeFrame(await customSource(display));
  }
  if (!hasCaptureAvailable()) {
    lastError = captureUnavailableReason();
    return null;
  }

  const win = bro.window;
  let prevOpacity = 1;
  try {
    if (typeof win.getOpacity === 'function') prevOpacity = win.getOpacity();
    if (typeof win.setOpacity === 'function') win.setOpacity(0);
  } catch (_) {}
  await waitFrames(2);

  let frame = null;
  try {
    frame = normalizeFrame(await win.captureScreen({ display, cursor }));
  } catch (err) {
    lastError = (err && err.message) || String(err);
  } finally {
    try {
      if (typeof win.setOpacity === 'function') win.setOpacity(prevOpacity);
    } catch (_) {}
  }
  return frame;
}

/**
 * Decode an existing image file into an upright RGBA8 buffer.
 * Reads bytes via fs.promises.readFile off the UI thread, then decodes via
 * bro.image.decodeOriented.
 * @param {string} filePath
 * @returns {Promise<{width: number, height: number, channels: number, pixels: Uint8Array, error?: string}>}
 */
export async function openImageBuffer(filePath) {
  const imgApi = api('image');
  if (!imgApi || typeof imgApi.decodeOriented !== 'function') {
    return { width: 0, height: 0, channels: 4, pixels: new Uint8Array(0), error: 'bro.image is unavailable' };
  }
  try {
    const buf = await fs.promises.readFile(filePath);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const decoded = imgApi.decodeOriented(bytes);
    if (!decoded || !decoded.width || !decoded.height) {
      return { width: 0, height: 0, channels: 4, pixels: new Uint8Array(0), error: (decoded && decoded.error) || 'Could not decode image' };
    }
    return {
      width: decoded.width,
      height: decoded.height,
      channels: 4,
      pixels: decoded.pixels instanceof Uint8Array ? decoded.pixels : new Uint8Array(decoded.pixels),
    };
  } catch (err) {
    return { width: 0, height: 0, channels: 4, pixels: new Uint8Array(0), error: err.message || String(err) };
  }
}

/**
 * Crop an RGBA8 image buffer to `{ x, y, w, h }` using bro.image.cropU8.
 * @param {{width: number, height: number, pixels: Uint8Array}} image
 * @param {{x: number, y: number, w: number, h: number}} rect
 * @returns {{width: number, height: number, channels: number, pixels: Uint8Array}}
 */
export function cropImageBuffer(image, rect) {
  const x = clamp(Math.round(rect.x), 0, Math.max(0, image.width - 1));
  const y = clamp(Math.round(rect.y), 0, Math.max(0, image.height - 1));
  const w = clamp(Math.round(rect.w), 1, Math.max(1, image.width - x));
  const h = clamp(Math.round(rect.h), 1, Math.max(1, image.height - y));
  const dst = new Uint8Array(w * h * 4);
  const imgApi = api('image');
  if (imgApi && typeof imgApi.cropU8 === 'function') {
    imgApi.cropU8(dst, image.pixels, {
      srcW: image.width,
      srcH: image.height,
      channels: 4,
      x,
      y,
      w,
      h,
    });
  } else {
    for (let row = 0; row < h; row++) {
      const srcOff = ((y + row) * image.width + x) * 4;
      const dstOff = row * w * 4;
      dst.set(image.pixels.subarray(srcOff, srcOff + w * 4), dstOff);
    }
  }
  return { width: w, height: h, channels: 4, pixels: dst };
}
