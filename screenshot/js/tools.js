/**
 * Annotation tool definitions, color palette, and software RGBA8 pixel
 * rasterizer (renderFlattenedPixels) for burning annotations into the saved
 * image buffer.
 */

import { clamp } from '/lib/dom.js';

export const TOOLS = [
  { id: 'select', label: 'Select & Move', icon: 'pointer', keys: ['V'] },
  { id: 'rect', label: 'Rectangle', icon: 'rect', keys: ['R'] },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse', keys: ['O'] },
  { id: 'arrow', label: 'Arrow', icon: 'arrow-up-right', keys: ['A'] },
  { id: 'line', label: 'Line', icon: 'line', keys: ['L'] },
  { id: 'pen', label: 'Freehand Pen', icon: 'pen', keys: ['P'] },
  { id: 'highlighter', label: 'Highlighter', icon: 'highlighter', keys: ['H'] },
  { id: 'text', label: 'Text', icon: 'type', keys: ['T'] },
  { id: 'blur', label: 'Blur / Redact', icon: 'pixelate', keys: ['B'] },
  { id: 'counter', label: 'Numbered Callout', icon: 'counter', keys: ['N'] },
];

export const PALETTE = [
  { id: 'red', label: 'Red', hex: '#ef4444', rgb: [239, 68, 68] },
  { id: 'orange', label: 'Orange', hex: '#f97316', rgb: [249, 115, 22] },
  { id: 'yellow', label: 'Yellow', hex: '#eab308', rgb: [234, 179, 8] },
  { id: 'green', label: 'Green', hex: '#22c55e', rgb: [34, 197, 94] },
  { id: 'blue', label: 'Blue', hex: '#3b82f6', rgb: [59, 130, 246] },
  { id: 'purple', label: 'Purple', hex: '#a855f7', rgb: [168, 85, 247] },
  { id: 'white', label: 'White', hex: '#f8fafc', rgb: [248, 250, 252] },
  { id: 'black', label: 'Black', hex: '#18181b', rgb: [24, 24, 27] },
];

export const STROKE_WIDTHS = [
  { value: 2, label: 'Thin (2px)' },
  { value: 4, label: 'Medium (4px)' },
  { value: 8, label: 'Thick (8px)' },
];

export function parseColor(color) {
  if (Array.isArray(color)) {
    return [color[0] ?? 239, color[1] ?? 68, color[2] ?? 68, color[3] ?? 255];
  }
  const s = String(color || '#ef4444').trim();
  const found = PALETTE.find((p) => p.hex.toLowerCase() === s.toLowerCase() || p.id === s.toLowerCase());
  if (found) return [found.rgb[0], found.rgb[1], found.rgb[2], 255];
  if (s.startsWith('#') && s.length === 7) {
    const r = parseInt(s.slice(1, 3), 16) || 0;
    const g = parseInt(s.slice(3, 5), 16) || 0;
    const b = parseInt(s.slice(5, 7), 16) || 0;
    return [r, g, b, 255];
  }
  return [239, 68, 68, 255];
}

// 5x7 bitmap glyphs for digits and basic ASCII characters
const GLYPHS_5X7 = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
};

function putPixel(pixels, W, H, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const idx = (y * W + x) * 4;
  if (a >= 255) {
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = 255;
  } else if (a > 0) {
    const inv = 255 - a;
    pixels[idx] = Math.round((r * a + pixels[idx] * inv) / 255);
    pixels[idx + 1] = Math.round((g * a + pixels[idx + 1] * inv) / 255);
    pixels[idx + 2] = Math.round((b * a + pixels[idx + 2] * inv) / 255);
    pixels[idx + 3] = 255;
  }
}

function fillRectPixels(pixels, W, H, x, y, w, h, r, g, b, a = 255, u32View = null) {
  const x0 = clamp(Math.round(Math.min(x, x + w)), 0, W);
  const y0 = clamp(Math.round(Math.min(y, y + h)), 0, H);
  const x1 = clamp(Math.round(Math.max(x, x + w)), 0, W);
  const y1 = clamp(Math.round(Math.max(y, y + h)), 0, H);
  if (x0 >= x1 || y0 >= y1 || a <= 0) return;
  if (a >= 255) {
    const packed = ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
    const u32 = u32View || new Uint32Array(pixels.buffer, pixels.byteOffset, W * H);
    for (let py = y0; py < y1; py++) {
      const rowBase = py * W;
      u32.fill(packed, rowBase + x0, rowBase + x1);
    }
  } else {
    const inv = 255 - a;
    const ra = r * a;
    const ga = g * a;
    const ba = b * a;
    for (let py = y0; py < y1; py++) {
      let idx = (py * W + x0) * 4;
      const endIdx = (py * W + x1) * 4;
      for (; idx < endIdx; idx += 4) {
        pixels[idx] = (ra + pixels[idx] * inv) >> 8;
        pixels[idx + 1] = (ga + pixels[idx + 1] * inv) >> 8;
        pixels[idx + 2] = (ba + pixels[idx + 2] * inv) >> 8;
        pixels[idx + 3] = 255;
      }
    }
  }
}

