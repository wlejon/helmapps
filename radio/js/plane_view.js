/**
 * The mood plane. Up is energetic, down calm; right is bright, left dark.
 * Each mood word sits at its place (styles.js MOODS) and owns the region
 * nearest it, drawn as faint borders, with the listener's region lit.
 *
 * Drawn on a canvas: the regions, the axes, the listener (a ring: where you
 * are) and the music (a dot: where the playing chunk was made), joined by a
 * line while the music is still on its way, and a faint trail of where the
 * music has been. The words and axis names are DOM over the canvas, so they
 * are text, and a word is a button: click it to go to that mood.
 *
 * Input, in plane coordinates ([-1, 1] both ways):
 *   onMove(x, y, end)   a press or drag; end on release
 *   onMood(id)          a mood word clicked
 */

import { h } from '/lib/dom.js';
import { MOODS, moodAt } from './styles.js';

const CELL = 6;                 // px per cell when filling the regions

function token(name) {
  try { return getComputedStyle(document.body).getPropertyValue(name).trim(); } catch (_) { return ''; }
}

export class PlaneView {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.canvas = h('canvas.plane-canvas');
    this.words = new Map();
    const labels = MOODS.map((m) => {
      const b = h('button.plane-word', { onclick: (e) => { e.stopPropagation(); if (this.hooks.onMood) this.hooks.onMood(m.id); } }, m.id);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.words.set(m.id, b);
      return b;
    });
    this.axes = [
      h('div.plane-axis.top.micro', 'more intense'), h('div.plane-axis.bottom.micro', 'more relaxed'),
      h('div.plane-axis.left.micro', 'darker'), h('div.plane-axis.right.micro', 'brighter'),
    ];
    this.el = h('div.plane', this.canvas, ...this.axes, ...labels);
    this.state = { listener: { x: 0, y: 0 }, mood: null, music: null, playingMood: null, trail: [] };
    this.size = { w: 0, h: 0, dpr: 1 };
    this.dirty = true;
    this.dragging = false;
    this.colors = null;

    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      this.report(e, false);
    });
    this.el.addEventListener('pointermove', (e) => { if (this.dragging) this.report(e, false); });
    this.el.addEventListener('pointerup', (e) => { if (!this.dragging) return; this.dragging = false; this.report(e, true); });
  }

  setState(patch) { Object.assign(this.state, patch); this.dirty = true; }

  /** The plane's square, centred: [-1, 1] maps to it with a margin for the labels. */
  box() {
    const side = Math.max(10, Math.min(this.size.w, this.size.h) - 88);
    return { x0: (this.size.w - side) / 2, y0: (this.size.h - side) / 2, side };
  }
  toScreen(x, y) {
    const b = this.box();
    return [b.x0 + (x + 1) / 2 * b.side, b.y0 + (1 - y) / 2 * b.side];
  }
  toPlane(px, py) {
    const b = this.box();
    const c = (v) => Math.max(-1, Math.min(1, v));
    return [c(((px - b.x0) / b.side) * 2 - 1), c(1 - ((py - b.y0) / b.side) * 2)];
  }

  report(e, end) {
    const r = this.el.getBoundingClientRect();
    const [x, y] = this.toPlane(e.clientX - r.left, e.clientY - r.top);
    if (this.hooks.onMove) this.hooks.onMove(x, y, end);
  }

  frame() {
    const r = this.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (Math.round(r.width) !== this.size.w || Math.round(r.height) !== this.size.h || dpr !== this.size.dpr) {
      this.size = { w: Math.round(r.width), h: Math.round(r.height), dpr };
      this.canvas.width = Math.max(1, Math.round(this.size.w * dpr));
      this.canvas.height = Math.max(1, Math.round(this.size.h * dpr));
      this.canvas.style.width = `${this.size.w}px`;
      this.canvas.style.height = `${this.size.h}px`;
      this.placeLabels();
      this.dirty = true;
    }
    if (!this.dirty || !this.size.w) return;
    this.dirty = false;
    this.draw();
    for (const [id, b] of this.words) {
      b.classList.toggle('here', id === this.state.mood);
      b.classList.toggle('playing', id === this.state.playingMood);
    }
  }

  placeLabels() {
    for (const m of MOODS) {
      const [x, y] = this.toScreen(m.x, m.y);
      const b = this.words.get(m.id);
      b.style.left = `${Math.round(x)}px`;
      b.style.top = `${Math.round(y)}px`;
    }
    const bx = this.box();
    const [a, b, c, d] = this.axes;
    a.style.top = `${Math.round(bx.y0 - 34)}px`;
    b.style.top = `${Math.round(bx.y0 + bx.side + 8)}px`;
    c.style.left = `${Math.round(bx.x0 - 8)}px`;
    d.style.left = `${Math.round(bx.x0 + bx.side + 8)}px`;
    c.style.top = d.style.top = `${Math.round(bx.y0 + bx.side / 2 - 8)}px`;
  }

  draw() {
    const c = this.colors || (this.colors = {
      bg: token('--surface-0'), plane: token('--well'), region: token('--accent-faint'), border: token('--hairline'),
      axis: token('--rim'), listener: token('--accent'), music: token('--t1'), trail: token('--t3'),
    });
    const g = this.canvas.getContext('2d');
    g.setTransform(this.size.dpr, 0, 0, this.size.dpr, 0, 0);
    g.fillStyle = c.bg;
    g.fillRect(0, 0, this.size.w, this.size.h);
    const b = this.box();
    g.fillStyle = c.plane;
    g.fillRect(b.x0, b.y0, b.side, b.side);

    // Regions: each cell takes its nearest mood; the listener's mood is lit,
    // and a cell whose neighbour belongs to another mood draws the border.
    const n = Math.max(1, Math.floor(b.side / CELL)), cs = b.side / n;
    const owner = new Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * 2 - 1, y = 1 - ((j + 0.5) / n) * 2;
        owner[j * n + i] = moodAt(x, y).id;
      }
    }
    g.fillStyle = c.region;
    for (let k = 0; k < owner.length; k++) {
      if (owner[k] === this.state.mood) g.fillRect(b.x0 + (k % n) * cs, b.y0 + Math.floor(k / n) * cs, cs + 0.5, cs + 0.5);
    }
    g.fillStyle = c.border;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = owner[j * n + i];
        if ((i + 1 < n && owner[j * n + i + 1] !== o) || (j + 1 < n && owner[(j + 1) * n + i] !== o)) {
          g.fillRect(b.x0 + i * cs + cs / 2 - 0.5, b.y0 + j * cs + cs / 2 - 0.5, 1.5, 1.5);
        }
      }
    }
    // Each mood's own spot (its word sits just above it).
    g.fillStyle = c.axis;
    for (const m of MOODS) {
      const [x, y] = this.toScreen(m.x, m.y);
      g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
    }
    // Axes through the middle.
    g.strokeStyle = c.axis; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(b.x0 + b.side / 2, b.y0); g.lineTo(b.x0 + b.side / 2, b.y0 + b.side);
    g.moveTo(b.x0, b.y0 + b.side / 2); g.lineTo(b.x0 + b.side, b.y0 + b.side / 2);
    g.stroke();

    // Where the music has been.
    const tr = this.state.trail;
    if (tr.length > 1) {
      g.strokeStyle = c.trail; g.lineWidth = 2;
      for (let i = 1; i < tr.length; i++) {
        g.globalAlpha = 0.15 + 0.5 * (i / tr.length);
        const [x0, y0] = this.toScreen(tr[i - 1].x, tr[i - 1].y), [x1, y1] = this.toScreen(tr[i].x, tr[i].y);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      g.globalAlpha = 1;
    }

    const L = this.state.listener, M = this.state.music;
    const [lx, ly] = this.toScreen(L.x, L.y);
    if (M) {
      const [mx, my] = this.toScreen(M.x, M.y);
      if (Math.hypot(mx - lx, my - ly) > 4) {
        g.strokeStyle = c.listener; g.lineWidth = 1.5; g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(mx, my); g.lineTo(lx, ly); g.stroke(); g.setLineDash([]);
      }
      g.fillStyle = c.music;
      g.beginPath(); g.arc(mx, my, 5, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = c.listener; g.lineWidth = 2.5;
    g.beginPath(); g.arc(lx, ly, 11, 0, Math.PI * 2); g.stroke();
  }
}
