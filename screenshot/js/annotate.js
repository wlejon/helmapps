/**
 * Interactive annotation stage (Result view canvas) and fullscreen Region
 * selection overlay with scrim, rule-of-thirds grid, 8 resize handles,
 * dimension pill, and keyboard nudging.
 */

import { h, clamp, perFrame } from '/lib/dom.js';
import { promptDialog } from '/lib/dialog.js';
import { parseColor } from './tools.js';

/**
 * Draw a single annotation object onto a 2D canvas context.
 */
export function drawAnnotationOnCtx(ctx, ann, baseImage, isSelected = false) {
  if (!ann || !ann.type) return;
  const [r, g, b] = parseColor(ann.color);
  const rgbCss = `rgb(${r}, ${g}, ${b})`;
  const sw = ann.strokeWidth || 4;
  ctx.save();
  ctx.strokeStyle = rgbCss;
  ctx.fillStyle = rgbCss;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (ann.type) {
    case 'rect': {
      const x = Math.min(ann.x, ann.x + ann.w);
      const y = Math.min(ann.y, ann.y + ann.h);
      const w = Math.abs(ann.w);
      const h = Math.abs(ann.h);
      if (ann.filled) ctx.fillRect(x, y, w, h);
      else ctx.strokeRect(x + sw / 2, y + sw / 2, Math.max(1, w - sw), Math.max(1, h - sw));
      break;
    }
    case 'highlighter': {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.40)`;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.40)`;
      if (ann.w != null && ann.h != null) {
        const x = Math.min(ann.x, ann.x + ann.w);
        const y = Math.min(ann.y, ann.y + ann.h);
        ctx.fillRect(x, y, Math.abs(ann.w), Math.abs(ann.h));
      } else if (ann.x1 != null) {
        ctx.lineWidth = Math.max(14, sw * 4);
        ctx.beginPath();
        ctx.moveTo(ann.x1, ann.y1);
        ctx.lineTo(ann.x2, ann.y2);
        ctx.stroke();
      }
      break;
    }
    case 'ellipse': {
      const cx = ann.x + ann.w / 2;
      const cy = ann.y + ann.h / 2;
      const rx = Math.max(1, Math.abs(ann.w) / 2);
      const ry = Math.max(1, Math.abs(ann.h) / 2);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'line': {
      const x1 = ann.x1 ?? ann.x;
      const y1 = ann.y1 ?? ann.y;
      const x2 = ann.x2 ?? (ann.x + ann.w);
      const y2 = ann.y2 ?? (ann.y + ann.h);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const x1 = ann.x1 ?? ann.x;
      const y1 = ann.y1 ?? ann.y;
      const x2 = ann.x2 ?? (ann.x + ann.w);
      const y2 = ann.y2 ?? (ann.y + ann.h);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(10, sw * 3.5);
      const spread = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle - spread), y2 - headLen * Math.sin(angle - spread));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(angle + spread), y2 - headLen * Math.sin(angle + spread));
      ctx.stroke();
      break;
    }
    case 'pen': {
      const pts = ann.points || [];
      if (pts.length > 0) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (pts.length === 1) ctx.lineTo(pts[0].x + 0.5, pts[0].y + 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'blur': {
      const x0 = clamp(Math.round(Math.min(ann.x, ann.x + ann.w)), 0, baseImage ? baseImage.width : 9999);
      const y0 = clamp(Math.round(Math.min(ann.y, ann.y + ann.h)), 0, baseImage ? baseImage.height : 9999);
      const x1 = clamp(Math.round(Math.max(ann.x, ann.x + ann.w)), 0, baseImage ? baseImage.width : 9999);
      const y1 = clamp(Math.round(Math.max(ann.y, ann.y + ann.h)), 0, baseImage ? baseImage.height : 9999);
      const bs = ann.blockSize || 10;
      if (baseImage && baseImage.pixels) {
        const W = baseImage.width;
        const px = baseImage.pixels;
        for (let by = y0; by < y1; by += bs) {
          const bh = Math.min(bs, y1 - by);
          for (let bx = x0; bx < x1; bx += bs) {
            const bw = Math.min(bs, x1 - bx);
            const idx = (by * W + bx) * 4;
            ctx.fillStyle = `rgb(${px[idx]}, ${px[idx + 1]}, ${px[idx + 2]})`;
            ctx.fillRect(bx, by, bw, bh);
          }
        }
      } else {
        ctx.fillStyle = 'rgba(120, 120, 120, 0.7)';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      break;
    }
    case 'counter': {
      const rad = 13;
      ctx.beginPath();
      ctx.arc(ann.x, ann.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ann.number || 1), ann.x, ann.y);
      break;
    }
    case 'text': {
      ctx.font = '600 16px Inter, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(String(ann.text || 'Text'), ann.x, ann.y);
      break;
    }
  }

  if (isSelected) {
    const b = getAnnotationBounds(ann);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  }
  ctx.restore();
}

