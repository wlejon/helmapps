/**
 * Isolating an animal on request: while the pointer is on an animal of the
 * details panel (labels.js `.iv-animal-hit`), everything in the photo on
 * screen but that animal's boxes is darkened; a click on it zooms the view
 * to its boxes. Never on its own: only while hovered, gone as the pointer
 * leaves.
 *
 * The darkening has a soft-edged hole per box at once, and the animal's own
 * shape once SAM 2.1 has segmented it from the box (isolate-worker.js, a
 * worker of its own, made on the first hover; the weights from bro.models,
 * the smallest SAM 2.1 found). A mask is kept per photo and box for the
 * session, so hovering back and forth segments each once. Without the
 * weights (or bro.vision.loadSam2) the soft box is all there is.
 *
 * The overlay is a canvas over the view, drawn through the viewer's
 * pictureMatrix, so it follows zoom, pan, rotation and flips (draw() runs
 * on every view draw).
 *
 *   const iso = new Isolate({ viewer, host });
 *   iso.show({ path, size: [w, h], boxes });   // size: the record's photo size, boxes in its pixels
 *   iso.hide(); iso.draw(); iso.zoomTo(animal);
 *   iso.state()   // { path, boxes, masks, phase: 'box' | 'mask' | null } (tests)
 */

import { h } from '/lib/dom.js';
import { WorkerClient } from '../burst/rpc.js';
import { pathKey } from './records.js';

/** SAM 2.1 sizes, the fastest first: a mask for a hover wants speed more than the last detail. */
const SAM_NAMES = ['sam2.1-hiera-tiny', 'sam2.1-hiera-small', 'sam2.1-hiera-base-plus', 'sam2.1-hiera-large'];
/** Masks kept for the session (a mask is up to 1024 x 1024 bytes and its bitmap). */
const CACHE_MAX = 64;
/** The model is let go after this long without a request. */
const IDLE_MS = 120000;
/** Soft box: its feather, a fraction of the box's short side, and the steps it is drawn in. */
const FEATHER = 0.18;
const STEPS = 8;

const scrims = new Map();
/** A kit token's colour as the engine resolves it (a canvas cannot take var(--scrim)). */
function tokenColor(token) {
  if (scrims.has(token)) return scrims.get(token);
  const el = h('div', { style: { color: `var(${token})`, display: 'none' } });
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  scrims.set(token, c);
  return c;
}

const boxKey = (path, box) => `${pathKey(path)}|${box.join(',')}`;

