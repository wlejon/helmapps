/**
 * The burst's frames as a row along the bottom of the stabilize view: each
 * frame's picture with its subject's mask over it and a badge saying how
 * sure the tracking is (or that the frame needs a click, or is left out).
 * A click makes a frame the current one. A kit VirtualList, sideways.
 *
 *   const row = new FrameRow({ session, previews, onPick: (k) => view.go(k) });
 *   row.refresh();            // statuses or previews changed
 *   row.setCurrent(k);
 */

import { h } from '/lib/dom.js';
import { VirtualList } from '/lib/list.js';
import { maskBitmap, drawMask } from './draw.js';

const CELL_W = 112;
const CELL_H = 96;

export function badgeOf(f) {
  if (!f.included) return { text: 'Left out', kind: 'off' };
  switch (f.status) {
    case 'pending': return { text: '…', kind: 'wait' };
    case 'tracking': return { text: 'Tracking', kind: 'wait' };
    case 'seed': return { text: 'Set', kind: 'ok' };
    case 'lost': return { text: 'Click subject', kind: 'bad' };
    case 'low': return { text: `Check ${Math.round(f.track.confidence * 100)}%`, kind: 'bad' };
    default: return { text: `${Math.round(f.track.confidence * 100)}%`, kind: 'ok' };
  }
}

export class FrameRow {
  constructor({ session, previews, onPick }) {
    this.session = session;
    this.previews = previews;           // index -> { bitmap, width, height }
    this.current = -1;
    this.list = new VirtualList({
      orientation: 'horizontal', multiSelect: false, scrollAlign: 'center', typeAhead: false,
      cellWidth: CELL_W, cellHeight: CELL_H, padding: 4,
      key: (f) => f.path,
      label: (f) => f.name,
      render: (f, el, i) => this.renderCell(f, el, i),
      onSelectionChange: (items) => {
        if (this.syncing || !items[0]) return;
        const k = this.session.frames.indexOf(items[0]);
        if (k >= 0 && k !== this.current && onPick) onPick(k);
      },
    });
    this.list.el.classList.add('iv-burst-row');
    this.el = this.list.el;
  }

  refresh() {
    if (this.list.items !== this.session.frames) this.list.setItems(this.session.frames);
    else this.list.refresh();
  }

  setCurrent(k) {
    this.current = k;
    const f = this.session.frames[k];
    if (!f) return;
    this.syncing = true;
    this.list.select([f.path]);
    this.syncing = false;
  }

  renderCell(f, el, i) {
    if (!el._canvas) {
      el._canvas = h('canvas.iv-burst-thumb');
      el._badge = h('span.badge.iv-burst-badge');
      el._name = h('span.iv-burst-name.ellipsis');
      el.replaceChildren(el._canvas, h('div.iv-burst-cap', el._name, el._badge));
    }
    const k = this.session.frames.indexOf(f);
    el.title = f.name;
    el.dataset.index = String(k);
    el.dataset.status = f.included ? f.status : 'off';
    el.classList.toggle('dimmed', !f.included);
    el.classList.toggle('ref', k === this.session.ref);
    el._name.textContent = f.name.replace(/\.[^.]+$/, '');
    const b = badgeOf(f);
    el._badge.textContent = b.text;
    el._badge.dataset.kind = b.kind;
    this.paintThumb(el, f, k);
  }

  paintThumb(el, f, k) {
    const c = el._canvas;
    const p = this.previews.get(k);
    const W = CELL_W - 8, H = 60;
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!p || !f.width) return;
    // The thumbnail shows the subject's neighbourhood when there is one, else the photo.
    let view = [0, 0, f.width, f.height];
    if (f.track && f.track.area > 0) {
      const side = Math.max(f.track.bbox[2], f.track.bbox[3]) * 2.2;
      const [cx, cy] = f.track.centroid;
      const vw = side * (W / H), vh = side;
      view = [cx - vw / 2, cy - vh / 2, vw, vh];
    }
    const k2 = Math.min(c.width / view[2], c.height / view[3]);
    const ox = (c.width - view[2] * k2) / 2 - view[0] * k2, oy = (c.height - view[3] * k2) / 2 - view[1] * k2;
    const M = [k2, 0, ox, 0, k2, oy];                    // full coordinates -> thumb px
    const s = f.width / p.bitmap.width;
    ctx.setTransform(M[0] * s, 0, 0, M[4] * s, M[2], M[5]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(p.bitmap, 0, 0);
    const mask = f.track && f.track.mask;
    if (mask) {
      maskBitmap(mask).then((bmp) => {
        if (el.dataset.index !== String(k)) return;
        drawMask(ctx, mask, bmp, M);
      });
    }
  }
}