export function getAnnotationBounds(ann) {
  if (ann.type === 'line' || ann.type === 'arrow') {
    const x1 = ann.x1 ?? ann.x ?? 0;
    const y1 = ann.y1 ?? ann.y ?? 0;
    const x2 = ann.x2 ?? (x1 + (ann.w || 0));
    const y2 = ann.y2 ?? (y1 + (ann.h || 0));
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.max(8, Math.abs(x2 - x1)),
      h: Math.max(8, Math.abs(y2 - y1)),
    };
  }
  if (ann.type === 'pen' && Array.isArray(ann.points) && ann.points.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of ann.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: Math.max(8, maxX - minX), h: Math.max(8, maxY - minY) };
  }
  if (ann.type === 'counter') {
    return { x: ann.x - 14, y: ann.y - 14, w: 28, h: 28 };
  }
  if (ann.type === 'text') {
    const len = String(ann.text || 'Text').length;
    return { x: ann.x, y: ann.y, w: Math.max(24, len * 10), h: 22 };
  }
  const x = Math.min(ann.x || 0, (ann.x || 0) + (ann.w || 0));
  const y = Math.min(ann.y || 0, (ann.y || 0) + (ann.h || 0));
  return { x, y, w: Math.abs(ann.w || 0), h: Math.abs(ann.h || 0) };
}

/**
 * Interactive stage in the Result view. Uses an offscreen base canvas so
 * adding/undoing annotations redraws without re-uploading pixel data.
 */
