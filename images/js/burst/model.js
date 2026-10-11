/**
 * The subject model: segment a subject in an image from clicks or a box, and
 * carry it into the next image of a sequence. Every use of a segmentation
 * model goes through here, so the model can change without the tracker
 * noticing. Synchronous: it runs on the tracking worker's thread
 * (js/burst/track-worker.js), never on the page.
 *
 *   const model = openModel({ kind: 'sam', dir });       // or 'sam2', or 'key' (below)
 *   model.name                                            // 'SAM' | 'SAM 2.1' | 'Colour key'
 *   const m = model.segment(image, { points: [[x, y]], labels: [1], box: [x1, y1, x2, y2] });
 *   // m = { mask: Uint8Array(w * h) of 0/1, width, height, score }   score 0..1
 *   model.begin();                                        // a new sequence starts
 *   const n = model.track(image, { box, point, mask });  // the subject in the next image
 *   model.dispose();
 *
 * `image` is { width, height, data: RGBA bytes }: a crop around the subject
 * at the model's input size, not the whole photo, so a small bird is large
 * enough to segment well. `track`'s prompt is the previous frame's subject as
 * predicted into THIS image's coordinates: its box, the point it should be
 * at, its area in this image's pixels (to choose among proposals), and
 * (when it has one) its mask resampled here.
 *
 * Backends:
 *   'sam2'  bro.vision.loadSam2 (SAM 2.1, Hiera), when this bro has it: its
 *           tracker carries memory from frame to frame.
 *   'sam'   bro.vision.loadSam (SAM 1, ViT-B): track() prompts the new image
 *           with the predicted box and point.
 *   'key'   a colour key: the connected region of pixels near `color` under
 *           the prompt. No weights; for synthetic frames (the app's tests),
 *           where the subject is a known colour.
 */

/** The weight folders bro.models is asked for, best first. */
export const MODEL_NAMES = [
  { kind: 'sam2', name: 'sam2.1-hiera-base-plus' },
  { kind: 'sam2', name: 'sam2.1-hiera-small' },
  { kind: 'sam2', name: 'sam2.1-hiera-tiny' },
  { kind: 'sam2', name: 'sam2.1-hiera-large' },
  { kind: 'sam', name: 'sam-vit-base' },
];

/** The square side a crop is made at for the model. */
export const INPUT_SIZE = 1024;

export function openModel(opts) {
  if (opts.kind === 'key') return new KeyModel(opts);
  if (opts.kind === 'sam2') return new Sam2Model(opts);
  return new SamModel(opts);
}

/** The best mask of a SAM result, as 0/1 bytes. */
function bestMask(r) {
  if (!r || !r.masks || !r.masks.length) return null;
  const m = r.masks[r.best || 0];
  return { mask: m.data, width: r.width, height: r.height, score: Math.max(0, Math.min(1, m.iou)) };
}

/**
 * Of SAM's proposals, the one most like the subject being carried: its
 * predicted quality, weighed by how near its area is to the area expected
 * (a box prompt is ambiguous too: the bird, its breast, the bird and its
 * reflection).
 */
function likeExpected(r, expectArea) {
  if (!r || !r.masks || !r.masks.length || !(expectArea > 0)) return bestMask(r);
  let best = -1, bestScore = -1;
  r.masks.forEach((m, i) => {
    let n = 0;
    for (let j = 0; j < m.data.length; j++) if (m.data[j]) n++;
    const l = n > 0 ? Math.log(n / expectArea) : 10;
    const s = Math.max(0, m.iou) * Math.exp(-(l * l) / (2 * 0.4 * 0.4));
    if (s > bestScore) { bestScore = s; best = i; }
  });
  const m = r.masks[best];
  return { mask: m.data, width: r.width, height: r.height, score: Math.max(0, Math.min(1, m.iou)) };
}

/** A track() prompt as SAM takes it: three proposals, chosen by expected size. */
function trackPrompt({ box, point }) {
  const p = samPrompt({ box, points: point ? [point] : [], labels: [1] });
  p.multimask = true;
  return p;
}

