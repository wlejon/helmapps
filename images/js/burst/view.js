/**
 * The stabilize view: the burst held still. The stage shows the current
 * frame through its stabilizing transform (js/burst/stabilize.js) with its
 * subject's mask, the crop rectangle in the reference frame's coordinates,
 * and, shaded, what not every included frame covers; the crop cannot leave
 * the area they all cover. The frame row along the bottom shows every
 * frame with a confidence badge; the panel on the right holds the lock
 * mode, the crop's shape, the timing and the export.
 *
 *   const view = new StabilizeView({ session, media, settings, onChange });
 *   view.open();                    // after session.load + seed: tracks, loads previews
 *   view.go(k); view.play(); view.pause(); view.step(+1);
 *   view.setCorrecting(true);       // clicks on the stage set this frame's subject
 *   view.model()                    // numbers for tests: crop, area, transforms, schedule, ...
 *
 * Coordinates: "stabilized" is the reference frame's own full-resolution
 * pixels; T[k] maps it into frame k. The stage maps stabilized to canvas
 * px by D (a scale and an offset that fit the reference, or the crop while
 * playing).
 */

import { h, perFrame } from '/lib/dom.js';
import { compose, invert, apply, scaling, corners } from './affine.js';
import { transforms, commonArea, constrainCrop, defaultCrop, fitRect, withAspect, aspectRatio } from './stabilize.js';
import { schedule } from './timing.js';
import { maskBitmapNow, drawMask, drawClicks, tokenColor } from './draw.js';
import { FrameRow } from './frame-row.js';
import { BurstPanel } from './panel.js';
import { statusOf } from './session.js';

/** Previews are decoded at this long side: enough for the stage, small enough to keep all. */
const PREVIEW_SIDE = 1600;
/** Grab distance for the crop's corners, in CSS px. */
const HANDLE_PX = 12;
const MIN_CROP_PX = 32;

