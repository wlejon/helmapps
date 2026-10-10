/**
 * The view: one picture, fitted or zoomed, panned, rotated and flipped, on
 * the content's surface. A view change never touches the file.
 *
 *   const viewer = new Viewer({ onChange: () => updateStatus() });
 *   parent.appendChild(viewer.el);
 *   viewer.show(picture);              // from Decoder.get(); fitted, upright
 *   viewer.zoomIn(); viewer.fit(); viewer.zoomTo(1); viewer.rotate(90); viewer.flip('h');
 *   viewer.model()                     // { scale, fit, fitScale, rotation, flipH, flipV, panX, panY, ... }
 *
 * Raster pictures draw into a <canvas>: bro draws an <img> with
 * nearest-neighbour sampling at every size and ignores image-rendering (see
 * GAPS.md), while a 2D canvas samples with mipmaps or a cubic filter. So a
 * downscaled photo stays smooth, and above 200% the canvas turns smoothing
 * off for crisp pixels. An SVG is an <img> laid out at the size it is shown,
 * which bro rasterizes sharp at any zoom.
 */

import { h, clamp, perFrame } from '/lib/dom.js';
import { TILE } from './decoder.js';

/** The zoom levels Zoom In and Zoom Out step through. */
export const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 0.75, 1,
  1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const MIN_ZOOM = ZOOM_STEPS[0];
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
/** Above this scale pixels are drawn as crisp squares. */
const PIXELATED_ABOVE = 2;
/** The largest an SVG is laid out, in CSS px on its long side. */
const MAX_VECTOR_PX = 8192;
const WHEEL_STEP = 1.2;

