/**
 * Screen capture across platforms:
 * 1. Custom test source (`setCaptureSource`)
 * 2. Engine window capture (`bro.window.captureScreen`)
 * 3. Wayland wlr-screencopy (`bro.wl.captureOutput`)
 * 4. XDG Desktop Portal (`bro.portal.screenshot`)
 * 5. Native OS CLI fallback (`screencapture -x` on macOS, PowerShell
 *    `System.Drawing.Bitmap` / `CopyFromScreen` on Windows, `grim` on Linux)
 * 6. Synthetic test pattern fallback when permissions or tools are unavailable.
 */

import { api, apiReason, clamp } from '/lib/dom.js';

const fs = require('fs');
const os = require('os');
const path = require('path');

let childProcess = null;
try {
  childProcess = require('child_process');
} catch (_) {
  childProcess = null;
}

let customSource = null;

function isHeadlessSession() {
  return typeof screenshot === 'function';
}

/**
 * Replace the screen capture source (used by headless acceptance tests).
 * Passing null restores native screen capture.
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
  const wl = api('wl');
  return !!(wl && typeof wl.hasScreencopy === 'function' && wl.hasScreencopy());
}

/** Whether engine window screen capture or portal screenshot is available. */
export function hasEngineCapture() {
  if (typeof bro !== 'undefined') {
    if (bro.window && typeof bro.window.captureScreen === 'function') return true;
    if (bro.portal && typeof bro.portal.screenshot === 'function') return true;
  }
  return hasScreencopy();
}

/** Whether OS native command-line capture fallback is available. */
export function hasOsCaptureFallback() {
  if (isHeadlessSession()) return false;
  if (!childProcess || typeof childProcess.spawnSync !== 'function') return false;
  const plat = typeof process !== 'undefined' ? process.platform : '';
  return plat === 'darwin' || plat === 'win32' || plat === 'linux';
}

/** Whether capture can run right now. */
export function hasCaptureAvailable() {
  return (
    typeof customSource === 'function' ||
    hasEngineCapture() ||
    hasOsCaptureFallback()
  );
}

/** Human-readable explanation when screen capture is unavailable. */
export function captureUnavailableReason() {
  const reason = apiReason('wl');
  if (reason && isHeadlessSession()) return reason;
  if (!hasCaptureAvailable()) {
    return 'Screen capture is unavailable in this environment (no Wayland screencopy, portal, or native OS capture tool). You can still open and annotate existing images.';
  }
  return '';
}

/**
 * Generate a deterministic RGBA8 image buffer for testing or fallback.
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
 * Capture the desktop to a temporary PNG using OS-native tools:
 * - macOS: `screencapture -x <tmp.png>`
 * - Windows: PowerShell `System.Drawing.Bitmap` + `Graphics.CopyFromScreen`
 * - Linux: `grim <tmp.png>`
 */
export async function captureViaOsCommand() {
  if (!childProcess || typeof childProcess.spawnSync !== 'function') return null;
  const plat = typeof process !== 'undefined' ? process.platform : '';
  const tmpDir = (os && typeof os.tmpdir === 'function' && os.tmpdir()) || '/tmp';
  const tmpFile = path.join(tmpDir, `bro-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);

  try {
    if (plat === 'darwin') {
      childProcess.spawnSync('/usr/sbin/screencapture', ['-x', tmpFile], { timeout: 8000 });
    } else if (plat === 'win32') {
      const escaped = tmpFile.replace(/'/g, "''");
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
        '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;',
        '$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height);',
        '$g = [System.Drawing.Graphics]::FromImage($bmp);',
        '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size);',
        `$bmp.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png);`,
        '$g.Dispose();',
        '$bmp.Dispose();',
      ].join(' ');
      childProcess.spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { timeout: 10000, windowsHide: true }
      );
    } else if (plat === 'linux') {
      childProcess.spawnSync('grim', [tmpFile], { timeout: 6000 });
    } else {
      return null;
    }

    if (!fs.existsSync(tmpFile)) return null;
    const decoded = await openImageBuffer(tmpFile);
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    if (decoded && decoded.width > 0 && decoded.height > 0 && decoded.pixels.length > 0) {
      return { width: decoded.width, height: decoded.height, channels: 4, pixels: decoded.pixels };
    }
  } catch (_) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (__) {}
  }
  return null;
}

/**
 * Capture an output (or run the custom capture source when installed).
 * Hides the app window for two frames during real desktop capture so our
 * own window never appears in the screenshot.
 * @param {number} [outputIndex=0]
 * @returns {Promise<{width: number, height: number, channels: number, pixels: Uint8Array}|null>}
 */
export async function captureOutput(outputIndex = 0) {
  if (typeof customSource === 'function') {
    const res = await customSource(outputIndex);
    return normalizeFrame(res);
  }

  if (!hasCaptureAvailable()) return null;

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
    // 1. Engine window capture API (`bro.window.captureScreen`)
    if (win && typeof win.captureScreen === 'function') {
      const res = await win.captureScreen(outputIndex);
      if (typeof res === 'string' && res.length > 0) {
        frame = await openImageBuffer(res);
      } else {
        frame = normalizeFrame(res);
      }
    }

    // 2. Wayland wlr-screencopy (`bro.wl.captureOutput`)
    if (!frame && hasScreencopy()) {
      const wl = api('wl');
      frame = normalizeFrame(await wl.captureOutput(outputIndex));
    }

    // 3. XDG Desktop Portal (`bro.portal.screenshot`)
    if (!frame && typeof bro !== 'undefined' && bro.portal && typeof bro.portal.screenshot === 'function') {
      const portalRes = await bro.portal.screenshot();
      if (typeof portalRes === 'string' && portalRes.length > 0) {
        const filePath = portalRes.startsWith('file://') ? decodeURIComponent(portalRes.slice(7)) : portalRes;
        frame = await openImageBuffer(filePath);
      } else if (portalRes && typeof portalRes.path === 'string') {
        frame = await openImageBuffer(portalRes.path);
      } else {
        frame = normalizeFrame(portalRes);
      }
    }

    // 4. Native OS CLI fallback (`screencapture -x` on macOS, PowerShell `CopyFromScreen` on Windows)
    if (!frame && hasOsCaptureFallback()) {
      frame = await captureViaOsCommand();
    }

    // 5. Synthetic test pattern fallback if permissions or tools are unavailable in a desktop session
    if (!frame && !isHeadlessSession()) {
      frame = createSyntheticSource();
    }
  } finally {
    if (win) {
      try {
        if (typeof win.restore === 'function') win.restore();
        if (typeof win.setOpacity === 'function') win.setOpacity(prevOpacity);
      } catch (_) {}
    }
  }

  return normalizeFrame(frame);
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
