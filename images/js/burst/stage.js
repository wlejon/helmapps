/**
 * Drawing the stabilize view's stage: the current frame through its
 * stabilizing transform, its subject's mask and the clicks that set it, the
 * area not every frame covers (shaded) and the crop with its corners.
 * While playing, only the crop's inside.
 *
 *   drawStage(view);        // view: StabilizeView (canvas, stage, previews, T, poly, crop, ...)
 *
 * Coordinates: "stabilized" is the reference frame's own full-resolution
 * pixels; T[k] maps it into frame k. V (view.viewMatrix()) maps stabilized
 * to stage CSS px; D adds the device scale.
 */

import { compose, invert, apply, scaling, corners } from './affine.js';
import { maskBitmapNow, drawMask, drawClicks, tokenColor } from './draw.js';

export function drawStage(view) {
  const c = view.canvas;
  const W = view.stage.clientWidth, H = view.stage.clientHeight;
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const bw = Math.max(1, Math.round(W * dpr)), bh = Math.max(1, Math.round(H * dpr));
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bw, bh);
  const V = view.viewMatrix();
  if (!V) return;
  const D = compose(scaling(dpr), V);                                  // stabilized -> canvas px
  const k = view.cur;
  const f = view.session.frames[k];
  const Tk = view.T[k] || [1, 0, 0, 0, 1, 0];
  const toCanvas = compose(D, invert(Tk));                             // frame k -> canvas px
  const p = view.previews.get(k);
  const cropped = view.playing && view.crop;
  if (cropped) {
    ctx.save();
    const [x, y] = apply(D, [view.crop[0], view.crop[1]]);
    ctx.beginPath();
    ctx.rect(x, y, view.crop[2] * D[0], view.crop[3] * D[4]);
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
  if (cropped) { ctx.restore(); return; }
  if (f.track && f.track.mask) {
    const mask = f.track.mask;
    const bmp = maskBitmapNow(mask, () => view.schedule());
    if (bmp) drawMask(ctx, mask, bmp, toCanvas);
  }
  if (f.clicks) drawClicks(ctx, f.clicks.points, f.clicks.labels, toCanvas);
  drawCoverage(ctx, view.poly, D, bw, bh);
  drawCrop(ctx, view.crop, D);
}

/** Everything outside the common area, shaded. */
function drawCoverage(ctx, poly, D, bw, bh) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, bw, bh);
  if (poly.length >= 3) {
    const pts = poly.map((q) => apply(D, q));
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = pts.length - 1; i >= 1; i--) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  ctx.fillStyle = tokenColor('--scrim');
  ctx.fill('evenodd');
  ctx.restore();
}

function drawCrop(ctx, crop, D) {
  if (!crop) return;
  const pts = corners(crop).map((q) => apply(D, q));
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