export class Viewer {
  /** onNeedTiles(pic, keys): the zoom shows more pixels than a partial picture holds. */
  constructor({ onChange, onNeedTiles } = {}) {
    this.onChange = onChange;
    this.onNeedTiles = onNeedTiles;
    this.missingTiles = 0;
    this.pic = null;
    this.v = { fit: true, scale: 1, rotation: 0, flipH: false, flipV: false, panX: 0, panY: 0 };
    this.size = { w: 0, h: 0 };          // the stage, in CSS px (read once per draw)

    this.canvas = h('canvas.iv-canvas');
    this.vector = h('img.iv-vector.hidden', { alt: '' });
    this.backdrop = h('div.iv-backdrop.hidden');
    this.el = h('div.iv-stage', { tabindex: '-1' }, this.backdrop, this.canvas, this.vector);
    this.ctx = null;
    this.schedule = perFrame(() => this.draw());

    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.el.addEventListener('dblclick', (e) => this.onDblClick(e));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.schedule()).observe(this.el);
    window.addEventListener('resize', () => this.schedule());
  }

  // ---- the picture --------------------------------------------------------------

  /** Show a picture, fitted and upright (or keep the view, for a reload of the same file). */
  show(pic, { keepView = false } = {}) {
    this.pic = pic;
    if (!keepView) this.v = { fit: true, scale: 1, rotation: 0, flipH: false, flipV: false, panX: 0, panY: 0 };
    this.vector.classList.toggle('hidden', !pic || pic.kind !== 'vector');
    this.canvas.classList.toggle('hidden', !!pic && pic.kind === 'vector');
    if (pic && pic.kind === 'vector' && this.vector.getAttribute('src') !== pic.path) this.vector.src = pic.path;
    this.drawNow();
  }

  clear() {
    this.pic = null;
    this.vector.classList.add('hidden');
    this.vector.removeAttribute('src');
    this.drawNow();
  }

  // ---- geometry -------------------------------------------------------------------

  /** Width and height as shown (rotation swaps them). */
  turned() {
    if (!this.pic) return { w: 0, h: 0 };
    const quarter = this.v.rotation % 180 !== 0;
    return quarter ? { w: this.pic.height, h: this.pic.width } : { w: this.pic.width, h: this.pic.height };
  }

  /** The scale that fits the picture in the stage (never above 100%). */
  fitScale() {
    const { w, h: ht } = this.turned();
    const { w: vw, h: vh } = this.size;
    if (!w || !ht || !vw || !vh) return 1;
    return Math.min(1, vw / w, vh / ht);
  }

  /** The scale on screen now. */
  scale() {
    return this.v.fit ? this.fitScale() : this.v.scale;
  }

  maxScale() {
    if (!this.pic || this.pic.kind !== 'vector') return MAX_ZOOM;
    return Math.min(MAX_ZOOM, MAX_VECTOR_PX / Math.max(this.pic.width, this.pic.height));
  }

  /** Whether the picture is bigger than the stage, so dragging pans it. */
  pannable() {
    const { w, h: ht } = this.turned();
    const s = this.scale();
    return w * s > this.size.w + 0.5 || ht * s > this.size.h + 0.5;
  }

  /** Keep the picture covering the stage on each axis it overflows. */
  clampPan() {
    const { w, h: ht } = this.turned();
    const s = this.scale();
    const ox = Math.max(0, (w * s - this.size.w) / 2);
    const oy = Math.max(0, (ht * s - this.size.h) / 2);
    this.v.panX = clamp(this.v.panX, -ox, ox);
    this.v.panY = clamp(this.v.panY, -oy, oy);
  }

  // ---- view changes ---------------------------------------------------------------

  /** Zoom to `scale`, keeping the point under (x, y) (stage coordinates; default the centre) still. */
  zoomTo(scale, at = null) {
    if (!this.pic) return;
    this.measure();
    const s0 = this.scale();
    const s1 = clamp(scale, Math.min(MIN_ZOOM, this.fitScale()), this.maxScale());
    const px = at ? at.x : this.size.w / 2;
    const py = at ? at.y : this.size.h / 2;
    const cx = this.size.w / 2 + this.v.panX;
    const cy = this.size.h / 2 + this.v.panY;
    this.v.fit = false;
    this.v.scale = s1;
    this.v.panX = px - ((px - cx) * s1) / s0 - this.size.w / 2;
    this.v.panY = py - ((py - cy) * s1) / s0 - this.size.h / 2;
    this.changed();
  }

  zoomIn() {
    const s = this.scale();
    this.zoomTo(ZOOM_STEPS.find((z) => z > s + 1e-6) || MAX_ZOOM);
  }

  zoomOut() {
    const s = this.scale();
    const lower = ZOOM_STEPS.filter((z) => z < s - 1e-6);
    this.zoomTo(lower.length ? lower[lower.length - 1] : MIN_ZOOM);
  }

  fit() {
    this.v.fit = true;
    this.v.panX = 0;
    this.v.panY = 0;
    this.changed();
  }

  /** Turn by a quarter: +90 clockwise, -90 counter-clockwise. */
  rotate(deg) {
    this.v.rotation = (((this.v.rotation + deg) % 360) + 360) % 360;
    this.changed();
  }

  /** Mirror across the screen's vertical ('h') or horizontal ('v') axis. */
  flip(axis) {
    if (axis === 'h') this.v.flipH = !this.v.flipH;
    else this.v.flipV = !this.v.flipV;
    this.changed();
  }

  /** Whether the view differs from the file (rotated or flipped). */
  transformed() {
    return this.v.rotation !== 0 || this.v.flipH || this.v.flipV;
  }

  model() {
    this.measure();
    return {
      scale: this.scale(), fit: this.v.fit, fitScale: this.fitScale(), rotation: this.v.rotation,
      flipH: this.v.flipH, flipV: this.v.flipV, panX: this.v.panX, panY: this.v.panY,
      width: this.pic ? this.pic.width : 0, height: this.pic ? this.pic.height : 0,
      pixelated: this.scale() > PIXELATED_ABOVE, kind: this.pic ? this.pic.kind : null,
      partial: !!(this.pic && this.pic.partial), missingTiles: this.missingTiles,
    };
  }

  changed() {
    this.drawNow();
    if (this.onChange) this.onChange();
  }

  // ---- drawing --------------------------------------------------------------------

  measure() {
    this.size = { w: this.el.clientWidth, h: this.el.clientHeight };
  }

  /** Draw in this frame (a view change the user is waiting on). */
  drawNow() {
    this.draw();
  }

  draw() {
    // Read first: one layout for the whole draw.
    this.measure();
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    const { w: vw, h: vh } = this.size;
    const pic = this.pic;
    if (!pic || !vw || !vh) {
      this.backdrop.classList.add('hidden');
      if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.clampPan();
    const s = this.scale();
    const { w, h: ht } = this.turned();
    const cx = vw / 2 + this.v.panX;
    const cy = vh / 2 + this.v.panY;
    const dw = w * s, dh = ht * s;

    this.el.classList.toggle('pannable', this.pannable());
    this.backdrop.classList.remove('hidden');
    Object.assign(this.backdrop.style, {
      left: `${Math.round(cx - dw / 2)}px`, top: `${Math.round(cy - dh / 2)}px`,
      width: `${Math.round(dw)}px`, height: `${Math.round(dh)}px`,
    });

    const fx = this.v.flipH ? -1 : 1;
    const fy = this.v.flipV ? -1 : 1;
    if (pic.kind === 'vector') {
      const iw = pic.width * s, ih = pic.height * s;
      Object.assign(this.vector.style, {
        width: `${iw}px`, height: `${ih}px`, left: `${cx - iw / 2}px`, top: `${cy - ih / 2}px`,
        transform: `scale(${fx}, ${fy}) rotate(${this.v.rotation}deg)`,
      });
      return;
    }

    const bw = Math.max(1, Math.round(vw * dpr));
    const bh = Math.max(1, Math.round(vh * dpr));
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    const ctx = this.ctx || (this.ctx = this.canvas.getContext('2d'));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(cx, cy);
    ctx.scale(fx, fy);
    ctx.rotate((this.v.rotation * Math.PI) / 180);
    ctx.imageSmoothingEnabled = s <= PIXELATED_ABOVE;
    ctx.imageSmoothingQuality = 'high';
    const x0 = (-pic.width * s) / 2, y0 = (-pic.height * s) / 2;
    ctx.drawImage(pic.source, x0, y0, pic.width * s, pic.height * s);
    // Zoomed past the screen-sized preview: the full-resolution tiles on
    // screen go over it, and the ones not here yet are asked for.
    if (pic.partial && pic.width * s * dpr > (pic.source.width || 0) * 1.02) {
      const missing = [];
      for (const [tx, ty] of this.visibleTiles(s, fx, fy)) {
        const key = `${tx},${ty}`;
        const t = pic.tiles.get(key);
        if (!t) { missing.push(key); continue; }
        const sx = tx * TILE - t.x, sy = ty * TILE - t.y;
        const sw = Math.min(TILE, pic.width - tx * TILE), sh = Math.min(TILE, pic.height - ty * TILE);
        ctx.drawImage(t.bitmap, sx, sy, sw, sh, x0 + tx * TILE * s, y0 + ty * TILE * s, sw * s, sh * s);
      }
      this.missingTiles = missing.length;
      if (missing.length && this.onNeedTiles) this.onNeedTiles(pic, missing);
    } else {
      this.missingTiles = 0;
    }
  }

  /**
   * The tiles of the picture the stage shows, nearest the centre first: the
   * stage's corners mapped back through the flip and the turn into picture
   * pixels.
   */
  visibleTiles(s, fx, fy) {
    const pic = this.pic;
    const { w: vw, h: vh } = this.size;
    const cx = vw / 2 + this.v.panX, cy = vh / 2 + this.v.panY;
    const rad = (-this.v.rotation * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad)), sin = Math.round(Math.sin(rad));
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (const [px, py] of [[0, 0], [vw, 0], [0, vh], [vw, vh]]) {
      const dx = ((px - cx) / s) * fx, dy = ((py - cy) / s) * fy;
      const u = dx * cos - dy * sin + pic.width / 2;
      const v = dx * sin + dy * cos + pic.height / 2;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const tx0 = Math.max(0, Math.floor(u0 / TILE)), tx1 = Math.min(Math.ceil(pic.width / TILE) - 1, Math.floor(u1 / TILE));
    const ty0 = Math.max(0, Math.floor(v0 / TILE)), ty1 = Math.min(Math.ceil(pic.height / TILE) - 1, Math.floor(v1 / TILE));
    const mu = (u0 + u1) / 2 / TILE, mv = (v0 + v1) / 2 / TILE;
    const out = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) out.push([tx, ty]);
    return out.sort((a, b) => Math.hypot(a[0] + 0.5 - mu, a[1] + 0.5 - mv) - Math.hypot(b[0] + 0.5 - mu, b[1] + 0.5 - mv));
  }

  // ---- input ----------------------------------------------------------------------

  stagePoint(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onWheel(e) {
    if (!this.pic) return;
    e.preventDefault();
    const dy = e.deltaY || 0;
    if (!dy) return;
    const factor = dy < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    this.zoomTo(this.scale() * factor, this.stagePoint(e));
  }

  onDblClick(e) {
    if (!this.pic) return;
    if (this.v.fit && this.fitScale() < 1) this.zoomTo(1, this.stagePoint(e));
    else this.fit();
  }

  onPointerDown(e) {
    if (e.button !== 0 || !this.pic || !this.pannable()) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    const p0 = { x: this.v.panX, y: this.v.panY };
    this.el.classList.add('panning');
    const move = (ev) => {
      this.v.panX = p0.x + (ev.clientX - x0);
      this.v.panY = p0.y + (ev.clientY - y0);
      this.schedule();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      this.el.classList.remove('panning');
      if (this.onChange) this.onChange();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }
}