export class Isolate {
  constructor({ viewer, host }) {
    this.viewer = viewer;
    this.canvas = h('canvas.iv-isolate.hidden');
    host.append(this.canvas);
    this.current = null;          // { key, path, size, boxes }
    this.cache = new Map();       // boxKey -> { rect, width, height, bitmap } | { failed: true }
    this.pending = new Map();     // boxKey -> Promise
    this.worker = null;
    this.samDir = undefined;      // undefined: not looked for yet; null: none
    this.segments = 0;            // masks asked of the worker (tests count cache hits)
    this.idleTimer = null;
    // Delegated: the details panel is drawn again as answers land, so its elements come and go.
    window.addEventListener('mouseover', (e) => this.onOver(e), true);
    window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.hide(); }, true);
    window.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('.iv-animal-hit') : null;
      if (el && el._animal) this.zoomTo(el._animal);
    });
  }

  /** TEST ONLY: masks from an ellipse in the box instead of SAM (isolate-worker.js 'stub'). */
  useStub() { this.samDir = 'stub'; }

  onOver(e) {
    const el = e.target && e.target.closest ? e.target.closest('.iv-animal-hit') : null;
    if (el && el._animal) this.show(el._animal);
    else if (this.current) this.hide();
  }

  /** The photo on screen is `path` (its picture, or the preview standing in for it). */
  onScreen(path) {
    const pic = this.viewer.pic;
    return !!pic && !!path && pathKey(pic.path) === pathKey(path);
  }

  show(animal) {
    const key = `${pathKey(animal.path)}|${JSON.stringify(animal.boxes)}`;
    if (this.current && this.current.key === key) return;
    if (!this.onScreen(animal.path)) { this.hide(); return; }
    this.current = { key, path: animal.path, size: animal.size, boxes: animal.boxes };
    this.canvas.classList.remove('hidden');
    this.draw();
    for (const box of animal.boxes) this.mask(animal.path, animal.size, box);
  }

  hide() {
    if (!this.current) return;
    this.current = null;
    this.draw();
  }

  /** What is isolated now (tests). */
  state() {
    const c = this.current;
    if (!c) return { path: '', boxes: [], masks: 0, phase: null };
    const masks = c.boxes.filter((b) => { const m = this.cache.get(boxKey(c.path, b)); return m && m.bitmap; }).length;
    return { path: c.path, boxes: c.boxes, masks, phase: masks === c.boxes.length ? 'mask' : 'box' };
  }

  // ---- masks ----------------------------------------------------------------------

  samFolder() {
    if (this.samDir !== undefined) return this.samDir;
    this.samDir = null;
    try {
      if (typeof bro !== 'undefined' && bro.vision && typeof bro.vision.loadSam2 === 'function' && bro.models) {
        for (const n of SAM_NAMES) { const d = bro.models.find(n); if (d) { this.samDir = d; break; } }
      }
    } catch (_) { this.samDir = null; }
    return this.samDir;
  }

  /** The mask of `box` in `path`: cached, being made, or asked for now (when SAM is here). */
  mask(path, size, box) {
    const k = boxKey(path, box);
    if (this.cache.has(k) || this.pending.has(k)) return;
    const dir = this.samFolder();
    if (!dir) return;
    if (!this.worker) this.worker = new WorkerClient('js/wildlife/isolate-worker.js');
    clearTimeout(this.idleTimer);
    this.segments++;
    const p = this.worker.call({ op: 'segment', path, box, source: { width: size[0], height: size[1] }, dir })
      .then(async (r) => {
        const rgba = new Uint8ClampedArray(r.width * r.height * 4);
        for (let i = 0; i < r.mask.length; i++) if (r.mask[i]) rgba[i * 4 + 3] = 255;
        const bitmap = await createImageBitmap(new ImageData(rgba, r.width, r.height));
        this.remember(k, { rect: r.rect, width: r.width, height: r.height, bitmap });
      }, (err) => {
        console.warn(`isolate: ${err.message}`);
        this.remember(k, { failed: true });
      })
      .finally(() => {
        this.pending.delete(k);
        if (this.current && this.current.boxes.some((b) => boxKey(this.current.path, b) === k)) this.draw();
        if (!this.pending.size) this.idleLater();
      });
    this.pending.set(k, p);
  }

  remember(k, v) {
    this.cache.set(k, v);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value);
  }

  idleLater() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.worker && !this.pending.size) this.worker.call({ op: 'dispose' }).catch(() => {});
    }, IDLE_MS);
  }

  // ---- drawing ----------------------------------------------------------------------

  /** Draw the darkening for the view as it is now (on every view draw, and as masks arrive). */
  draw() {
    const c = this.canvas;
    const cur = this.current;
    if (cur && !this.onScreen(cur.path)) this.current = null;
    if (!this.current) {
      if (!c.classList.contains('hidden')) {
        c.classList.add('hidden');
        if (c.width) c.getContext('2d').clearRect(0, 0, c.width, c.height);
      }
      return;
    }
    const v = this.viewer;
    const w = v.el.clientWidth, ht = v.el.clientHeight;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(ht * dpr));
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, bw, bh);
    const M = v.pictureMatrix();
    if (!M || !v.pic) return;
    ctx.fillStyle = tokenColor('--scrim');
    ctx.fillRect(0, 0, bw, bh);
    // The record's pixels -> the picture's (a preview standing in has a nominal size) -> canvas px.
    const k = v.pic.width / cur.size[0];
    const T = [M[0] * k * dpr, M[3] * k * dpr, M[1] * k * dpr, M[4] * k * dpr, M[2] * dpr, M[5] * dpr];
    ctx.globalCompositeOperation = 'destination-out';
    for (const box of cur.boxes) {
      const m = this.cache.get(boxKey(cur.path, box));
      ctx.setTransform(...T);
      if (m && m.bitmap) {
        const [x, y, rw, rh] = m.rect;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(m.bitmap, x, y, rw, rh);
      } else {
        // A soft-edged hole: nested rects, each taking away a little more, the innermost all of it.
        const [x, y, bw2, bh2] = box;
        const f = FEATHER * Math.min(bw2, bh2);
        ctx.fillStyle = 'black';
        for (let i = 0; i < STEPS; i++) {
          const g = f * (0.5 - i / (STEPS - 1));
          ctx.globalAlpha = i === STEPS - 1 ? 1 : 1 / (STEPS - i);
          ctx.fillRect(x - g, y - g, bw2 + 2 * g, bh2 + 2 * g);
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Zoom the view to an animal's boxes (with a margin), when its photo is on screen. */
  zoomTo(animal) {
    if (!this.onScreen(animal.path) || !animal.boxes.length) return;
    const pic = this.viewer.pic;
    const k = pic.width / animal.size[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y, w, ht] of animal.boxes) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + ht);
    }
    this.viewer.frame({ x: x0 * k, y: y0 * k, w: (x1 - x0) * k, h: (y1 - y0) * k });
  }
}
