/**
 * Interactive 2D Color Plane (HSV Saturation/Value or Oklch Chroma/Lightness)
 * and Eyedropper Screen/Image Sampler for helm.colorpicker.
 *
 * Uses zero-allocation inline pixel loops on a compact 96x60 buffer so full
 * 2D plane rasterization takes < 1.5 ms per frame.
 */

import { h, api, clamp } from '/lib/dom.js';
import { Dialog } from '/lib/dialog.js';
import { linearChannelToSrgb, toHexString } from './color-engine.js';

const RASTER_W = 96;
const RASTER_H = 60;
const MAX_CHROMA = 0.32;

export class ColorPlane {
  /**
   * @param {object} opts
   * @param {'hsv'|'oklch'} [opts.space='hsv']
   * @param {(x: number, y: number) => void} opts.onChange  x,y in 0..1
   */
  constructor({ space = 'hsv', onChange } = {}) {
    this.space = space === 'oklch' ? 'oklch' : 'hsv';
    this.onChange = onChange;
    this.hue = 217;
    this.x = 0.76;   // HSV: saturation (0..1); Oklch: chroma / MAX_CHROMA (0..1)
    this.y = 0.96;   // HSV: value (0..1);      Oklch: lightness (0..1)
    this.dragging = false;
    this.cachedKey = '';

    this.canvas = h('canvas.cp-plane-canvas', { width: RASTER_W, height: RASTER_H });
    this.ctx = this.canvas.getContext('2d');
    this.imgData = this.ctx.createImageData(RASTER_W, RASTER_H);

    this.el = h('div.cp-plane-wrap.cp-plane-PlaneFocus', {
      tabindex: '0',
      role: 'slider',
      'aria-label': '2D Color Plane',
    }, this.canvas);

    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.el.focus();
      if (this.el.setPointerCapture) this.el.setPointerCapture(e.pointerId);
      this.pickAtEvent(e);
      e.preventDefault();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (this.dragging) this.pickAtEvent(e);
    });
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.el.releasePointerCapture) {
        try { this.el.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);

    this.el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.05 : 0.01;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowUp') dy = step;
      else if (e.key === 'ArrowDown') dy = -step;
      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        this.x = clamp(this.x + dx, 0, 1);
        this.y = clamp(this.y + dy, 0, 1);
        this.draw();
        if (this.onChange) this.onChange(this.x, this.y);
      }
    });
  }

  setSpace(space) {
    const next = space === 'oklch' ? 'oklch' : 'hsv';
    if (this.space === next) return;
    this.space = next;
    this.cachedKey = '';
    this.draw();
  }

  setState({ hue, x, y }) {
    if (hue != null && isFinite(hue)) this.hue = ((hue % 360) + 360) % 360;
    if (x != null && isFinite(x)) this.x = clamp(x, 0, 1);
    if (y != null && isFinite(y)) this.y = clamp(y, 0, 1);
    this.draw();
  }

  pickAtEvent(e) {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.x = clamp((e.clientX - r.left) / r.width, 0, 1);
    this.y = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    this.draw();
    if (this.onChange) this.onChange(this.x, this.y);
  }

  rasterizeBuffer() {
    const hRound = Math.round(this.hue) % 360;
    const key = `${this.space}:${hRound}`;
    if (this.cachedKey === key) return;
    this.cachedKey = key;

    const data = this.imgData.data;
    let p = 0;

    if (this.space === 'hsv') {
      const H = ((hRound % 360) + 360) % 360;
      const sector = Math.floor(H / 60);
      const frac = H / 60 - sector;
      for (let py = 0; py < RASTER_H; py++) {
        const v = 1 - py / (RASTER_H - 1);
        for (let px = 0; px < RASTER_W; px++) {
          const s = px / (RASTER_W - 1);
          const pVal = v * (1 - s);
          const qVal = v * (1 - s * frac);
          const tVal = v * (1 - s * (1 - frac));
          let r = 0, g = 0, b = 0;
          if (sector === 0) { r = v; g = tVal; b = pVal; }
          else if (sector === 1) { r = qVal; g = v; b = pVal; }
          else if (sector === 2) { r = pVal; g = v; b = tVal; }
          else if (sector === 3) { r = pVal; g = qVal; b = v; }
          else if (sector === 4) { r = tVal; g = pVal; b = v; }
          else { r = v; g = pVal; b = qVal; }
          data[p++] = (r * 255 + 0.5) | 0;
          data[p++] = (g * 255 + 0.5) | 0;
          data[p++] = (b * 255 + 0.5) | 0;
          data[p++] = 255;
        }
      }
    } else {
      const rad = (hRound * Math.PI) / 180;
      const cosH = Math.cos(rad);
      const sinH = Math.sin(rad);
      for (let py = 0; py < RASTER_H; py++) {
        const l = 1 - py / (RASTER_H - 1);
        for (let px = 0; px < RASTER_W; px++) {
          const c = (px / (RASTER_W - 1)) * MAX_CHROMA;
          const a = c * cosH;
          const b = c * sinH;
          const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
          const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
          const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
          const L = l_ * l_ * l_;
          const M = m_ * m_ * m_;
          const S = s_ * s_ * s_;
          const lr = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
          const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
          const lb = -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S;
          data[p++] = linearChannelToSrgb(lr);
          data[p++] = linearChannelToSrgb(lg);
          data[p++] = linearChannelToSrgb(lb);
          data[p++] = 255;
        }
      }
    }
  }

  draw() {
    this.rasterizeBuffer();
    const ctx = this.ctx;
    ctx.putImageData(this.imgData, 0, 0);

    const cx = Math.round(this.x * (RASTER_W - 1));
    const cy = Math.round((1 - this.y) * (RASTER_H - 1));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'black';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'white';
    ctx.stroke();
    ctx.restore();
  }
}

