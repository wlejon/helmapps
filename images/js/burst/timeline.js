/**
 * The stabilize view's timeline: the frames that play, left to right, each
 * a cell as wide as it is held, its picture inside. A gap between bursts
 * shows as a break after the burst's last frame. The playhead moves while
 * the animation plays; a click on a cell goes to that frame.
 *
 *   - Click selects and goes there; Shift+click selects a range, Ctrl+click
 *     adds or takes away one.
 *   - Drag a cell's right edge (or a gap's break) to set how long it holds;
 *     with several selected and one of them dragged, they all take the hold.
 *     The time shows while dragging; it snaps to steps (0.01 s under 0.2 s,
 *     then 0.05 s, then 0.1 s) and to the frame's time as shot. A double
 *     click on the edge puts back the time as shot.
 *   - The bar above: play, the time, the speed, the removed frames (a quiet
 *     button: restore them), and the zoom (Ctrl+wheel zooms too).
 *
 * Only the cells on screen exist (100+ frames stay cheap), and a cell's
 * picture is drawn from the stage's preview (never a full decode), again
 * only when what it shows changed.
 *
 *   const tl = new Timeline({ session, previews, on: { seek, select, holdsStart, holds, holdsEnd, play, speed, restore } });
 *   tl.update({ schedule, cur, speed, playing, removed });
 *   tl.playFrom(k, seconds);         // playing: the playhead runs across frame k's cell
 *   tl.selection                     // Set of frame indices
 */

import { h, clamp, perFrame } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { menu } from '/lib/menu.js';
import { Select } from '/lib/controls.js';

/** px a cell is never narrower than, whatever its hold. */
const MIN_CELL = 10;
/** The break after a gap between bursts, in px. */
const GAP_PX = 14;
/** Padding at the timeline's ends, in px. */
const PAD = 12;
/** The picture's size in a cell (CSS px). */
const THUMB_W = 96;
const THUMB_H = 56;
/** The widest a cell's strip of pictures is drawn, in CSS px. */
const MAX_STRIP = 720;
/** The edge's grab width, in px, and the pull of the time as shot. */
const EDGE_PX = 8;
const MAGNET_PX = 6;
/** Cells drawn beyond each side of the view, in px. */
const OVERSCAN = 400;
const MIN_PPS = 30;
const MAX_PPS = 3000;

export const SPEED_CHOICES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

/** A hold snapped to a sensible step, in seconds. */
export function snapHold(s) {
  const step = s < 0.2 ? 0.01 : s < 1 ? 0.05 : 0.1;
  return Math.max(0.02, Math.round(s / step) * step);
}

/** Seconds as the timeline writes them: 0.08 s, 0.5 s, 1.2 s. */
export function formatSeconds(s) {
  if (!(s >= 0)) return '';
  if (s < 0.995) return `${s.toFixed(2).replace(/0$/, '')} s`.replace(/\.0 s$/, ' s');
  return `${s.toFixed(s < 10 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, '')} s`;
}

/** What a frame's tracking says on its cell: { text, kind } or null when all is well. */
export function flagOf(f) {
  switch (f.status) {
    case 'pending': return { text: '…', kind: 'wait', tip: 'Not tracked yet' };
    case 'tracking': return { text: '…', kind: 'wait', tip: 'Tracking' };
    case 'lost': return { text: 'Click subject', kind: 'bad', tip: 'The subject was lost: click it in this frame' };
    case 'low': return { text: `Check ${Math.round(f.track.confidence * 100)}%`, kind: 'bad', tip: 'Tracking is unsure here: check this frame' };
    default: return null;
  }
}

