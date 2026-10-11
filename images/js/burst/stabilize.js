/**
 * From a tracked burst to the transform each frame is shown through, and
 * the crop every shown frame covers.
 *
 * Stabilized coordinates are the reference frame's own (its photo's full
 * resolution pixels). T[k] maps them into frame k: the pixel shown at q in
 * the animation is frame k's pixel at T[k](q). T[ref] is the identity.
 *
 * Two locks:
 *   'subject'  the subject's position and size are held. Each step's motion
 *              aligned on the subject's own pixels is chained (precise, but
 *              it drifts), and pulled onto the mask's centroid and size by an
 *              offset smoothed over time (absolute, but a raised wing moves a
 *              centroid): the frame-to-frame precision of the one, the
 *              absolute position of the other, without a pose change jolting
 *              it. A gap, or a frame whose subject alignment failed, starts
 *              the chain afresh from the mask. No rotation.
 *   'scene'    the surroundings are held: the scene's motion (aligned on the
 *              crop around the subject with the subject left out) is chained,
 *              so the bird moves naturally in a steady scene.
 *
 *   const T = transforms(frames, ref, 'subject');
 *   const poly = commonArea(frames, T, included);       // stabilized coordinates
 *   crop = constrainCrop(want, crop, poly);
 *
 * `frames[k]` is a tracked frame: { width, height, centroid, area, confidence,
 *   from (the index it was carried from, -1 for the root), subject, scene
 *   (2x3, frame `from` -> frame k), subjectNcc, gap }.
 */

import { IDENTITY, compose, invert, apply, corners, clipConvex, rectInConvex, centroid as polyCentroid, bounds } from './affine.js';

/** Smoothing of the subject's offset from its chained position, in frames (a Gaussian's sigma). */
export const SMOOTH_FRAMES = 2;
/** A subject alignment below this correlation does not chain. */
const MIN_SUBJECT_NCC = 0.3;

export const ASPECTS = [
  { value: 'free', label: 'Free', ratio: 0 },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:5', label: '4:5', ratio: 4 / 5 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
];

export function aspectRatio(value) {
  const a = ASPECTS.find((x) => x.value === value);
  return a ? a.ratio : 0;
}

/** The frames in the order a walk from the root reaches them (each after the one it came from). */
function walkOrder(frames, ref) {
  const order = [ref];
  const seen = new Set([ref]);
  for (let added = true; added;) {
    added = false;
    frames.forEach((f, k) => {
      if (!seen.has(k) && f && seen.has(f.from)) { order.push(k); seen.add(k); added = true; }
    });
  }
  return order;
}

/** The matrix taking stabilized coordinates into every frame, for a lock mode. */
export function transforms(frames, ref, mode) {
  return mode === 'scene' ? sceneTransforms(frames, ref) : subjectTransforms(frames, ref);
}

function sceneTransforms(frames, ref) {
  const T = frames.map(() => null);
  for (const k of walkOrder(frames, ref)) {
    const f = frames[k];
    T[k] = k === ref ? IDENTITY.slice() : compose(f.scene || IDENTITY, T[f.from]);
  }
  return fillMissing(T);
}

function subjectTransforms(frames, ref) {
  const order = walkOrder(frames, ref);
  // The chained position and size, and where each chain began.
  const chain = frames.map(() => null);
  for (const k of order) {
    const f = frames[k];
    const size = Math.sqrt(Math.max(f.area, 1));
    const restart = k === ref || f.gap || !f.subject || !(f.subjectNcc >= MIN_SUBJECT_NCC) || !chain[f.from];
    if (restart) {
      chain[k] = { p: f.centroid.slice(), s: size, run: k };
    } else {
      const c = chain[f.from];
      const m = f.subject;
      const sc = Math.sqrt(Math.abs(m[0] * m[4] - m[1] * m[3]));
      chain[k] = { p: apply(m, c.p), s: c.s * sc, run: c.run };
    }
  }
  // Within each chain, the mask's offset from the chained estimate, smoothed.
  const runs = new Map();
  for (const k of order) {
    const r = chain[k].run;
    if (!runs.has(r)) runs.set(r, []);
    runs.get(r).push(k);
  }
  const pos = frames.map(() => null);
  const size = frames.map(() => 0);
  for (const ks of runs.values()) {
    ks.sort((a, b) => a - b);
    const off = ks.map((k) => {
      const f = frames[k];
      const c = chain[k];
      return { dx: f.centroid[0] - c.p[0], dy: f.centroid[1] - c.p[1], ds: Math.log(Math.sqrt(Math.max(f.area, 1)) / c.s),
        w: Math.max(0.05, f.confidence == null ? 1 : f.confidence) };
    });
    ks.forEach((k, i) => {
      let sw = 0, dx = 0, dy = 0, ds = 0;
      ks.forEach((_, j) => {
        const g = Math.exp(-((i - j) ** 2) / (2 * SMOOTH_FRAMES * SMOOTH_FRAMES)) * off[j].w;
        sw += g; dx += g * off[j].dx; dy += g * off[j].dy; ds += g * off[j].ds;
      });
      const c = chain[k];
      pos[k] = [c.p[0] + dx / sw, c.p[1] + dy / sw];
      size[k] = c.s * Math.exp(ds / sw);
    });
  }
  const T = frames.map(() => null);
  const pr = pos[ref], sr = size[ref];
  for (const k of order) {
    const s = size[k] / sr;
    T[k] = [s, 0, pos[k][0] - s * pr[0], 0, s, pos[k][1] - s * pr[1]];
  }
  return fillMissing(T);
}

