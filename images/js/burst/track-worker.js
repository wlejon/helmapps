/**
 * The tracking thread: everything heavy about following a subject through a
 * burst, so the page only receives small results. It decodes the photos
 * (keeping the last few whole), crops around the subject, runs the subject
 * model (js/burst/model.js) and bro.image.alignSimilarity.
 *
 *   { id, op: 'init', model: { kind, dir?, color?, tolerance? } }  -> { id, name, kind, device }
 *   { id, op: 'info', paths }            -> { id, info: [{ width, height, dateTaken }] }   (an error per path as { error })
 *   { id, op: 'segment', path, points, labels, rect? }              -> { id, frame }
 *       points in full coordinates; rect the crop to segment on (default
 *       around the points); answers the subject in that photo
 *   { id, op: 'step', from, to, prev, gap, lastSubject, lastScene } -> { id, frame }
 *       the subject of photo `from` (prev, a frame from segment/step) carried
 *       into photo `to`; lastSubject / lastScene the previous step's motions
 *       in this direction (full-coordinate matrices), or null at the start
 *       of a run and across a gap
 *   any may answer { id, error }
 *
 * A frame is { path, mask: { rect, size, data }, area, centroid, bbox,
 *   score, confidence, subject, scene, subjectNcc, sceneNcc, ms }: subject
 *   and scene are the 2x3 matrices taking `from`'s full coordinates to
 *   `to`'s (null for a seed), the subject's motion aligned on its own pixels
 *   and the scene's on everything around it. All coordinates are the photo's
 *   upright full resolution.
 *
 * Why a crop that follows the subject: a 300 px bird in a 6000 px photo is
 * 50 px if the model sees the whole photo at its 1024 px input; a crop 3-4x
 * the bird's size, made from the full resolution, shows it at ~300 px.
 */

import { openModel, INPUT_SIZE } from './model.js';
import { FrameCache, photoInfo, squareAround, cropResize, maskInto, dilate, measureMask, shrinkMask, keepMain } from './frames.js';
import { apply, bounds, mapRect, cropToFull, fullToCrop, scaleOf, rotationOf } from './affine.js';

/** The side a stored mask is kept at. */
const MASK_SIZE = 256;
/** Subject alignment: crop side in px, and the crop's size as a multiple of the subject's. */
const SUBJECT_ALIGN_PX = 512;
const SUBJECT_ALIGN_K = 4;
/** Scene alignment: 800 px crops of at least 1600 px of photo around the subject. */
const SCENE_ALIGN_PX = 800;
const SCENE_MIN_SIDE = 1600;
/** The model's crop, as a multiple of the subject's size. */
const SEGMENT_K = 3.5;

const cache = new FrameCache(3);
let model = null;

const now = () => (typeof perf !== 'undefined' && perf.now ? perf.now() : Date.now());

function ensureModel() {
  if (!model) throw new Error('the subject model is not loaded');
  return model;
}

/** Points [x, y] (full) into a crop's coordinates at size n. */
const toCrop = (rect, n) => ([x, y]) => [(x - rect[0]) * n / rect[2], (y - rect[1]) * n / rect[3]];

/** The model on the crop `rect` of `img`; the mask measured in full coordinates. */
function runModel(img, rect, fn) {
  const n = INPUT_SIZE;
  const image = { width: n, height: n, data: cropResize(img, rect, n, n) };
  const m = fn(image, toCrop(rect, n));
  if (!m || !m.mask) return { rect, ...measureMask(new Uint8Array(n * n), n, n, rect), mask: null, score: 0 };
  return { rect, ...measureMask(m.mask, m.width, m.height, rect), mask: m, score: m.score };
}

function frameOf(path, r) {
  return {
    path,
    mask: r.mask ? { rect: r.rect, size: MASK_SIZE, data: shrinkMask(r.mask.mask, r.mask.width, r.mask.height, MASK_SIZE) } : null,
    area: r.area, centroid: r.centroid, bbox: r.bbox, score: r.score,
  };
}