export class Timeline {
  constructor({ session, previews, on }) {
    this.session = session;
    this.previews = previews;
    this.on = on;
    this.selection = new Set();
    this.anchor = -1;
    this.cur = -1;
    this.order = [];                  // frame indices in play order
    this.slot = new Map();            // frame index -> { j, x, w, start, duration, gap, asShot, custom }
    this.width = 0;
    this.pps = 0;                     // px per second; 0 until the first layout picks one
    this.userZoom = false;
    this.speed = 1;
    this.playing = false;
    this.sig = '';
    this.pool = new Map();            // frame index -> cell element on screen
    this.free = [];
    this.anim = null;                 // { k, t0, dur } while playing
    this.drag = null;

    // The bar.
    this.playBtn = h('button.icon-btn.small', { 'data-tip': 'Play', 'data-keys': 'Space', onclick: () => on.play() }, icon('play'));
    this.timeEl = h('span.iv-tl-time.num');
    this.speedSel = new Select({
      options: SPEED_CHOICES.map((s) => ({ value: s, label: `${s}×` })), value: 1, onChange: (v) => on.speed(v),
    });
    this.speedSel.el.classList.add('iv-tl-speed');
    this.speedSel.el.dataset.tip = 'Speed';
    this.hintEl = h('span.iv-tl-hint.ellipsis');
    this.removedBtn = h('button.btn.ghost.small.iv-tl-removed.hidden', { 'data-tip': 'Removed frames: restore them',
      onclick: () => this.removedMenu() }, icon('eye-off'), h('span.num'));
    this.zoomOut = h('button.icon-btn.small', { 'data-tip': 'Zoom out', onclick: () => this.zoomBy(1 / 1.5) }, icon('zoom-out'));
    this.fitBtn = h('button.btn.ghost.small', { 'data-tip': 'Fit the timeline', onclick: () => this.fit() }, 'Fit');
    this.zoomIn = h('button.icon-btn.small', { 'data-tip': 'Zoom in', onclick: () => this.zoomBy(1.5) }, icon('zoom-in'));
    this.bar = h('div.iv-tl-bar', this.playBtn, this.timeEl,
      h('span.iv-tl-label', 'Speed'), this.speedSel.el, this.hintEl,
      this.removedBtn, h('span.iv-tl-zoom', this.zoomOut, this.fitBtn, this.zoomIn));

    // The track.
    this.playhead = h('div.iv-tl-playhead');
    this.tip = h('div.iv-tl-tip.num.hidden');
    this.content = h('div.iv-tl-content', this.playhead, this.tip);
    this.scroller = h('div.iv-tl-scroll', { tabindex: '-1' }, this.content);
    this.el = h('div.iv-tl', this.bar, this.scroller);

    this.paint = perFrame(() => this.render());
    this.scroller.addEventListener('scroll', () => this.paint());
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.content.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.content.addEventListener('dblclick', (e) => this.onDblClick(e));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.layout()).observe(this.scroller);
  }

  // ---- state from the view ------------------------------------------------------------------

  /**
   * schedule: timing.js's schedule over the frames that play; cur: the frame
   * on the stage; removed: how many frames are out.
   */
  update({ schedule, cur, speed, playing, removed }) {
    this.schedule = schedule;
    this.speed = speed;
    this.speedSel.set(speed);
    this.removed = removed;
    this.removedBtn.classList.toggle('hidden', !removed.length);
    this.removedBtn.lastChild.textContent = `${removed.length} removed`;
    this.playing = playing;
    this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    this.playBtn.dataset.tip = playing ? 'Pause' : 'Play';
    const order = schedule.frames.map((f) => f.index);
    // The selection keeps only frames that play.
    const plays = new Set(order);
    for (const k of [...this.selection]) if (!plays.has(k)) this.selection.delete(k);
    this.cur = cur;
    if (!this.selection.size && plays.has(cur)) { this.selection = new Set([cur]); this.anchor = cur; }
    this.order = order;
    const frames = this.session.frames;
    const sig = `${speed}|${schedule.frames.map((f) => `${f.index}:${f.duration.toFixed(4)}:${f.gap ? 1 : 0}`).join(',')}`;
    if (sig !== this.sig) { this.sig = sig; this.layout(); }
    // Statuses change without the timing: the cells on screen say so now.
    const statusSig = frames.map((f) => f.status).join();
    if (statusSig !== this.statusSig) { this.statusSig = statusSig; this.refresh(); }
    this.updateTime();
    this.updateHint();
    this.paint();
  }

  /** Select only frame k (the arrows, a step, the stage). */
  selectOnly(k) {
    this.selection = new Set(k >= 0 ? [k] : []);
    this.anchor = k;
    this.updateHint();
    this.refresh();
  }

  /** Positions from the schedule and the zoom. */
  layout() {
    const s = this.schedule;
    if (!s) return;
    const view = this.scroller.clientWidth;
    if (!this.pps || !this.userZoom) this.pps = this.defaultPps(view);
    this.slot = new Map();
    let x = PAD;
    s.frames.forEach((f, j) => {
      const w = Math.max(MIN_CELL, f.duration * this.pps);
      this.slot.set(f.index, { j, x, w, start: f.start, duration: f.duration, gap: f.gap && j < s.frames.length - 1,
        asShot: f.asShot / (this.speed || 1), custom: f.custom, interval: f.interval });
      x += w + (f.gap && j < s.frames.length - 1 ? GAP_PX : 0);
    });
    this.width = x + PAD;
    this.content.style.width = `${Math.max(this.width, view)}px`;
    this.paint();
  }

  /** The zoom that shows everything when it can, else a typical frame at about a picture's width. */
  defaultPps(view) {
    const s = this.schedule;
    if (!s || !s.frames.length || !view) return 600;
    const gaps = s.frames.filter((f, j) => f.gap && j < s.frames.length - 1).length;
    const fit = (view - 2 * PAD - gaps * GAP_PX) / Math.max(s.total, 0.01);
    const typical = (s.typical || 0.1) / (this.speed || 1);
    const roomy = (THUMB_W + 8) / typical;                // a typical cell shows its whole picture
    const tight = 40 / typical;                           // at least this wide fitted
    return clamp(fit >= tight ? Math.min(fit, roomy * 1.6) : roomy, MIN_PPS, MAX_PPS);
  }

  zoomBy(f, aroundX = null) {
    const view = this.scroller.clientWidth;
    const ax = aroundX == null ? view / 2 : aroundX;
    const t = (this.scroller.scrollLeft + ax) / Math.max(1, this.width);
    this.pps = clamp(this.pps * f, MIN_PPS, MAX_PPS);
    this.userZoom = true;
    this.layout();
    this.scroller.scrollLeft = Math.max(0, t * this.width - ax);
  }

  fit() {
    const s = this.schedule;
    if (!s) return;
    const view = this.scroller.clientWidth;
    const gaps = s.frames.filter((f, j) => f.gap && j < s.frames.length - 1).length;
    this.pps = clamp((view - 2 * PAD - gaps * GAP_PX) / Math.max(s.total, 0.01), MIN_PPS, MAX_PPS);
    this.userZoom = true;
    this.layout();
    this.scroller.scrollLeft = 0;
  }

  updateTime() {
    const s = this.schedule;
    const sl = this.slot.get(this.cur);
    this.timeEl.textContent = s ? `${(sl ? sl.start : 0).toFixed(2)} / ${s.total.toFixed(2)} s` : '';
  }

  updateHint() {
    const n = this.selection.size;
    this.hintEl.textContent = n > 1 ? `${n} frames selected · drag an edge to hold them all · Delete removes them`
      : 'Drag a frame\'s right edge to set how long it holds · Delete removes it';
  }

  // ---- drawing ---------------------------------------------------------------------------------

  render() {
    const view = this.scroller.clientWidth;
    const left = this.scroller.scrollLeft - OVERSCAN, right = this.scroller.scrollLeft + view + OVERSCAN;
    const want = new Set();
    for (const k of this.order) {
      const sl = this.slot.get(k);
      if (sl && sl.x + sl.w + GAP_PX >= left && sl.x <= right) want.add(k);
    }
    for (const [k, el] of this.pool) {
      if (!want.has(k)) { el.remove(); this.free.push(el); this.pool.delete(k); }
    }
    for (const k of want) {
      let el = this.pool.get(k);
      if (!el) {
        el = this.free.pop() || this.makeCell();
        this.pool.set(k, el);
        this.content.appendChild(el);
      }
      this.fill(el, k);
    }
    this.placePlayhead();
  }

  makeCell() {
    const canvas = h('canvas.iv-tl-thumb');
    const flag = h('span.badge.iv-tl-flag');
    const hold = h('span.iv-tl-hold.num');
    const name = h('span.iv-tl-name.ellipsis');
    const frame = h('div.iv-tl-frame', canvas, flag, h('div.iv-tl-cap', name, hold));
    const edge = h('div.iv-tl-edge');
    const gap = h('div.iv-tl-gap', h('div.iv-tl-gap-line'));
    const el = h('div.iv-tl-cell', frame, edge, gap);
    Object.assign(el, { _canvas: canvas, _flag: flag, _hold: hold, _name: name, _frame: frame, _edge: edge, _gap: gap, _paint: '' });
    return el;
  }

  fill(el, k) {
    const f = this.session.frames[k];
    const sl = this.slot.get(k);
    if (!f || !sl) return;
    el.dataset.index = String(k);
    el.style.left = `${sl.x}px`;
    el.style.width = `${sl.w}px`;
    el.classList.toggle('selected', this.selection.has(k));
    el.classList.toggle('current', k === this.cur);
    el.classList.toggle('ref', k === this.session.ref);
    el.classList.toggle('custom', sl.custom);
    el.classList.toggle('narrow', sl.w < 56);
    el.title = `${f.name} · holds ${formatSeconds(sl.duration)}${sl.custom ? ` (as shot ${formatSeconds(sl.asShot)})` : ''}`;
    el._name.textContent = f.name.replace(/\.[^.]+$/, '');
    el._hold.textContent = formatSeconds(sl.duration);
    const flag = flagOf(f);
    el._flag.classList.toggle('hidden', !flag);
    el.dataset.status = f.status;
    if (flag) {
      el._flag.textContent = sl.w >= 88 ? flag.text : '!';
      el._flag.dataset.kind = flag.kind;
      el._flag.title = flag.tip;
    }
    el._gap.classList.toggle('hidden', !sl.gap);
    if (sl.gap) {
      el._gap.style.left = `${sl.w}px`;
      el._gap.dataset.tip = `Gap between bursts: ${formatSeconds(sl.interval)} as shot, plays ${formatSeconds(sl.duration)}. Drag to change`;
    }
    // The picture: drawn again only when what it shows changed.
    // A cell wider than its picture repeats it, fainter: the frame held on.
    const stripW = Math.round(Math.max(THUMB_W, Math.min(sl.w - 2, MAX_STRIP)));
    el._canvas.style.width = `${stripW}px`;
    const p = this.previews.get(k);
    const t = f.track;
    const key = `${p ? 1 : 0}|${t ? `${t.centroid[0].toFixed(1)},${t.centroid[1].toFixed(1)},${t.bbox[2].toFixed(0)}` : '-'}|${stripW}|${devicePixelRatio || 1}`;
    if (el._paint !== `${k}|${key}`) {
      el._paint = `${k}|${key}`;
      this.paintThumb(el._canvas, f, p, stripW);
    }
  }

  paintThumb(c, f, p, stripW = THUMB_W) {
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const W = Math.round(THUMB_W * dpr), H = Math.round(THUMB_H * dpr);
    const SW = Math.round(stripW * dpr);
    if (c.width !== SW || c.height !== H) { c.width = SW; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, SW, H);
    if (!p || !f.width) return;
    // The subject's neighbourhood when there is one, else the photo.
    let view = [0, 0, f.width, f.height];
    if (f.track && f.track.area > 0) {
      const side = Math.max(f.track.bbox[2], f.track.bbox[3]) * 2.4;
      const [cx, cy] = f.track.centroid;
      const vw = Math.min(f.width, side * (W / H)), vh = Math.min(f.height, side);
      view = [clamp(cx - vw / 2, 0, f.width - vw), clamp(cy - vh / 2, 0, f.height - vh), vw, vh];
    }
    const k = Math.max(W / view[2], H / view[3]);                     // cover the cell
    const s = f.width / p.bitmap.width;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The picture, then (a wide cell) copies of it, faint: the frame held on.
    for (let x = 0; x < SW; x += W) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, W, H);
      ctx.clip();
      ctx.globalAlpha = x ? 0.25 : 1;
      ctx.setTransform(k * s, 0, 0, k * s, x + (W - view[2] * k) / 2 - view[0] * k, (H - view[3] * k) / 2 - view[1] * k);
      ctx.drawImage(p.bitmap, 0, 0);
      ctx.restore();
    }
  }

  /** Repaint the cells (a preview or a status came in). */
  refresh() {
    for (const [k, el] of this.pool) this.fill(el, k);
  }

  // ---- the playhead -------------------------------------------------------------------------------

  placePlayhead() {
    const sl = this.slot.get(this.cur);
    if (!sl) { this.playhead.classList.add('hidden'); return; }
    this.playhead.classList.remove('hidden');
    let x = sl.x;
    if (this.anim && this.anim.k === this.cur) {
      const t = clamp((Date.now() - this.anim.t0) / Math.max(1, this.anim.dur), 0, 1);
      x = sl.x + t * sl.w;
    }
    this.playhead.style.left = `${Math.round(x)}px`;
    return x;
  }

  /** Playing: frame k shows now for `seconds`; the playhead runs across its cell. */
  playFrom(k, seconds) {
    this.cur = k;
    this.selection = new Set([k]);
    this.anchor = k;
    this.anim = { k, t0: Date.now(), dur: seconds * 1000 };
    this.updateTime();
    this.paint();
    this.follow();
    if (!this.raf) {
      const tick = () => {
        if (!this.anim) { this.raf = 0; return; }
        this.placePlayhead();
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
  }

  stopPlayhead() {
    this.anim = null;
    this.placePlayhead();
  }

  /** Keep the current frame's cell in view. */
  follow() {
    const sl = this.slot.get(this.cur);
    if (!sl) return;
    const view = this.scroller.clientWidth, sx = this.scroller.scrollLeft;
    if (sl.x < sx + PAD || sl.x + Math.min(sl.w, view / 2) > sx + view - PAD) {
      this.scroller.scrollLeft = Math.max(0, sl.x - view / 3);
    }
  }

  // ---- input --------------------------------------------------------------------------------------

  cellAt(e) {
    const el = e.target.closest ? e.target.closest('.iv-tl-cell') : null;
    return el && el.dataset.index != null ? Number(el.dataset.index) : -1;
  }

  /** The cell whose right edge (or gap break) is under the pointer, or -1. */
  edgeAt(e) {
    const r = this.content.getBoundingClientRect();
    const x = e.clientX - r.left;
    for (const k of this.order) {
      const sl = this.slot.get(k);
      const end = sl.x + sl.w;
      if (Math.abs(x - end) <= EDGE_PX / 2 + 1 || (sl.gap && x >= end && x <= end + GAP_PX)) return k;
    }
    return -1;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    this.scroller.focus();
    const edge = this.edgeAt(e);
    if (edge >= 0) { this.startDrag(e, edge); return; }
    const k = this.cellAt(e);
    if (k < 0) return;
    e.preventDefault();
    if (e.shiftKey && this.anchor >= 0) {
      const a = this.order.indexOf(this.anchor), b = this.order.indexOf(k);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      this.selection = new Set(this.order.slice(lo, hi + 1));
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(this.selection);
      if (next.has(k) && next.size > 1) next.delete(k); else next.add(k);
      this.selection = next;
      this.anchor = k;
    } else {
      this.selection = new Set([k]);
      this.anchor = k;
    }
    this.cur = k;
    this.on.seek(k);
    this.on.select(this.selection);
    this.updateHint();
    this.refresh();
  }

  onDblClick(e) {
    const k = this.edgeAt(e);
    if (k < 0) return;
    const indices = this.selection.has(k) ? [...this.selection] : [k];
    this.on.holdsStart();
    this.on.holds(indices, null);
    this.on.holdsEnd();
  }

  startDrag(e, k) {
    e.preventDefault();
    const sl = this.slot.get(k);
    const indices = this.selection.has(k) ? [...this.selection] : [k];
    const x0 = e.clientX;
    const d0 = sl.duration;
    const asShot = sl.asShot;
    const speed = this.speed || 1;
    this.drag = { k, indices };
    this.on.holdsStart();
    const move = (ev) => {
      let d = Math.max(0.02, d0 + (ev.clientX - x0) / this.pps);
      let shot = false;
      if (Math.abs(d - asShot) * this.pps <= MAGNET_PX) { d = asShot; shot = true; } else d = snapHold(d);
      this.on.holds(indices, shot ? null : d * speed);
      const nsl = this.slot.get(k);
      this.tip.textContent = `${formatSeconds(d)}${shot ? ' · as shot' : ''}${indices.length > 1 ? ` · ${indices.length} frames` : ''}`;
      this.tip.classList.remove('hidden');
      if (nsl) this.tip.style.left = `${Math.round(nsl.x + nsl.w)}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      this.tip.classList.add('hidden');
      this.drag = null;
      this.on.holdsEnd();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = this.scroller.getBoundingClientRect();
      this.zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left);
      return;
    }
    // A vertical wheel scrolls the timeline sideways.
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      this.scroller.scrollLeft += e.deltaY;
    }
  }

  removedMenu() {
    const removed = this.removed || [];
    if (!removed.length) return;
    const frames = this.session.frames;
    menu.showBelow([
      { label: `Restore All (${removed.length})`, icon: 'undo', action: () => this.on.restore(null) },
      { separator: true },
      ...removed.slice(0, 24).map((k) => ({ label: `Restore ${frames[k].name}`, action: () => this.on.restore([k]) })),
    ], this.removedBtn);
  }

  /** Numbers for tests: each playing frame's cell { index, x, w, gap }. */
  cells() {
    return this.order.map((k) => { const s = this.slot.get(k); return { index: k, x: s.x, w: s.w, gap: s.gap }; });
  }
}