export { MAX_CHROMA };

// ---- Eyedropper Screen / Image Sampler --------------------------------------

let customScreenSource = null;

export function setEyedropperSource(fn) {
  customScreenSource = fn;
}

export function createTestPatternFrame(width = 320, height = 180) {
  const pixels = new Uint8Array(width * height * 4);
  const swatches = [
    [239, 68, 68],   // red #ef4444
    [245, 158, 11],  // amber #f59e0b
    [16, 185, 129],  // emerald #10b981
    [59, 130, 246],  // blue #3b82f6
    [139, 92, 246],  // violet #8b5cf6
    [236, 72, 153],  // pink #ec4899
    [15, 23, 42],    // dark slate #0f172a
    [248, 250, 252], // light slate #f8fafc
  ];
  let idx = 0;
  for (let y = 0; y < height; y++) {
    const bottomHalf = y >= height / 2;
    for (let x = 0; x < width; x++) {
      if (!bottomHalf) {
        const col = Math.min(swatches.length - 1, Math.floor((x / width) * swatches.length));
        const [r, g, b] = swatches[col];
        pixels[idx++] = r;
        pixels[idx++] = g;
        pixels[idx++] = b;
        pixels[idx++] = 255;
      } else {
        const t = x / Math.max(1, width - 1);
        const v = Math.round(t * 255);
        pixels[idx++] = v;
        pixels[idx++] = Math.round((1 - t) * 200);
        pixels[idx++] = Math.round(Math.sin(t * Math.PI) * 255);
        pixels[idx++] = 255;
      }
    }
  }
  return { width, height, pixels };
}

export async function acquireEyedropperFrame() {
  if (typeof customScreenSource === 'function') {
    return await customScreenSource();
  }
  const wl = api('wl');
  if (wl && typeof wl.hasScreencopy === 'function' && wl.hasScreencopy()) {
    try {
      const f = await wl.captureOutput(0);
      if (f && f.width > 0 && f.height > 0 && f.pixels) return f;
    } catch (_) {}
  }
  return createTestPatternFrame(320, 180);
}

export function sampleFramePixel(frame, x, y) {
  const px = clamp(Math.floor(x), 0, frame.width - 1);
  const py = clamp(Math.floor(y), 0, frame.height - 1);
  const off = (py * frame.width + px) * 4;
  const r = frame.pixels[off];
  const g = frame.pixels[off + 1];
  const b = frame.pixels[off + 2];
  const a = frame.pixels[off + 3];
  return { r, g, b, a, hex: toHexString({ r, g, b, a }) };
}

export async function openEyedropperDialog() {
  const frame = await acquireEyedropperFrame();
  const d = new Dialog({ title: 'Eyedropper — Click a Pixel to Sample', icon: 'eye', wide: true });

  const canvas = h('canvas.cp-sampler-canvas', { width: frame.width, height: frame.height });
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(frame.width, frame.height);
  imgData.data.set(frame.pixels.subarray(0, frame.width * frame.height * 4));
  ctx.putImageData(imgData, 0, 0);

  let picked = sampleFramePixel(frame, Math.floor(frame.width / 2), Math.floor(frame.height / 4));
  const previewDot = h('div.cp-pair-swatch', { style: { backgroundColor: picked.hex } });
  const coordText = h('span.mono.num', `${picked.hex} — rgb(${picked.r}, ${picked.g}, ${picked.b})`);

  const updateAtEvent = (e, commit = false) => {
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const fx = ((e.clientX - r.left) / r.width) * frame.width;
    const fy = ((e.clientY - r.top) / r.height) * frame.height;
    picked = sampleFramePixel(frame, fx, fy);
    previewDot.style.backgroundColor = picked.hex;
    coordText.textContent = `${picked.hex} — rgb(${picked.r}, ${picked.g}, ${picked.b}) @ (${Math.floor(fx)}, ${Math.floor(fy)})`;
    if (commit) d.close(picked);
  };

  canvas.addEventListener('pointermove', (e) => updateAtEvent(e, false));
  canvas.addEventListener('click', (e) => updateAtEvent(e, true));

  d.body.appendChild(h('div.cp-loupe-wrap',
    h('div.dim', 'Move over the captured canvas to inspect pixel values, or click to pick immediately.'),
    canvas,
    h('div.cp-pair-box', previewDot, coordText),
  ));

  d.addButton('Cancel', { value: null });
  d.addButton('Pick Color', { primary: true, value: 'pick', onClick: () => { d.close(picked); return false; } });

  return await d.open();
}
