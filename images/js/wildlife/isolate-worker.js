/**
 * Isolating an animal, the model half: SAM 2.1 (bro.vision.loadSam2)
 * segments the animal inside a box of a photo, on its own thread, so the
 * page never waits on the GPU. The page finds the weights (bro.models is
 * main-realm only) and sends their folder; the model loads on the first
 * request and stays until the page says dispose.
 *
 *   { id, op: 'segment', path, box, source, dir }
 *     -> { id, mask, width, height, rect, ms }
 *        mask: width * height alpha bytes, 255 where the animal surely is,
 *        soft at its edge; rect: [x, y, w, h], where the mask lies in the
 *        photo's (upright, full-size) pixels; ms: { decode, model, mask }
 *        where the time went (model includes loading it on the first)
 *   { id, op: 'dispose' } -> { id }
 *   dir 'stub' (TEST ONLY): no model; the mask is the ellipse in the box.
 *
 * The photo is decoded so the square around the box (25% margin) comes out
 * near SAM's 1024 px input, then cropped to that square: a small animal is
 * as large as it can be for the model, and a 24 MP photo is never decoded
 * whole for a small one.
 *
 * Of SAM's proposals the one kept scores best on predicted IoU times its
 * share inside the box (pick()); its edge is the logits' sigmoid
 * (alphaOf()). On halo (Vulkan) the tiny model loads in ~0.5 s and a mask
 * takes ~60 ms (encode and both decodes). BiRefNet (bro.vision.loadBirefnet)
 * was tried in its place: finer fur strands, but ~1 s a crop at 1024 px
 * (~0.3 s at 512), and it cuts out the crop's most salient object, which in
 * a quarter of the crops tried was another animal or a rock; the soft SAM
 * edge was most of its gain.
 */

const INPUT = 1024;
const MARGIN = 0.25;

let sam = null;           // { dir, model }

function model(dir) {
  if (sam && sam.dir === dir) return sam.model;
  if (sam && sam.model.dispose) sam.model.dispose();
  sam = null;
  if (typeof bro.vision.loadSam2 !== 'function') throw new Error('this bro has no bro.vision.loadSam2');
  sam = { dir, model: bro.vision.loadSam2(dir) };
  return sam.model;
}

function segment(m) {
  const wl = bro.vision.wildlife;
  const [bx, by, bw, bh] = m.box;
  const srcLong = Math.max(m.source.width, m.source.height);
  const side = Math.max(bw, bh) * (1 + 2 * MARGIN);
  const long = Math.max(64, Math.round(srcLong * Math.min(1, INPUT / side)));
  const t0 = Date.now();
  const ms = { decode: 0, model: 0, mask: 0 };
  const img = decoded(m.path, long);
  const k = img.width / m.source.width;
  const box = [bx * k, by * k, bw * k, bh * k];
  const sq = wl.subjectSquare(box, img.width, img.height, { margin: MARGIN });
  if (!sq) throw new Error('an empty box');
  let crop = wl.cropImage(img, sq);
  // A decode kept from a box before is larger than this one needs: the crop down to the size it wants.
  const s = Math.min(1, long / Math.max(img.width, img.height));
  if (s < 0.95) crop = resized(crop, Math.max(1, Math.round(sq.w * s)), Math.max(1, Math.round(sq.h * s)));
  const cw = crop.width, ch = crop.height;
  const sx = cw / sq.w, sy = ch / sq.h;
  const inCrop = [(box[0] - sq.x) * sx, (box[1] - sq.y) * sy, (box[0] - sq.x + box[2]) * sx, (box[1] - sq.y + box[3]) * sy];
  let mask;
  if (m.dir === 'stub') {
    mask = new Uint8Array(cw * ch);
    const cx = (inCrop[0] + inCrop[2]) / 2, cy = (inCrop[1] + inCrop[3]) / 2;
    const rx = (inCrop[2] - inCrop[0]) / 2, ry = (inCrop[3] - inCrop[1]) / 2;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) mask[y * cw + x] = 255;
      }
    }
  } else {
    ms.decode = Date.now() - t0;
    const sam2 = model(m.dir);
    sam2.setImage(crop);
    const single = sam2.segment({ box: inCrop, multimask: false });
    const multi = sam2.segment({ box: inCrop, multimask: true });
    for (const r of [single, multi]) {
      if (r.width !== cw || r.height !== ch) throw new Error(`a mask of ${r.width}x${r.height} for a ${cw}x${ch} crop`);
    }
    const best = pick([single.masks[single.best || 0], ...multi.masks].filter(Boolean), inCrop, cw, ch);
    if (!best) throw new Error('no mask');
    ms.model = Date.now() - t0 - ms.decode;
    mask = alphaOf(best, cw, ch);
    ms.mask = Date.now() - t0 - ms.decode - ms.model;
  }
  return { mask, width: cw, height: ch, rect: [sq.x / k, sq.y / k, sq.w / k, sq.h / k], ms };
}

/** The photo decoded with its long side near `long`: the last decode when it is that photo and big enough (not 3x). */
let lastDecode = null;    // { path, img } (img.long: the long side asked for)
function decoded(p, long) {
  const c = lastDecode;
  if (c && c.path === p && c.img.long >= long && c.img.long <= 3 * long) return c.img;
  const img = bro.image.decodeScaled(p, { width: long, height: long });
  if (!img.width) throw new Error(img.error || 'the photo cannot be decoded');
  img.long = long;
  lastDecode = { path: p, img };
  return img;
}