/** A frame no walk reached (nothing tracked it) shows untransformed. */
/** A frame with no subject is shown through its nearest tracked neighbour's transform (to be clicked on). */
function fillMissing(T) {
  return T.map((m, k) => {
    if (m) return m;
    for (let d = 1; d < T.length; d++) {
      if (T[k - d]) return T[k - d].slice();
      if (T[k + d]) return T[k + d].slice();
    }
    return IDENTITY.slice();
  });
}

/** Frame k's photo, in stabilized coordinates: its rectangle through T[k]'s inverse. */
export function coverage(frame, Tk) {
  const inv = invert(Tk);
  return corners([0, 0, frame.width, frame.height]).map((p) => apply(inv, p));
}

/** What every included frame covers, in stabilized coordinates (a convex polygon, maybe empty). */
export function commonArea(frames, T, included = null) {
  let poly = null;
  frames.forEach((f, k) => {
    if (!f || (included && !included[k])) return;
    const c = coverage(f, T[k]);
    poly = poly ? clipConvex(poly, c) : c;
  });
  return poly || [];
}

const lerpRect = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** The largest copy of rect, scaled about its centre (and, failing that, moved to the polygon's), inside poly. */
export function fitRect(rect, poly) {
  if (poly.length < 3) return rect;
  if (rectInConvex(rect, poly)) return rect;
  const fitAbout = (cx, cy) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const w = rect[2] * mid, h = rect[3] * mid;
      if (rectInConvex([cx - w / 2, cy - h / 2, w, h], poly)) lo = mid; else hi = mid;
    }
    return [cx - (rect[2] * lo) / 2, cy - (rect[3] * lo) / 2, rect[2] * lo, rect[3] * lo];
  };
  const own = fitAbout(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2);
  if (own[2] >= rect[2] * 0.5) return own;
  const [px, py] = polyCentroid(poly);
  const there = fitAbout(px, py);
  return there[2] > own[2] ? there : own;
}

/**
 * The crop the user asked for (`want`), kept inside the common area: as far
 * from the last good crop toward `want` as stays inside, so a drag stops at
 * the edge instead of jumping. With no good crop to start from, `want` fitted.
 */
export function constrainCrop(want, last, poly) {
  if (poly.length < 3) return want;
  if (rectInConvex(want, poly)) return want;
  if (!last || !rectInConvex(last, poly)) return fitRect(want, poly);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rectInConvex(lerpRect(last, want, mid), poly)) lo = mid; else hi = mid;
  }
  return lerpRect(last, want, lo);
}

/** A rect of an aspect (width / height; 0 keeps rect's own) about its centre, the same area. */
export function withAspect(rect, ratio) {
  if (!ratio) return rect;
  const a = rect[2] * rect[3];
  const w = Math.sqrt(a * ratio), h = w / ratio;
  return [rect[0] + rect[2] / 2 - w / 2, rect[1] + rect[3] / 2 - h / 2, w, h];
}

/**
 * The first crop: the subject in the middle, its box about three times over,
 * at the aspect, inside the common area.
 */
export function defaultCrop(refFrame, ratio, poly) {
  const [cx, cy] = refFrame.centroid;
  const b = refFrame.bbox && refFrame.bbox[2] ? refFrame.bbox : [cx - 100, cy - 100, 200, 200];
  const side = Math.max(b[2], b[3]) * 3;
  const r = ratio || b[2] / Math.max(1, b[3]) || 1;
  const w = ratio ? Math.sqrt(side * side * r) : side;
  const h = ratio ? w / r : side;
  return fitRect([cx - w / 2, cy - h / 2, w, h], poly);
}

/** The bounding box of the common area (for a view to frame it). */
export function areaBounds(poly) {
  return poly.length ? bounds(poly) : [0, 0, 0, 0];
}
