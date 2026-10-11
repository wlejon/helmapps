/**
 * Isolating an animal, the model half: SAM 2.1 (bro.vision.loadSam2)
 * segments the animal inside a box of a photo, on its own thread, so the
 * page never waits on the GPU. The page finds the weights (bro.models is
 * main-realm only) and sends their folder; the model loads on the first
 * request and stays until the page says dispose.
 *
 *   { id, op: 'segment', path, box, source, dir }
 *     -> { id, mask, width, height, rect }
 *        mask: width * height bytes, 1 where the animal is; rect: [x, y, w, h],
 *        where the mask lies in the photo's (upright, full-size) pixels
 *   { id, op: 'dispose' } -> { id }
 *   dir 'stub' (TEST ONLY): no model; the mask is the ellipse in the box.
 *
 * The photo is decoded so the square around the box (25% margin) comes out
 * near SAM's 1024 px input, then cropped to that square: a small animal is
 * as large as it can be for the model, and a 24 MP photo is never decoded
 * whole for a small one.
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
  const img = bro.image.decodeScaled(m.path, { width: long, height: long });
  if (!img.width) throw new Error(img.error || 'the photo cannot be decoded');
  const k = img.width / m.source.width;
  const box = [bx * k, by * k, bw * k, bh * k];
  const sq = wl.subjectSquare(box, img.width, img.height, { margin: MARGIN });
  if (!sq) throw new Error('an empty box');
  const crop = wl.cropImage(img, sq);
  const inCrop = [box[0] - sq.x, box[1] - sq.y, box[0] - sq.x + box[2], box[1] - sq.y + box[3]];
  let mask;
  if (m.dir === 'stub') {
    mask = new Uint8Array(sq.w * sq.h);
    const cx = (inCrop[0] + inCrop[2]) / 2, cy = (inCrop[1] + inCrop[3]) / 2;
    const rx = (inCrop[2] - inCrop[0]) / 2, ry = (inCrop[3] - inCrop[1]) / 2;
    for (let y = 0; y < sq.h; y++) {
      for (let x = 0; x < sq.w; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) mask[y * sq.w + x] = 1;
      }
    }
  } else {
    const sam2 = model(m.dir);
    sam2.setImage(crop);
    const r = sam2.segment({ box: inCrop, multimask: false });
    const best = r && r.masks && r.masks[r.best || 0];
    if (!best) throw new Error('no mask');
    mask = new Uint8Array(best.data);       // its own buffer, to transfer
    if (r.width !== sq.w || r.height !== sq.h) throw new Error(`a mask of ${r.width}x${r.height} for a ${sq.w}x${sq.h} crop`);
  }
  return { mask, width: sq.w, height: sq.h, rect: [sq.x / k, sq.y / k, sq.w / k, sq.h / k] };
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
      self.postMessage({ id: m.id });
    } else self.postMessage({ id: m.id, error: `unknown op ${m.op}` });
  } catch (err) {
    self.postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};
