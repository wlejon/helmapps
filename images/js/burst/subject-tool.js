/**
 * Select Subject: a tool over the photo view. A click marks the subject and
 * segments it (on the tracking worker, from the full-resolution photo); more
 * clicks add to it, Alt+click takes an area away. The mask is drawn over the
 * picture and follows zoom and pan. The tool never changes the photo.
 *
 *   const tool = new SubjectTool({ viewer, host, onClicks: (points, labels) => segment(...) });
 *   tool.setActive(true);
 *   tool.show({ track, points, labels });     // the subject so far (track: a segment result)
 *   tool.setBusy(true); tool.setHint('…');
 */

import { h } from '/lib/dom.js';
import { invert, apply, compose, scaling } from './affine.js';
import { maskBitmap, drawMask, drawClicks } from './draw.js';

/** A press that moves more than this is a pan, not a click. */
const CLICK_SLOP = 4;

export class SubjectTool {
  constructor({ viewer, host, onClicks }) {
    this.viewer = viewer;
    this.onClicks = onClicks;
    this.active = false;
    this.points = [];
    this.labels = [];
    this.track = null;
    this.bitmap = null;
    this.canvas = h('canvas.iv-subject-overlay.hidden');
    this.hint = h('span.iv-subject-text');
    this.spinner = h('div.spinner.small.hidden');
    this.bar = h('div.iv-subject-bar.hidden', this.spinner, this.hint);
    host.append(this.canvas, this.bar);
    this.down = null;
    viewer.el.addEventListener('pointerdown', (e) => { if (this.active && e.button === 0) this.down = [e.clientX, e.clientY]; }, true);
    viewer.el.addEventListener('pointerup', (e) => this.onUp(e), true);
  }

  setActive(on) {
    this.active = !!on;
    this.canvas.classList.toggle('hidden', !this.active);
    this.bar.classList.toggle('hidden', !this.active);
    this.viewer.el.classList.toggle('picking', this.active);
    this.draw();
  }

  /** Forget the subject (another photo, or Clear). */
  clear() {
    this.points = [];
    this.labels = [];
    this.track = null;
    this.bitmap = null;
    this.draw();
  }

  show({ track = this.track, points = this.points, labels = this.labels } = {}) {
    this.track = track;
    this.points = points;
    this.labels = labels;
    this.bitmap = null;
    if (track && track.mask) {
      maskBitmap(track.mask).then((b) => { if (this.track === track) { this.bitmap = b; this.draw(); } });
    }
    this.draw();
  }

  setBusy(on) { this.spinner.classList.toggle('hidden', !on); }
  setHint(text) { this.hint.textContent = text; }

  onUp(e) {
    if (!this.active || e.button !== 0 || !this.down) return;
    const moved = Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]);
    this.down = null;
    if (moved > CLICK_SLOP) return;
    const M = this.viewer.pictureMatrix();
    // A grid preview standing in for the photo has a nominal size, not the photo's.
    if (!M || !this.viewer.pic || this.viewer.pic.placeholder) return;
    const r = this.viewer.el.getBoundingClientRect();
    const [x, y] = apply(invert(M), [e.clientX - r.left, e.clientY - r.top]);
    const pic = this.viewer.pic;
    if (x < 0 || y < 0 || x >= pic.width || y >= pic.height) return;
    e.stopPropagation();
    this.points = [...this.points, [x, y]];
    this.labels = [...this.labels, e.altKey ? 0 : 1];
    this.draw();
    if (this.onClicks) this.onClicks(this.points, this.labels);
  }

  draw() {
    const c = this.canvas;
    if (!this.active) return;
    const w = this.viewer.el.clientWidth, ht = this.viewer.el.clientHeight;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(ht * dpr));
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    const M = this.viewer.pictureMatrix();
    if (!M || !this.viewer.pic || this.viewer.pic.placeholder) return;
    const D = compose(scaling(dpr), M);
    if (this.track && this.track.mask && this.bitmap) drawMask(ctx, this.track.mask, this.bitmap, D);
    drawClicks(ctx, this.points, this.labels, D);
  }
}