function samPrompt({ points = [], labels = [], box = null }) {
  const p = {};
  if (points.length) { p.points = points.map(([x, y]) => [x, y]); p.labels = points.map((_, i) => (labels[i] == null ? 1 : labels[i])); }
  if (box) p.boxes = [box.slice(0, 4)];
  // One positive point is ambiguous (the bird, its head, the bird and its
  // reflection): three proposals, the best taken. More prompts say what is meant.
  p.multimask = !box && points.length === 1;
  return p;
}

class SamModel {
  constructor({ dir, device }) {
    this.kind = 'sam';
    this.name = 'SAM';
    this.sam = bro.vision.loadSam(dir, device ? { device } : {});
    this.device = this.sam.device;
  }

  segment(image, prompt) {
    this.sam.setImage(image);
    return bestMask(this.sam.segment(samPrompt(prompt)));
  }

  begin() {}

  track(image, prompt) {
    this.sam.setImage(image);
    return likeExpected(this.sam.segment(trackPrompt(prompt)), prompt.area);
  }

  dispose() { if (this.sam && this.sam.dispose) this.sam.dispose(); this.sam = null; }
}

/**
 * SAM 2.1 through bro.vision.loadSam2, when present. Its shape is read from
 * docs/vision-api.js at the time this was written; until bro has it, the
 * loader is absent and the app uses SAM 1.
 */
class Sam2Model {
  constructor({ dir, device }) {
    if (typeof bro.vision.loadSam2 !== 'function') throw new Error('this bro has no bro.vision.loadSam2');
    this.kind = 'sam2';
    this.name = 'SAM 2.1';
    this.sam = bro.vision.loadSam2(dir, device ? { device } : {});
    this.device = this.sam.device;
    this.tracker = null;
  }

  segment(image, prompt) {
    this.sam.setImage(image);
    return bestMask(this.sam.segment(samPrompt(prompt)));
  }

  begin() {
    if (this.tracker && this.tracker.dispose) this.tracker.dispose();
    this.tracker = null;
  }

  track(image, prompt) {
    // Without a tracker API, each frame is prompted afresh like SAM 1.
    this.sam.setImage(image);
    return likeExpected(this.sam.segment(trackPrompt(prompt)), prompt.area);
  }

  dispose() { this.begin(); if (this.sam && this.sam.dispose) this.sam.dispose(); this.sam = null; }
}

/** A colour key: pixels within `tolerance` of `color`, connected to the prompt. */
class KeyModel {
  constructor({ color = [255, 0, 255], tolerance = 60 }) {
    this.kind = 'key';
    this.name = 'Colour key';
    this.device = 'CPU';
    this.color = color;
    this.tol2 = tolerance * tolerance;
  }

  begin() {}

  segment(image, { points = [], labels = [], box = null }) {
    const seeds = points.filter((_, i) => labels[i] !== 0);
    const mask = this.region(image, seeds, box);
    // Negative points cut away the region connected to them.
    const negatives = points.filter((_, i) => labels[i] === 0);
    if (negatives.length) {
      const cut = this.region(image, negatives, null);
      for (let i = 0; i < mask.length; i++) if (cut[i]) mask[i] = 0;
    }
    return { mask, width: image.width, height: image.height, score: mask.some((v) => v) ? 1 : 0 };
  }

  track(image, { box, point }) {
    return this.segment(image, { points: point ? [point] : [], labels: [1], box });
  }

  dispose() {}

  /** Flood-fill the keyed pixels from the seeds (or, with none, every keyed pixel inside the box). */
  region({ width: w, height: h, data }, seeds, box) {
    const [r0, g0, b0] = this.color;
    const keyed = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const dr = data[p] - r0, dg = data[p + 1] - g0, db = data[p + 2] - b0;
      keyed[i] = dr * dr + dg * dg + db * db <= this.tol2 ? 1 : 0;
    }
    const start = [];
    for (const [x, y] of seeds) {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi >= 0 && yi >= 0 && xi < w && yi < h && keyed[yi * w + xi]) start.push(yi * w + xi);
    }
    if (!start.length && box) {
      const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
      const x1 = Math.min(w, Math.ceil(box[2])), y1 = Math.min(h, Math.ceil(box[3]));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (keyed[y * w + x]) start.push(y * w + x);
    }
    const mask = new Uint8Array(w * h);
    const stack = start.slice();
    for (const s of start) mask[s] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      const visit = (j) => { if (keyed[j] && !mask[j]) { mask[j] = 1; stack.push(j); } };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    return mask;
  }
}
