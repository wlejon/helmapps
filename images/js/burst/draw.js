/**
 * Drawing helpers shared by the subject tool and the stabilize view: a
 * subject's mask laid over a picture, the click marks, and colours read from
 * the kit's tokens (a canvas cannot take var(--accent), so it is resolved
 * through an element once).
 *
 *   const bmp = await maskBitmap(track.mask);           // cached on the mask
 *   drawMask(ctx, track.mask, bmp, M);                   // M: full coordinates -> canvas px
 *   const accent = tokenColor('--accent');               // 'rgb(…)'
 */

import { compose, translate, scaling } from './affine.js';

const colors = new Map();

/** A kit token's colour as the engine resolves it ('rgb(r, g, b)'). */
export function tokenColor(token) {
  if (colors.has(token)) return colors.get(token);
  const el = document.createElement('div');
  el.style.color = `var(${token})`;
  el.style.display = 'none';
  document.body.appendChild(el);
  const c = getComputedStyle(el).color || 'rgb(80, 140, 255)';
  el.remove();
  colors.set(token, c);
  return c;
}

function rgbOf(css) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [80, 140, 255];
}

/** Masks' bitmaps, beside the masks (a mask goes to the tracking worker, so it holds only data). */
const bitmaps = new WeakMap();

/** The mask as a translucent accent ImageBitmap (made once per mask). */
export function maskBitmap(mask) {
  if (!mask) return Promise.resolve(null);
  if (bitmaps.has(mask)) return bitmaps.get(mask);
  const [r, g, b] = rgbOf(tokenColor('--accent'));
  const n = mask.size * mask.size;
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (!mask.data[i]) continue;
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 120;
  }
  const p = createImageBitmap(new ImageData(rgba, mask.size, mask.size));
  bitmaps.set(mask, p);
  p.then((b) => ready.set(mask, b), () => {});
  return p;
}

const ready = new WeakMap();

/** The mask's bitmap if it is made, else null (and it is being made: `then` runs when it is). */
export function maskBitmapNow(mask, then) {
  if (!mask) return null;
  const b = ready.get(mask);
  if (b) return b;
  maskBitmap(mask).then(() => { if (then) then(); });
  return null;
}

/** Draw a mask's bitmap where its rect is, through M (full coordinates -> canvas px). */
export function drawMask(ctx, mask, bitmap, M) {
  if (!mask || !bitmap) return;
  const [x, y, w, h] = mask.rect;
  const m = compose(M, compose(translate(x, y), scaling(w / mask.size, h / mask.size)));
  ctx.save();
  ctx.setTransform(m[0], m[3], m[1], m[4], m[2], m[5]);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bitmap, 0, 0, mask.size, mask.size);
  ctx.restore();
}

/** Click marks: a filled dot for an added area, a ring for a removed one, at canvas points. */
export function drawClicks(ctx, points, labels, M) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const accent = tokenColor('--accent');
  const ink = tokenColor('--t1');
  points.forEach(([px, py], i) => {
    const x = M[0] * px + M[1] * py + M[2], y = M[3] * px + M[4] * py + M[5];
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    if (labels[i] === 0) ctx.stroke();
    else { ctx.fillStyle = accent; ctx.fill(); ctx.stroke(); }
  });
  ctx.restore();
}