export class StabilizeView {
  /**
   * settings: { get(key), set(key, v) } over burstLock, burstAspect, burstHoldMs,
   *   burstSpeedPct, burstFormat, burstSize
   * onChange(): anything the toolbar or status shows changed
   * onExport(): the Export button
   */
  constructor({ session, media, settings, onChange, onExport }) {
    this.session = session;
    this.media = media;
    this.settings = settings;
    this.onChange = onChange;
    this.onExport = onExport;
    this.previews = new Map();
    this.cur = 0;
    this.T = [];
    this.poly = [];
    this.crop = null;
    this.playing = false;
    this.correcting = false;
    this.timer = null;
    this.exporting = false;

    this.canvas = h('canvas.iv-burst-canvas');
    this.hint = h('div.iv-burst-hint.hidden');
    this.stage = h('div.iv-burst-stage', { tabindex: '-1' }, this.canvas, this.hint);
    this.row = new FrameRow({ session, previews: this.previews, onPick: (k) => this.go(k) });
    this.panel = new BurstPanel({ on: {
      lock: (v) => { this.settings.set('burstLock', v); this.recompute({ keepCrop: true }); },
      aspect: (v) => { this.settings.set('burstAspect', v); this.applyAspect(); },
      hold: (v) => { this.settings.set('burstHoldMs', Math.round(v * 1000)); this.changed(); },
      speed: (v) => { this.settings.set('burstSpeedPct', Math.round(v * 100)); this.changed(); },
      include: (v) => this.setIncluded(this.cur, v),
      frameHold: (v) => this.setFrameHold(this.cur, v),
      format: (v) => { this.settings.set('burstFormat', v); this.changed(); },
      size: (v) => { this.settings.set('burstSize', v); this.changed(); },
    } });
    this.exportButton = h('button.btn.primary.iv-burst-export', { onclick: () => this.onExport && this.onExport() }, 'Export…');
    this.panel.el.insertBefore(this.exportButton, this.panel.progressRow);
    this.el = h('div.iv-burst.hidden',
      h('div.iv-burst-main', this.stage, this.panel.el),
      this.row.el);
    this.schedule = perFrame(() => this.draw());
    this.stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.schedule()).observe(this.stage);
    window.addEventListener('resize', () => this.schedule());
  }

  // ---- settings --------------------------------------------------------------------

  get lock() { return this.settings.get('burstLock') === 'scene' ? 'scene' : 'subject'; }
  get aspect() { return this.settings.get('burstAspect') || '1:1'; }
  get hold() { return this.settings.get('burstHoldMs') / 1000; }
  get speed() { return this.settings.get('burstSpeedPct') / 100; }
  get format() { return this.settings.get('burstFormat') === 'webm' ? 'webm' : 'gif'; }
  get size() { return this.settings.get('burstSize'); }

  // ---- opening -------------------------------------------------------------------------

  /** Show the session: previews start loading, tracking runs, the crop appears once it can. */
  open() {
    this.cur = this.session.ref;
    this.crop = null;
    this.previews.clear();
    this.el.classList.remove('hidden');
    this.row.refresh();
    this.row.setCurrent(this.cur);
    this.loadPreviews();
    this.recompute();
    this.session.track().then(() => this.recompute({ keepCrop: true }));
  }

  close() {
    this.pause();
    this.el.classList.add('hidden');
    for (const p of this.previews.values()) if (p.bitmap && p.bitmap.close) p.bitmap.close();
    this.previews.clear();
  }

  async loadPreviews() {
    const order = this.session.frames.map((_, k) => k).sort((a, b) => Math.abs(a - this.cur) - Math.abs(b - this.cur));
    const frames = this.session.frames;
    for (const k of order) {
      if (this.session.frames !== frames) return;
      try {
        const m = await this.media.call({ op: 'preview', path: frames[k].path, maxSide: PREVIEW_SIDE });
        if (this.session.frames !== frames) { m.bitmap.close(); return; }
        this.previews.set(k, { bitmap: m.bitmap, width: m.width, height: m.height });
        this.row.refresh();
        if (k === this.cur) this.schedule();
      } catch (_) { /* the frame shows empty; its badge says why when tracking fails */ }
    }
  }

  /** The session changed (a tracked frame came in): transforms and the row follow. */
  sessionChanged() {
    this.row.refresh();
    if (!this.session.busy) this.recompute({ keepCrop: true });
    else this.schedule();
    this.changed();
  }

  // ---- the geometry ------------------------------------------------------------------------

  included() {
    return this.session.frames.map((f) => f.included && !!f.track && f.track.area > 0);
  }

  /** Transforms, the common area and the crop, from the tracking as it stands. */
  recompute({ keepCrop = false } = {}) {
    const s = this.session;
    const tracked = s.tracked();
    if (s.ref < 0 || !tracked[s.ref]) { this.T = []; this.poly = []; this.schedule(); this.changed(); return; }
    this.T = transforms(tracked, s.ref, this.lock);
    this.poly = commonArea(tracked, this.T, this.included());
    const ratio = aspectRatio(this.aspect);
    if (!this.crop || !keepCrop) this.crop = defaultCrop(tracked[s.ref], ratio, this.poly);
    else this.crop = fitRect(this.crop, this.poly);
    this.schedule();
    this.changed();
  }

  applyAspect() {
    if (!this.crop) return;
    this.crop = fitRect(withAspect(this.crop, aspectRatio(this.aspect)), this.poly);
    this.schedule();
    this.changed();
  }

  setIncluded(k, on) {
    const f = this.session.frames[k];
    if (!f) return;
    f.included = !!on;
    this.poly = commonArea(this.session.tracked(), this.T, this.included());
    if (this.crop) this.crop = fitRect(this.crop, this.poly);
    this.row.refresh();
    this.schedule();
    this.changed();
  }

  setFrameHold(k, seconds) {
    const f = this.session.frames[k];
    if (!f) return;
    f.hold = seconds == null ? null : Number(seconds);
    this.changed();
  }

  /** The animation's timeline (js/burst/timing.js) over the frames that will be in it. */
  timeline() {
    const inc = this.included();
    return schedule(this.session.frames.map((f, k) => ({ time: f.time, included: inc[k], hold: f.hold })),
      { hold: this.hold, speed: this.speed });
  }

  /** The output's pixel size: the crop's aspect, `size` on its long side, even (WebM's 4:2:0). */
  outputSize() {
    if (!this.crop) return { width: 0, height: 0 };
    const [, , w, ht] = this.crop;
    const long = Math.min(this.size, Math.round(Math.max(w, ht)));
    const k = long / Math.max(w, ht);
    const even = (v) => Math.max(2, 2 * Math.round(v / 2));
    return { width: even(w * k), height: even(ht * k) };
  }

  // ---- moving through the frames ---------------------------------------------------------------

  go(k) {
    if (k < 0 || k >= this.session.frames.length) return;
    this.cur = k;
    this.row.setCurrent(k);
    const f = this.session.frames[k];
    this.setCorrecting(f.status === 'lost' && !this.playing);
    this.schedule();
    this.changed();
  }

  /** The next frame that will be in the animation (dir +1 / -1), wrapping. */
  step(dir) {
    const inc = this.included();
    const n = this.session.frames.length;
    for (let i = 1; i <= n; i++) {
      const k = (this.cur + dir * i + n * n) % n;
      if (inc[k]) { this.go(k); return; }
    }
  }

  play() {
    const s = this.timeline();
    if (!s.frames.length || !this.crop) return;
    this.playing = true;
    this.setCorrecting(false);
    let i = Math.max(0, s.frames.findIndex((f) => f.index === this.cur));
    const show = () => {
      if (!this.playing) return;
      const t = this.timeline();
      if (!t.frames.length) { this.pause(); return; }
      i %= t.frames.length;
      const f = t.frames[i];
      this.cur = f.index;
      this.row.setCurrent(f.index);
      this.schedule();
      i++;
      this.timer = setTimeout(show, Math.max(20, f.duration * 1000));
    };
    show();
    this.changed();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.schedule();
    this.changed();
  }

  // ---- correcting a frame's subject -------------------------------------------------------------

  setCorrecting(on) {
    this.correcting = !!on;
    this.stage.classList.toggle('picking', this.correcting);
    this.hint.classList.toggle('hidden', !this.correcting);
    this.hint.textContent = 'Click the subject in this frame · Alt+click removes an area';
    this.schedule();
    this.changed();
  }

  async correctAt(q, remove) {
    const k = this.cur;
    const f = this.session.frames[k];
    const p = apply(this.T[k] || [1, 0, 0, 0, 1, 0], q);                 // stabilized -> frame k
    if (p[0] < 0 || p[1] < 0 || p[0] >= f.width || p[1] >= f.height) return;
    const clicks = f.clicks || { points: [], labels: [] };
    const points = [...clicks.points, p], labels = [...clicks.labels, remove ? 0 : 1];
    f.clicks = { points, labels };
    this.schedule();
    try {
      this.session.stop();
      await this.session.seed(k, points, labels);
      f.clicks = { points, labels };
      f.status = statusOf(f.track);
      this.row.refresh();
      // Carry the corrected subject on, away from the reference.
      await this.session.track({ from: k });
      this.recompute({ keepCrop: true });
    } catch (err) {
      this.session.error = err.message;
      this.changed();
    }
  }

  // ---- drawing --------------------------------------------------------------------------------

  /** Stabilized -> stage CSS px: the reference frame fitted, or (playing) the crop. */
  viewMatrix() {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    const ref = this.session.frames[this.session.ref];
    if (!ref || !W || !H) return null;
    const box = this.playing && this.crop ? this.crop : [0, 0, ref.width, ref.height];
    const pad = this.playing ? 8 : 24;
    const k = Math.min((W - 2 * pad) / box[2], (H - 2 * pad) / box[3]);
    return [k, 0, (W - box[2] * k) / 2 - box[0] * k, 0, k, (H - box[3] * k) / 2 - box[1] * k];
  }

  draw() {
    const c = this.canvas;
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    const V = this.viewMatrix();
    if (!V) return;
    const D = compose(scaling(dpr), V);                                  // stabilized -> canvas px
    const k = this.cur;
    const f = this.session.frames[k];
    const Tk = this.T[k] || [1, 0, 0, 0, 1, 0];
    const toCanvas = compose(D, invert(Tk));                             // frame k -> canvas px
    const p = this.previews.get(k);
    if (this.playing && this.crop) {
      ctx.save();
      const [x, y] = apply(D, [this.crop[0], this.crop[1]]);
      ctx.beginPath();
      ctx.rect(x, y, this.crop[2] * D[0], this.crop[3] * D[4]);
      ctx.clip();
    }
    if (p) {
      const s = f.width / p.bitmap.width;
      const m = compose(toCanvas, scaling(s));
      ctx.save();
      ctx.setTransform(m[0], m[3], m[1], m[4], m[2], m[5]);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(p.bitmap, 0, 0);
      ctx.restore();
    }
    if (this.playing && this.crop) { ctx.restore(); return; }
    if (f.track && f.track.mask) {
      const mask = f.track.mask;
      const bmp = maskBitmapNow(mask, () => this.schedule());
      if (bmp) drawMask(ctx, mask, bmp, toCanvas);
    }
    if (f.clicks) drawClicks(ctx, f.clicks.points, f.clicks.labels, toCanvas);
    this.drawCoverage(ctx, D, bw, bh);
    this.drawCrop(ctx, D);
  }

  /** Everything outside the common area, shaded. */
  drawCoverage(ctx, D, bw, bh) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.rect(0, 0, bw, bh);
    if (this.poly.length >= 3) {
      const pts = this.poly.map((q) => apply(D, q));
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = pts.length - 1; i >= 1; i--) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }
    ctx.fillStyle = tokenColor('--scrim');
    ctx.fill('evenodd');
    ctx.restore();
  }

  drawCrop(ctx, D) {
    if (!this.crop) return;
    const pts = corners(this.crop).map((q) => apply(D, q));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = 2;
    ctx.strokeStyle = tokenColor('--accent');
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = tokenColor('--accent');
    for (const [x, y] of pts) ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.restore();
  }

  // ---- input --------------------------------------------------------------------------------

  stagePoint(e) {
    const r = this.stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  onPointerDown(e) {
    if (e.button !== 0 || this.playing) return;
    const V = this.viewMatrix();
    if (!V) return;
    this.stage.focus();
    const s0 = this.stagePoint(e);
    const q0 = apply(invert(V), s0);
    if (this.correcting) {
      const up = (ev) => {
        window.removeEventListener('pointerup', up, true);
        const s1 = this.stagePoint(ev);
        if (Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) <= 4) this.correctAt(q0, ev.altKey || e.altKey);
      };
      window.addEventListener('pointerup', up, true);
      return;
    }
    if (!this.crop) return;
    // A corner sizes the crop (the opposite corner stays); inside moves it.
    const cs = corners(this.crop).map((q) => apply(V, q));
    const corner = cs.findIndex(([x, y]) => Math.hypot(x - s0[0], y - s0[1]) <= HANDLE_PX);
    const [x, y, w, ht] = this.crop;
    const inside = q0[0] >= x && q0[0] <= x + w && q0[1] >= y && q0[1] <= y + ht;
    if (corner < 0 && !inside) return;
    e.preventDefault();
    const start = this.crop.slice();
    const ratio = aspectRatio(this.aspect);
    const minSide = MIN_CROP_PX / V[0];
    const move = (ev) => {
      const q = apply(invert(V), this.stagePoint(ev));
      let want;
      if (corner < 0) {
        want = [start[0] + q[0] - q0[0], start[1] + q[1] - q0[1], start[2], start[3]];
      } else {
        const fixed = corners(start)[(corner + 2) % 4];
        let wx = Math.max(minSide, Math.abs(q[0] - fixed[0]));
        let wy = Math.max(minSide, Math.abs(q[1] - fixed[1]));
        if (ratio) { if (wx / wy > ratio) wy = wx / ratio; else wx = wy * ratio; }
        const sx = q[0] >= fixed[0] ? 1 : -1, sy = q[1] >= fixed[1] ? 1 : -1;
        want = [sx > 0 ? fixed[0] : fixed[0] - wx, sy > 0 ? fixed[1] : fixed[1] - wy, wx, wy];
      }
      this.setCrop(want);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      this.changed();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  /** Ask for a crop (stabilized coordinates): it is kept inside the common area. */
  setCrop(want) {
    this.crop = constrainCrop(want, this.crop, this.poly);
    this.schedule();
    this.changed();
  }

  // ---- what the rest of the app reads -----------------------------------------------------------------

  changed() {
    const s = this.session;
    const t = this.timeline();
    const n = s.frames.length;
    const out = this.outputSize();
    this.panel.update({
      lock: this.lock, aspect: this.aspect, hold: this.hold, speed: this.speed, format: this.format, size: this.size,
      frame: s.frames[this.cur], frameIndex: this.cur,
      timesText: n ? `${t.frames.length} of ${n} frames · shot over ${t.realElapsed.toFixed(2)} s · plays ${t.total.toFixed(2)} s` : '',
      outText: out.width ? `${out.width} × ${out.height}` : '',
      modelText: s.modelInfo ? `Subject found with ${s.modelInfo.name} (${s.modelInfo.device})` : '',
    });
    this.exportButton.disabled = !this.canExport();
    if (this.onChange) this.onChange();
  }

  canExport() {
    return !this.exporting && !!this.crop && this.session.ready() && this.timeline().frames.length > 1;
  }

  /** Numbers for tests and the inspector. */
  model() {
    return {
      cur: this.cur, ref: this.session.ref, lock: this.lock, aspect: this.aspect, playing: this.playing,
      correcting: this.correcting, crop: this.crop && this.crop.slice(), area: this.poly.map((p) => p.slice()),
      T: this.T.map((m) => m.slice()), schedule: this.timeline(), output: this.outputSize(),
      statuses: this.session.frames.map((f) => (f.included ? f.status : 'off')),
    };
  }

  /** What the export renders: the included frames in order, each with its transform and time. */
  exportPlan() {
    const t = this.timeline();
    return t.frames.map((sf) => ({ path: this.session.frames[sf.index].path, T: this.T[sf.index], duration: sf.duration, index: sf.index }));
  }
}