function resized(img, w, h) {
  const out = new Uint8Array(w * h * 4);
  bro.image.resizeU8(out, img.data, { srcW: img.width, srcH: img.height, dstW: w, dstH: h, channels: 4, filter: 'area' });
  return { width: w, height: h, data: out };
}

/** A mask covering less than this share of its box is a part (a head, a wing), not the animal. */
const MIN_COVER = 0.05;
/** The box grown by this share of its size on each side still counts as inside it. */
const INSIDE_GROW = 0.1;
/** A piece of the mask smaller than this share of its largest piece is a stray blob. */
const MIN_PIECE = 0.1;

/**
 * SAM's proposals (its single mask and its three) scored by predicted IoU
 * times the share of the mask inside the box (grown 10%): the animal, not
 * the animal and the bank it stands on, nor its head alone.
 */
function pick(masks, b, w, h) {
  const gx = INSIDE_GROW * (b[2] - b[0]), gy = INSIDE_GROW * (b[3] - b[1]);
  const x0 = b[0] - gx, x1 = b[2] + gx, y0 = b[1] - gy, y1 = b[3] + gy;
  const boxArea = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
  let best = null, bestScore = -1;
  for (const m of masks) {
    if (!m.box) continue;        // empty
    let all = 0, inside = 0;
    const d = m.data;
    for (let y = m.box[1]; y < m.box[3]; y++) {
      const row = y * w, inY = y >= y0 && y < y1;
      for (let x = m.box[0]; x < m.box[2]; x++) {
        if (!d[row + x]) continue;
        all++;
        if (inY && x >= x0 && x < x1) inside++;
      }
    }
    const score = all / boxArea < MIN_COVER ? 0 : (m.iou || 0) * (inside / all);
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return best;
}

/**
 * The mask as alpha bytes: SAM's logits through a sigmoid, so the edge is
 * as soft as the model is unsure (fur, a tail's tip) rather than a stair
 * of the threshold; stray pieces of the mask (bits of the background the
 * size of a leaf) are dropped, keeping a few pixels around what stays so
 * its soft edge survives.
 */
function alphaOf(m, w, h) {
  const out = new Uint8Array(w * h);
  if (!m.box) return out;
  // Only the mask's bounds (grown by the margin kept around it) need work.
  const r = Math.max(3, Math.round(0.015 * Math.max(w, h)));
  const x0 = Math.max(0, m.box[0] - r), y0 = Math.max(0, m.box[1] - r);
  const sw = Math.min(w, m.box[2] + r) - x0, sh = Math.min(h, m.box[3] + r) - y0;
  const sub = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) sub.set(m.data.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + sw), y * sw);
  const near = dilate(mainPieces(sub, sw, sh), sw, sh, r);
  const lg = m.logits;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (!near[y * sw + x]) continue;
      const i = (y0 + y) * w + x0 + x;
      if (!lg) { out[i] = m.data[i] ? 255 : 0; continue; }
      const v = lg[i];
      out[i] = v >= 8 ? 255 : v <= -8 ? 0 : Math.round(255 / (1 + Math.exp(-v)));
    }
  }
  return out;
}

/** The mask's 4-connected pieces at least MIN_PIECE of the largest, as 0/1. */
function mainPieces(d, w, h) {
  const label = new Int32Array(w * h);
  const sizes = [0];
  const stack = new Int32Array(w * h);
  for (let i = 0; i < d.length; i++) {
    if (!d[i] || label[i]) continue;
    const id = sizes.length;
    let n = 0, top = 0;
    label[i] = id;
    stack[top++] = i;
    while (top) {
      const p = stack[--top];
      n++;
      const x = p % w;
      if (x > 0 && d[p - 1] && !label[p - 1]) { label[p - 1] = id; stack[top++] = p - 1; }
      if (x < w - 1 && d[p + 1] && !label[p + 1]) { label[p + 1] = id; stack[top++] = p + 1; }
      if (p >= w && d[p - w] && !label[p - w]) { label[p - w] = id; stack[top++] = p - w; }
      if (p + w < d.length && d[p + w] && !label[p + w]) { label[p + w] = id; stack[top++] = p + w; }
    }
    sizes.push(n);
  }
  let largest = 0;
  for (const s of sizes) if (s > largest) largest = s;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (label[i] && sizes[label[i]] >= MIN_PIECE * largest) out[i] = 1;
  return out;
}

const FAR = 1 << 30;
/** 0/1 grown by r pixels (a square window: separable max, two passes a direction). */
function dilate(bin, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -FAR;
    for (let x = 0; x < w; x++) { if (bin[row + x]) last = x; if (x - last <= r) tmp[row + x] = 1; }
    last = FAR;
    for (let x = w - 1; x >= 0; x--) { if (bin[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -FAR;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
    last = FAR;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}

self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.op === 'segment') {
      const r = segment(m);
      self.postMessage({ id: m.id, ...r }, [r.mask.buffer]);
    } else if (m.op === 'dispose') {
      if (sam && sam.model.dispose) sam.model.dispose();
      sam = null;
      lastDecode = null;
      self.postMessage({ id: m.id });
    } else self.postMessage({ id: m.id, error: `unknown op ${m.op}` });
  } catch (err) {
    self.postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};