function strokeRectPixels(pixels, W, H, x, y, w, h, sw, r, g, b, a = 255, u32 = null) {
  const x0 = Math.round(Math.min(x, x + w));
  const y0 = Math.round(Math.min(y, y + h));
  const rw = Math.max(1, Math.round(Math.abs(w)));
  const rh = Math.max(1, Math.round(Math.abs(h)));
  const t = Math.max(1, Math.round(sw || 4));
  fillRectPixels(pixels, W, H, x0, y0, rw, t, r, g, b, a, u32);
  fillRectPixels(pixels, W, H, x0, y0 + rh - t, rw, t, r, g, b, a, u32);
  fillRectPixels(pixels, W, H, x0, y0, t, rh, r, g, b, a, u32);
  fillRectPixels(pixels, W, H, x0 + rw - t, y0, t, rh, r, g, b, a, u32);
}

function drawThickSegment(pixels, W, H, x1, y1, x2, y2, sw, r, g, b, a = 255, u32 = null) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  const rad = Math.max(0.5, (sw || 4) / 2);
  const rInt = Math.ceil(rad);
  const span = rInt * 2 + 1;
  const stepDist = Math.max(1, rad);
  const steps = Math.max(1, Math.ceil(dist / stepDist));
  const view = u32 || (a >= 255 ? new Uint32Array(pixels.buffer, pixels.byteOffset, W * H) : null);
  for (let i = 0; i <= steps; i++) {
    const cx = Math.round(x1 + (dx * i) / steps);
    const cy = Math.round(y1 + (dy * i) / steps);
    fillRectPixels(pixels, W, H, cx - rInt, cy - rInt, span, span, r, g, b, a, view);
  }
}

function drawArrowPixels(pixels, W, H, x1, y1, x2, y2, sw, r, g, b, u32 = null) {
  drawThickSegment(pixels, W, H, x1, y1, x2, y2, sw, r, g, b, 255, u32);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(10, (sw || 4) * 3.5);
  const spread = Math.PI / 6;
  const ax = x2 - headLen * Math.cos(angle - spread);
  const ay = y2 - headLen * Math.sin(angle - spread);
  const bx = x2 - headLen * Math.cos(angle + spread);
  const by = y2 - headLen * Math.sin(angle + spread);
  drawThickSegment(pixels, W, H, x2, y2, ax, ay, sw, r, g, b, 255, u32);
  drawThickSegment(pixels, W, H, x2, y2, bx, by, sw, r, g, b, 255, u32);
}

function drawEllipsePixels(pixels, W, H, x, y, w, h, sw, r, g, b, u32 = null) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.max(1, Math.abs(w) / 2);
  const ry = Math.max(1, Math.abs(h) / 2);
  const steps = Math.max(36, Math.min(120, Math.ceil(Math.PI * Math.max(rx, ry))));
  let prevX = cx + rx;
  let prevY = cy;
  for (let i = 1; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    const nx = cx + rx * Math.cos(theta);
    const ny = cy + ry * Math.sin(theta);
    drawThickSegment(pixels, W, H, prevX, prevY, nx, ny, sw, r, g, b, 255, u32);
    prevX = nx;
    prevY = ny;
  }
}

function pixelateRegion(pixels, W, H, x, y, w, h, blockSize = 10, u32View = null) {
  const x0 = clamp(Math.round(Math.min(x, x + w)), 0, W);
  const y0 = clamp(Math.round(Math.min(y, y + h)), 0, H);
  const x1 = clamp(Math.round(Math.max(x, x + w)), 0, W);
  const y1 = clamp(Math.round(Math.max(y, y + h)), 0, H);
  const bs = Math.max(4, blockSize);
  const u32 = u32View || new Uint32Array(pixels.buffer, pixels.byteOffset, W * H);
  for (let by = y0; by < y1; by += bs) {
    const bh = Math.min(bs, y1 - by);
    const sy = by + (bh >> 1);
    for (let bx = x0; bx < x1; bx += bs) {
      const bw = Math.min(bs, x1 - bx);
      const sx = bx + (bw >> 1);
      const packed = u32[sy * W + sx] | 0xff000000;
      for (let py = by; py < by + bh; py++) {
        const rowBase = py * W;
        u32.fill(packed, rowBase + bx, rowBase + bx + bw);
      }
    }
  }
}