export class AnnotateStage {
  constructor({ state, settings, onAddAnnotation, onChange }) {
    this.state = state;
    this.settings = settings;
    this.onAddAnnotation = onAddAnnotation;
    this.onChange = onChange;
    this.baseCanvas = document.createElement('canvas');
    this.baseCtx = this.baseCanvas.getContext('2d');
    this.canvas = h('canvas.ss-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el = h('div.ss-stage', this.canvas);
    this.draft = null;
    this.selectedIndex = -1;
    this.scheduleDraw = perFrame(() => this.drawNow());
    this.bindPointer();
    window.addEventListener('resize', () => this.fitCanvas());
  }

  setImage(image) {
    if (!image || !image.width || !image.height) return;
    this.baseCanvas.width = image.width;
    this.baseCanvas.height = image.height;
    const clamped = new Uint8ClampedArray(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength);
    this.baseCtx.putImageData(new ImageData(clamped, image.width, image.height), 0, 0);
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    this.selectedIndex = -1;
    this.fitCanvas();
    this.drawNow();
  }

  fitCanvas() {
    const img = this.state.image;
    if (!img) return;
    const rect = this.el.getBoundingClientRect();
    const availW = Math.max(120, (rect.width || 800) - 32);
    const availH = Math.max(120, (rect.height || 500) - 32);
    const scale = Math.min(1, availW / img.width, availH / img.height);
    this.canvas.style.width = `${Math.max(1, Math.round(img.width * scale))}px`;
    this.canvas.style.height = `${Math.max(1, Math.round(img.height * scale))}px`;
  }

  toImageCoords(e) {
    const img = this.state.image;
    if (!img) return { x: 0, y: 0 };
    const r = this.canvas.getBoundingClientRect();
    const w = r.width || img.width;
    const h = r.height || img.height;
    return {
      x: clamp(Math.round(((e.clientX - r.left) / w) * img.width), 0, img.width),
      y: clamp(Math.round(((e.clientY - r.top) / h) * img.height), 0, img.height),
    };
  }

  bindPointer() {
    this.canvas.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0 || !this.state.image) return;
      e.preventDefault();
      const pt = this.toImageCoords(e);
      const tool = this.state.tool || 'rect';
      const color = this.settings.get('color') || '#ef4444';
      const strokeWidth = this.settings.get('strokeWidth') || 4;

      if (tool === 'counter') {
        const nextNum = this.state.annotations.filter((a) => a.type === 'counter').length + 1;
        this.onAddAnnotation({ type: 'counter', x: pt.x, y: pt.y, number: nextNum, color, strokeWidth });
        return;
      }

      if (tool === 'text') {
        const text = await promptDialog({
          title: 'Add Text Annotation',
          placeholder: 'Enter label…',
          value: 'Note',
          ok: 'Add',
        });
        if (text) {
          this.onAddAnnotation({ type: 'text', x: pt.x, y: pt.y, text, color, strokeWidth });
        }
        return;
      }

      if (tool === 'select') {
        let hit = -1;
        for (let i = this.state.annotations.length - 1; i >= 0; i--) {
          const b = getAnnotationBounds(this.state.annotations[i]);
          if (pt.x >= b.x - 6 && pt.x <= b.x + b.w + 6 && pt.y >= b.y - 6 && pt.y <= b.y + b.h + 6) {
            hit = i;
            break;
          }
        }
        this.selectedIndex = hit;
        this.scheduleDraw();
        if (hit < 0) return;
        const orig = JSON.parse(JSON.stringify(this.state.annotations[hit]));
        const move = (ev) => {
          const cur = this.toImageCoords(ev);
          const dx = cur.x - pt.x;
          const dy = cur.y - pt.y;
          const target = this.state.annotations[hit];
          if (!target) return;
          if (target.x1 != null) {
            target.x1 = orig.x1 + dx;
            target.y1 = orig.y1 + dy;
            target.x2 = orig.x2 + dx;
            target.y2 = orig.y2 + dy;
          } else if (Array.isArray(target.points)) {
            target.points = orig.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          } else {
            target.x = orig.x + dx;
            target.y = orig.y + dy;
          }
          this.scheduleDraw();
        };
        const up = () => {
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', up, true);
          if (this.onChange) this.onChange();
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        return;
      }

      if (tool === 'pen') {
        this.draft = { type: 'pen', points: [pt], color, strokeWidth };
      } else if (tool === 'line' || tool === 'arrow') {
        this.draft = { type: tool, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, color, strokeWidth };
      } else {
        this.draft = { type: tool, x: pt.x, y: pt.y, w: 0, h: 0, color, strokeWidth };
      }

      const move = (ev) => {
        if (!this.draft) return;
        const cur = this.toImageCoords(ev);
        if (this.draft.type === 'pen') {
          this.draft.points.push(cur);
        } else if (this.draft.type === 'line' || this.draft.type === 'arrow') {
          this.draft.x2 = cur.x;
          this.draft.y2 = cur.y;
        } else {
          this.draft.x = Math.min(pt.x, cur.x);
          this.draft.y = Math.min(pt.y, cur.y);
          this.draft.w = Math.abs(cur.x - pt.x);
          this.draft.h = Math.abs(cur.y - pt.y);
        }
        this.scheduleDraw();
      };

      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        if (!this.draft) return;
        const d = this.draft;
        this.draft = null;
        const valid = d.type === 'pen'
          ? d.points.length > 0
          : (d.type === 'line' || d.type === 'arrow')
            ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= 2
            : (d.w >= 2 && d.h >= 2);
        if (valid) this.onAddAnnotation(d);
        else this.scheduleDraw();
      };

      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
    });
  }

  drawNow() {
    const img = this.state.image;
    if (!img) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.baseCanvas, 0, 0);
    for (let i = 0; i < this.state.annotations.length; i++) {
      drawAnnotationOnCtx(this.ctx, this.state.annotations[i], img, i === this.selectedIndex);
    }
    if (this.draft) {
      drawAnnotationOnCtx(this.ctx, this.draft, img, false);
    }
  }
}

/**
 * Fullscreen / overlay Region selection view.
 * Positions the region canvas at (0, 0) with 1:1 pixel mapping whenever the
 * image fits in the viewport so simulated drags at (x0, y0) -> (x1, y1) map
 * directly to image pixel coordinates.
 */
