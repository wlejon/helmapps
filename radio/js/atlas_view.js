/**
 * The atlas on a canvas: anchors (dots), the trail of played chunks, the
 * listener, and the path ahead. Pan with a drag on empty space, zoom with the
 * wheel.
 *
 * Input, reported in map coordinates ([-1, 1] is the anchors' extent):
 *   click             onGo(x, y)          go there now
 *   shift+click       onWaypoint(x, y)    add a point to the path ahead
 *   drag the listener onMove(x, y, end)   continuous; end on release
 *   hover             onHover(anchor | null)
 *
 * The view holds what it draws (setState) and redraws only when something
 * changed (invalidate), at most once a frame.
 */

import { h } from '/lib/dom.js';

const PICK_PX = 14;            // a press this close to the listener grabs it
const CLICK_SLOP_PX = 4;       // a press that moves less than this is a click

/** A kit colour token, resolved for the canvas. */
function token(name) {
  try { return getComputedStyle(document.body).getPropertyValue(name).trim(); } catch (_) { return ''; }
}

export class AtlasView {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.canvas = h('canvas.atlas-canvas');
    this.el = h('div.atlas', this.canvas);
    this.atlas = null;
    this.state = { listener: null, owner: -1, trail: [], path: [], planned: -1, hover: -1, playing: -1 };
    this.view = { cx: 0, cy: 0, zoom: 1 };
    this.dirty = true;
    this.size = { w: 0, h: 0, dpr: 1 };
    this.press = null;
    this.colors = null;

    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointerleave', () => this.setHover(-1));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e));
  }

  setAtlas(atlas) { this.atlas = atlas; this.invalidate(); }
  setState(patch) { Object.assign(this.state, patch); this.invalidate(); }
  invalidate() { this.dirty = true; }

  // ---- coordinates -------------------------------------------------------

  /** Map units to CSS px: the anchors' extent fills the shorter side at zoom 1. */
  scale() { return 0.45 * Math.min(this.size.w, this.size.h) * this.view.zoom; }
  toScreen(x, y) {
    const s = this.scale();
    return [this.size.w / 2 + (x - this.view.cx) * s, this.size.h / 2 - (y - this.view.cy) * s];
  }
  toMap(px, py) {
    const s = this.scale();
    return [this.view.cx + (px - this.size.w / 2) / s, this.view.cy - (py - this.size.h / 2) / s];
  }
  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ---- input -------------------------------------------------------------

  down(e) {
    if (e.button !== 0) return;
    const [px, py] = this.local(e);
    const L = this.state.listener;
    let grab = false;
    if (L) { const [lx, ly] = this.toScreen(L.x, L.y); grab = Math.hypot(lx - px, ly - py) <= PICK_PX; }
    this.press = { px, py, grab, moved: false, shift: e.shiftKey, view: { ...this.view } };
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine without */ }
  }

  move(e) {
    const [px, py] = this.local(e);
    const p = this.press;
    if (!p) { this.hoverAt(px, py); return; }
    if (!p.moved && Math.hypot(px - p.px, py - p.py) < CLICK_SLOP_PX) return;
    p.moved = true;
    if (p.grab) {
      const [x, y] = this.toMap(px, py);
      if (this.hooks.onMove) this.hooks.onMove(x, y, false);
    } else {
      const s = this.scale();
      this.view.cx = p.view.cx - (px - p.px) / s;
      this.view.cy = p.view.cy + (py - p.py) / s;
      this.invalidate();
    }
  }

  up(e) {
    const p = this.press;
    this.press = null;
    if (!p) return;
    const [px, py] = this.local(e);
    const [x, y] = this.toMap(px, py);
    if (p.grab && p.moved) { if (this.hooks.onMove) this.hooks.onMove(x, y, true); return; }
    if (p.moved) return;
    if (p.shift || e.shiftKey) { if (this.hooks.onWaypoint) this.hooks.onWaypoint(x, y); }
    else if (this.hooks.onGo) this.hooks.onGo(x, y);
  }

  wheel(e) {
    const [px, py] = this.local(e);
    const [mx, my] = this.toMap(px, py);
    const f = Math.exp(-Math.sign(e.deltaY) * 0.15);
    this.view.zoom = Math.min(12, Math.max(0.5, this.view.zoom * f));
    // Keep the point under the cursor where it is.
    const [nx, ny] = this.toMap(px, py);
    this.view.cx += mx - nx; this.view.cy += my - ny;
    this.invalidate();
    e.preventDefault();
  }

  hoverAt(px, py) {
    if (!this.atlas) return;
    let best = -1, bd = PICK_PX;
    for (const a of this.atlas.anchors) {
      const [ax, ay] = this.toScreen(a.x, a.y);
      const d = Math.hypot(ax - px, ay - py);
      if (d < bd) { bd = d; best = a.id; }
    }
    this.setHover(best);
  }

  setHover(id) {
    if (id === this.state.hover) return;
    this.state.hover = id;
    this.invalidate();
    if (this.hooks.onHover) this.hooks.onHover(id >= 0 && this.atlas ? this.atlas.anchors[id] : null);
  }

  resetView() { this.view = { cx: 0, cy: 0, zoom: 1 }; this.invalidate(); }

  // ---- drawing -------------------------------------------------------------

  /** Once a frame: resizes the backing store when the element changed, draws when dirty. */
  frame() {
    const r = this.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (Math.round(r.width) !== this.size.w || Math.round(r.height) !== this.size.h || dpr !== this.size.dpr) {
      this.size = { w: Math.round(r.width), h: Math.round(r.height), dpr };
      this.canvas.width = Math.max(1, Math.round(this.size.w * dpr));
      this.canvas.height = Math.max(1, Math.round(this.size.h * dpr));
      this.canvas.style.width = `${this.size.w}px`;
      this.canvas.style.height = `${this.size.h}px`;
      this.dirty = true;
    }
    if (!this.dirty || !this.size.w) return;
    this.dirty = false;
    this.draw();
  }

  draw() {
    const c = this.colors || (this.colors = {
      dot: token('--t4'), dotOwner: token('--accent'), trail: token('--t3'), path: token('--t2'),
      listener: token('--accent'), bg: token('--surface-0'), hover: token('--t1'),
    });
    const g = this.canvas.getContext('2d');
    const { dpr } = this.size;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = c.bg;
    g.fillRect(0, 0, this.size.w, this.size.h);
    if (!this.atlas) return;
    const st = this.state;

    // Anchors.
    for (const a of this.atlas.anchors) {
      const [x, y] = this.toScreen(a.x, a.y);
      const owner = a.id === st.owner, hover = a.id === st.hover;
      g.fillStyle = owner ? c.dotOwner : hover ? c.hover : c.dot;
      g.beginPath();
      g.arc(x, y, owner || hover ? 4.5 : 2.5, 0, Math.PI * 2);
      g.fill();
    }

    // Trail: where the music went, oldest faintest.
    const trail = st.trail;
    if (trail.length) {
      g.strokeStyle = c.trail;
      g.lineWidth = 1.5;
      for (let i = 1; i < trail.length; i++) {
        g.globalAlpha = 0.25 + 0.75 * (i / trail.length);
        const [x0, y0] = this.toScreen(trail[i - 1].x, trail[i - 1].y);
        const [x1, y1] = this.toScreen(trail[i].x, trail[i].y);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      g.fillStyle = c.trail;
      for (let i = 0; i < trail.length; i++) {
        g.globalAlpha = 0.25 + 0.75 * ((i + 1) / trail.length);
        const [x, y] = this.toScreen(trail[i].x, trail[i].y);
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }

    // The path ahead, dashed, from the listener.
    const L = st.listener;
    if (L && st.path.length) {
      g.strokeStyle = c.path;
      g.lineWidth = 1.5;
      g.setLineDash([5, 5]);
      g.beginPath();
      const [lx, ly] = this.toScreen(L.x, L.y);
      g.moveTo(lx, ly);
      for (const p of st.path) { const [x, y] = this.toScreen(p.x, p.y); g.lineTo(x, y); }
      g.stroke();
      g.setLineDash([]);
      for (const p of st.path) {
        const [x, y] = this.toScreen(p.x, p.y);
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
      }
    }

    // The listener: a ring, with a line to the music's newest trail point.
    if (L) {
      const [x, y] = this.toScreen(L.x, L.y);
      if (trail.length) {
        const t = trail[trail.length - 1];
        const [tx, ty] = this.toScreen(t.x, t.y);
        g.strokeStyle = c.trail; g.lineWidth = 1; g.setLineDash([2, 4]);
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
        g.setLineDash([]);
      }
      g.strokeStyle = c.listener;
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.stroke();
      g.fillStyle = c.listener;
      g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
    }
  }
}