function drawGlyphString(pixels, W, H, text, x, y, scale, r, g, b) {
  const str = String(text || '');
  let curX = Math.round(x);
  const baseY = Math.round(y);
  const s = Math.max(1, Math.round(scale));
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const rows = GLYPHS_5X7[ch];
    if (rows) {
      for (let gy = 0; gy < 7; gy++) {
        const bits = rows[gy];
        for (let gx = 0; gx < 5; gx++) {
          if ((bits >> (4 - gx)) & 1) {
            fillRectPixels(pixels, W, H, curX + gx * s, baseY + gy * s, s, s, r, g, b, 255);
          }
        }
      }
    } else if (ch !== ' ') {
      // Simple block character for letters
      fillRectPixels(pixels, W, H, curX, baseY + s, 4 * s, 5 * s, r, g, b, 255);
    }
    curX += 6 * s;
  }
}

function drawCounterPixels(pixels, W, H, cx, cy, num, r, g, b) {
  const rad = 13;
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  for (let oy = -rad; oy <= rad; oy++) {
    for (let ox = -rad; ox <= rad; ox++) {
      const d2 = ox * ox + oy * oy;
      if (d2 <= rad * rad) {
        putPixel(pixels, W, H, ix + ox, iy + oy, r, g, b, 255);
      }
    }
  }
  const label = String(num || 1);
  const tw = label.length * 6 - 1;
  drawGlyphString(pixels, W, H, label, ix - Math.floor(tw / 2), iy - 3, 1, 255, 255, 255);
}

/**
 * Burn all non-destructive annotations into a fresh RGBA8 Uint8Array copy of baseImage.
 * @param {{width: number, height: number, pixels: Uint8Array}} baseImage
 * @param {Array<object>} annotations
 * @returns {Uint8Array}
 */
export function renderFlattenedPixels(baseImage, annotations = []) {
  if (!baseImage || !baseImage.pixels) return new Uint8Array(0);
  const W = baseImage.width;
  const H = baseImage.height;
  const out = new Uint8Array(baseImage.pixels);
  const u32 = new Uint32Array(out.buffer, out.byteOffset, W * H);
  for (const ann of annotations) {
    if (!ann || !ann.type) continue;
    const [r, g, b] = parseColor(ann.color);
    const sw = ann.strokeWidth || 4;
    switch (ann.type) {
      case 'rect':
        if (ann.filled) fillRectPixels(out, W, H, ann.x, ann.y, ann.w, ann.h, r, g, b, 255, u32);
        else strokeRectPixels(out, W, H, ann.x, ann.y, ann.w, ann.h, sw, r, g, b, 255, u32);
        break;
      case 'highlighter':
        if (ann.w != null && ann.h != null) {
          fillRectPixels(out, W, H, ann.x, ann.y, ann.w, ann.h, r, g, b, 105, u32);
        } else if (ann.x1 != null) {
          drawThickSegment(out, W, H, ann.x1, ann.y1, ann.x2, ann.y2, Math.max(14, sw * 4), r, g, b, 105, u32);
        }
        break;
      case 'ellipse':
        drawEllipsePixels(out, W, H, ann.x, ann.y, ann.w, ann.h, sw, r, g, b, u32);
        break;
      case 'line':
        drawThickSegment(out, W, H, ann.x1 ?? ann.x, ann.y1 ?? ann.y, ann.x2 ?? (ann.x + ann.w), ann.y2 ?? (ann.y + ann.h), sw, r, g, b, 255, u32);
        break;
      case 'arrow':
        drawArrowPixels(out, W, H, ann.x1 ?? ann.x, ann.y1 ?? ann.y, ann.x2 ?? (ann.x + ann.w), ann.y2 ?? (ann.y + ann.h), sw, r, g, b, u32);
        break;
      case 'pen':
        if (Array.isArray(ann.points) && ann.points.length > 0) {
          if (ann.points.length === 1) {
            drawThickSegment(out, W, H, ann.points[0].x, ann.points[0].y, ann.points[0].x, ann.points[0].y, sw, r, g, b, 255, u32);
          } else {
            for (let i = 1; i < ann.points.length; i++) {
              drawThickSegment(out, W, H, ann.points[i - 1].x, ann.points[i - 1].y, ann.points[i].x, ann.points[i].y, sw, r, g, b, 255, u32);
            }
          }
        }
        break;
      case 'blur':
        pixelateRegion(out, W, H, ann.x, ann.y, ann.w, ann.h, ann.blockSize || 10, u32);
        break;
      case 'counter':
        drawCounterPixels(out, W, H, ann.x, ann.y, ann.number || 1, r, g, b);
        break;
      case 'text':
        drawGlyphString(out, W, H, ann.text || 'Text', ann.x, ann.y, 2, r, g, b);
        break;
    }
  }
  return out;
}