export class RegionOverlay {
  constructor({ state, onConfirm, onCancel }) {
    this.state = state;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.baseCanvas = document.createElement('canvas');
    this.baseCtx = this.baseCanvas.getContext('2d');
    this.canvas = h('canvas.ss-region-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.pill = h('div.ss-region-pill.num.hidden');
    this.bar = h('div.ss-region-bar',
      h('span', 'Drag to select a region · Arrow keys nudge · Enter confirms · Esc cancels'),
      h('button.btn.small', { onclick: () => this.onCancel() }, 'Cancel'),
      h('button.btn.small.primary', { onclick: () => this.onConfirm() }, 'Capture Region'));
    this.el = h('div.ss-region-overlay.hidden', { tabindex: '0' }, this.canvas, this.pill, this.bar);
    this.scale = 1;
    this.scheduleDraw = perFrame(() => this.drawNow());
    this.bindEvents();
  }

  open(image) {
    if (!image) return;
    this.baseCanvas.width = image.width;
    this.baseCanvas.height = image.height;
    const clamped = new Uint8ClampedArray(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength);
    this.baseCtx.putImageData(new ImageData(clamped, image.width, image.height), 0, 0);
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    const vw = window.innerWidth || image.width;
    const vh = window.innerHeight || image.height;
    this.scale = (image.width > vw || image.height > vh)
      ? Math.min(vw / image.width, vh / image.height)
      : 1;
    this.canvas.style.width = `${Math.round(image.width * this.scale)}px`;
    this.canvas.style.height = `${Math.round(image.height * this.scale)}px`;
    this.el.classList.remove('hidden');
    this.el.focus();
    this.drawNow();
  }

  close() {
    this.el.classList.add('hidden');
  }

  toImageCoords(e) {
    const img = this.state.image;
    if (!img) return { x: 0, y: 0 };
    const s = this.scale || 1;
    return {
      x: clamp(Math.round(e.clientX / s), 0, img.width),
      y: clamp(Math.round(e.clientY / s), 0, img.height),
    };
  }

  hitHandle(pt) {
    const r = this.state.regionRect;
    if (!r || r.w <= 0 || r.h <= 0) return null;
    const pts = {
      nw: [r.x, r.y],
      n: [r.x + r.w / 2, r.y],
      ne: [r.x + r.w, r.y],
      e: [r.x + r.w, r.y + r.h / 2],
      se: [r.x + r.w, r.y + r.h],
      s: [r.x + r.w / 2, r.y + r.h],
      sw: [r.x, r.y + r.h],
      w: [r.x, r.y + r.h / 2],
    };
    for (const [name, [hx, hy]] of Object.entries(pts)) {
      if (Math.abs(pt.x - hx) <= 6 && Math.abs(pt.y - hy) <= 6) return name;
    }
    return null;
  }

  bindEvents() {
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.bar.contains(e.target) || !this.state.image) return;
      e.preventDefault();
      const start = this.toImageCoords(e);
      const handle = this.hitHandle(start);
      const initRect = this.state.regionRect ? { ...this.state.regionRect } : null;

      const move = (ev) => {
        const cur = this.toImageCoords(ev);
        if (handle && initRect) {
          let x0 = initRect.x;
          let y0 = initRect.y;
          let x1 = initRect.x + initRect.w;
          let y1 = initRect.y + initRect.h;
          if (handle.includes('w')) x0 = cur.x;
          if (handle.includes('e')) x1 = cur.x;
          if (handle.includes('n')) y0 = cur.y;
          if (handle.includes('s')) y1 = cur.y;
          this.state.regionRect = {
            x: Math.min(x0, x1),
            y: Math.min(y0, y1),
            w: Math.max(1, Math.abs(x1 - x0)),
            h: Math.max(1, Math.abs(y1 - y0)),
          };
        } else {
          this.state.regionRect = {
            x: Math.min(start.x, cur.x),
            y: Math.min(start.y, cur.y),
            w: Math.abs(cur.x - start.x),
            h: Math.abs(cur.y - start.y),
          };
        }
        this.drawNow();
      };

      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        this.drawNow();
      };

      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
    });
  }

  drawNow() {
    const img = this.state.image;
    if (!img) return;
    const W = img.width;
    const H = img.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.baseCanvas, 0, 0);
    // Scrim over full image
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, W, H);

    const r = this.state.regionRect;
    if (!r || r.w <= 0 || r.h <= 0) {
      this.pill.classList.add('hidden');
      return;
    }

    // Undimmed selection area
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(this.baseCanvas, 0, 0);
    // Rule-of-thirds grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x + r.w / 3, r.y);
    ctx.lineTo(r.x + r.w / 3, r.y + r.h);
    ctx.moveTo(r.x + (r.w * 2) / 3, r.y);
    ctx.lineTo(r.x + (r.w * 2) / 3, r.y + r.h);
    ctx.moveTo(r.x, r.y + r.h / 3);
    ctx.lineTo(r.x + r.w, r.y + r.h / 3);
    ctx.moveTo(r.x, r.y + (r.h * 2) / 3);
    ctx.lineTo(r.x + r.w, r.y + (r.h * 2) / 3);
    ctx.stroke();
    ctx.restore();

    // Selection border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // 8 resize handles
    const handles = [
      [r.x, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y],
      [r.x + r.w, r.y + r.h / 2], [r.x + r.w, r.y + r.h],
      [r.x + r.w / 2, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y + r.h / 2],
    ];
    ctx.fillStyle = '#ffffff';
    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
    }

    // Dimension pill
    this.pill.textContent = `${r.w} × ${r.h}`;
    this.pill.style.left = `${Math.round(r.x * this.scale)}px`;
    this.pill.style.top = `${Math.max(4, Math.round(r.y * this.scale) - 28)}px`;
    this.pill.classList.remove('hidden');
  }
}
