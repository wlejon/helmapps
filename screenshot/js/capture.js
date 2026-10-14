/**
 * Screen capture (Wayland wlr-screencopy via bro.wl.captureOutput), replaceable
 * synthetic capture source for headless testing, image file loading, and
 * buffer cropping via bro.image.cropU8.
 */

import { api, apiReason, clamp } from '/lib/dom.js';

const fs = require('fs');

let customSource = null;

/**
 * Replace the screen capture source (used by headless acceptance tests).
 * Passing null restores native Wayland screencopy.
 * @param {((outputIndex?: number) => ({width:number,height:number,pixels:Uint8Array}|Promise<{width:number,height:number,pixels:Uint8Array}>))|null} fn
 */
export function setCaptureSource(fn) {
  customSource = fn || null;
}

export function getCaptureSource() {
  return customSource;
}

/** Whether native Wayland screencopy is available in this session. */
export function hasScreencopy() {
  if (typeof bro !== 'undefined' && bro.window && bro.window.displayMode === 'headless') {
    return false;
  }
  const wl = api('wl');
  return !!(wl && typeof wl.hasScreencopy === 'function' && wl.hasScreencopy());
}

/** Whether capture can run right now (either native screencopy or custom test source). */
export function hasCaptureAvailable() {
  return typeof customSource === 'function' || hasScreencopy();
}

/** Human-readable explanation when screen capture is unavailable. */
export function captureUnavailableReason() {
  const reason = apiReason('wl');
  if (reason) return reason;
  if (!hasScreencopy()) {
    return 'Wayland screencopy (wlr-screencopy) is not supported by the current display server. You can still open and annotate existing images.';
  }
  return '';
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

/** Wait for N animation frames so window state settles before screencopy. */
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

/**
 * Capture an output (or run the custom capture source when installed).
 * Hides the app window for two frames during real Wayland screencopy so our
 * own window never appears in the screenshot.
 * @param {number} [outputIndex=0]
 * @returns {Promise<{width: number, height: number, channels: number, pixels: Uint8Array}|null>}
 */
export async function captureOutput(outputIndex = 0) {
  if (typeof customSource === 'function') {
    const res = await customSource(outputIndex);
    if (!res || !res.width || !res.height || !res.pixels) return null;
    const pixels = res.pixels instanceof Uint8Array
      ? res.pixels
      : new Uint8Array(res.pixels.buffer || res.pixels);
    return { width: res.width, height: res.height, channels: 4, pixels };
  }

  if (!hasScreencopy()) return null;

  const wl = api('wl');
  const win = typeof bro !== 'undefined' && bro.window ? bro.window : null;
  let prevOpacity = 1;
  if (win) {
    try {
      if (typeof win.getOpacity === 'function') prevOpacity = win.getOpacity();
      if (typeof win.setOpacity === 'function') win.setOpacity(0);
      if (typeof win.minimize === 'function') win.minimize();
    } catch (_) {}
  }

  await waitFrames(2);

  let frame = null;
  try {
    frame = await wl.captureOutput(outputIndex);
  } finally {
    if (win) {
      try {
        if (typeof win.restore === 'function') win.restore();
        if (typeof win.setOpacity === 'function') win.setOpacity(prevOpacity);
      } catch (_) {}
    }
  }

  if (!frame || !frame.width || !frame.height || !frame.pixels) return null;
  const pixels = frame.pixels instanceof Uint8Array
    ? frame.pixels
    : new Uint8Array(frame.pixels.buffer || frame.pixels);
  return { width: frame.width, height: frame.height, channels: 4, pixels };
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