/** A sensible first crop around clicks with no size known: a fifth of the photo's short side. */
function seedRect(img, points, rect) {
  if (rect) return rect.map(Math.round);
  const b = bounds(points);
  const side = Math.max(Math.min(img.width, img.height) / 5, b[2] * 2, b[3] * 2, 256);
  return squareAround(b[0] + b[2] / 2, b[1] + b[3] / 2, side, img.width, img.height);
}

function segment({ path, points, labels, rect }) {
  const t0 = now();
  const img = cache.get(path);
  const m = ensureModel();
  let crop = seedRect(img, points, rect);
  const run = (r, extraBox) => runModel(img, r, (image, map) => m.segment(image, {
    points: points.map(map), labels, box: extraBox ? [...map([extraBox[0], extraBox[1]]), ...map([extraBox[0] + extraBox[2], extraBox[1] + extraBox[3]])] : null,
  }));
  let r = run(crop, null);
  // The crop was not the right size for what was found: again, 3.5x the subject.
  const side = Math.max(r.bbox[2], r.bbox[3]);
  if (!rect && r.area > 0 && (r.touches || side < crop[2] / 6 || side > crop[2] / 2)) {
    const grown = Math.max(side * SEGMENT_K, 256);
    crop = squareAround(r.bbox[0] + r.bbox[2] / 2, r.bbox[1] + r.bbox[3] / 2, grown, img.width, img.height);
    r = run(crop, r.touches ? null : pad(r.bbox, 0.1));
  }
  const f = frameOf(path, r);
  return { ...f, confidence: r.area > 0 ? r.score : 0, subject: null, scene: null, seed: true, ms: now() - t0 };
}

/** A box grown by a fraction of its size on every side. */
function pad([x, y, w, h], k) {
  return [x - w * k, y - h * k, w * (1 + 2 * k), h * (1 + 2 * k)];
}

/** The init for alignSimilarity from a full-coordinate matrix, in the crop's own terms. */
function initFrom(mFull, rect, n) {
  if (!mFull) return undefined;
  const m = fullToCrop(mFull, rect, n, n);
  const c = n / 2;
  const [x, y] = apply(m, [c, c]);
  return { scale: scaleOf(m), rotation: rotationOf(m), tx: x - c, ty: y - c };
}

/** Align crop `rect` of a onto b under mask; the motion a -> b in full coordinates. */
function align(a, b, rect, n, mask, init, search) {
  const ref = cropResize(a, rect, n, n);
  const mov = cropResize(b, rect, n, n);
  const r = bro.image.alignSimilarity(ref, mov, { width: n, height: n, mask, init: initFrom(init, rect, n), search });
  return { matrix: cropToFull(r.matrix, rect, n, n), ncc: r.ncc, converged: r.converged, coverage: r.coverage };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function step({ from, to, prev, gap, lastSubject, lastScene }) {
  const t0 = now();
  const m = ensureModel();
  const a = cache.get(from);
  const b = cache.get(to);
  if (!prev || !prev.mask || !(prev.area > 0)) throw new Error('nothing to carry: the previous frame has no subject');
  const size = Math.sqrt(prev.area);
  const [cx, cy] = prev.centroid;
  const short = Math.min(b.width, b.height);

  // The scene around the subject, the subject left out (grown, so a wing's edge
  // is not counted as scenery). Across a gap the photographer reframed: a
  // wider crop and a wider search, from no motion.
  const sceneSide = Math.min(short, Math.max(SCENE_MIN_SIDE, size * (gap ? 10 : 5.3)));
  const S = squareAround(cx, cy, sceneSide, a.width, a.height);
  const subjS = dilate(maskInto(prev.mask, S, SCENE_ALIGN_PX, SCENE_ALIGN_PX), SCENE_ALIGN_PX, SCENE_ALIGN_PX,
    Math.round(0.3 * size * SCENE_ALIGN_PX / S[2]));
  for (let i = 0; i < subjS.length; i++) subjS[i] = subjS[i] ? 0 : 255;
  const scene = align(a, b, S, SCENE_ALIGN_PX, subjS, gap ? null : lastScene, gap ? 10 : 6);

  // The subject on its own pixels, within a burst. Across a gap it moved
  // anywhere: it is predicted to have stayed put in the scene.
  let subject = null;
  if (!gap) {
    const R = squareAround(cx, cy, Math.min(short, Math.max(256, size * SUBJECT_ALIGN_K)), a.width, a.height);
    const maskR = maskInto(prev.mask, R, SUBJECT_ALIGN_PX, SUBJECT_ALIGN_PX);
    subject = align(a, b, R, SUBJECT_ALIGN_PX, maskR, lastSubject || lastScene || null, 4);
  }
  const predict = subject && subject.ncc > 0.3 ? subject.matrix : scene.matrix;

  // The model on a crop of `to` around where the subject should be.
  const pc = apply(predict, prev.centroid);
  const box = bounds(mapRect(predict, prev.bbox));
  const Q = squareAround(pc[0], pc[1], Math.min(short, Math.max(256, SEGMENT_K * Math.max(box[2], box[3]))), b.width, b.height);
  const prompt = pad(box, 0.1);
  const k = INPUT_SIZE / Q[2];
  const r = runModel(b, Q, (image, map) => {
    const t = m.track(image, {
      box: [...map([prompt[0], prompt[1]]), ...map([prompt[0] + prompt[2], prompt[1] + prompt[3]])],
      point: map(pc),
      area: prev.area * scaleOf(predict) ** 2 * k * k,
      mask: null,
    });
    return t && t.mask ? { ...t, mask: keepMain(t.mask, t.width, t.height) } : t;
  });

  // How far to trust it: the model's own score, whether the size held, and
  // whether it is where the motion said.
  let confidence = 0;
  if (r.area > 0) {
    const ratio = Math.log(r.area / prev.area);
    const fa = Math.exp(-(ratio * ratio) / (2 * 0.5 * 0.5));
    const d = Math.hypot(r.centroid[0] - pc[0], r.centroid[1] - pc[1]) / size;
    const sd = gap ? 1.0 : 0.5;
    const fd = Math.exp(-(d * d) / (2 * sd * sd));
    const fn = gap ? clamp01(0.5 + scene.ncc / 2) : clamp01(0.5 + (subject ? subject.ncc : 0) / 2);
    confidence = clamp01(r.score) * fa * fd * fn;
  }
  return {
    ...frameOf(to, r), confidence, seed: false,
    subject: subject ? subject.matrix : null, scene: scene.matrix,
    subjectNcc: subject ? subject.ncc : null, sceneNcc: scene.ncc, ms: now() - t0,
  };
}

function transferables(frame) {
  return frame && frame.mask ? [frame.mask.data.buffer] : [];
}

self.onmessage = (e) => {
  const msg = e.data || {};
  const { id, op } = msg;
  try {
    if (op === 'init') {
      if (model) model.dispose();
      model = null;
      model = openModel(msg.model);
      self.postMessage({ id, name: model.name, kind: model.kind, device: model.device });
    } else if (op === 'info') {
      const info = msg.paths.map((p) => { try { return photoInfo(p); } catch (err) { return { error: err.message }; } });
      self.postMessage({ id, info });
    } else if (op === 'segment') {
      const frame = segment(msg);
      self.postMessage({ id, frame }, transferables(frame));
    } else if (op === 'step') {
      if (msg.begin) ensureModel().begin();
      const frame = step(msg);
      self.postMessage({ id, frame }, transferables(frame));
    } else if (op === 'forget') {
      cache.clear();
      self.postMessage({ id });
    } else {
      throw new Error(`unknown op ${op}`);
    }
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
};
