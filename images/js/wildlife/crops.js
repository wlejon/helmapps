/**
 * A photo's animals one at a time: the crops the identifier classified
 * (record.animals, each a detector box), which of them a name covers, which
 * are uncertain, how many of what the detector found ("3 birds, 1 dog"),
 * and the box arithmetic her per-animal answers use (an answer's animal
 * holds the boxes she named; a box in a burst's other frame is the same
 * animal when it overlaps enough).
 */

import { plural, suggestionsOf } from './labels.js';
import { animalKey } from './mine.js';
import { formatNumber } from '/lib/format.js';

/** Boxes overlapping this much (intersection over union) are the same animal in two frames of a burst. */
export const IOU_MIN = 0.3;

/** Intersection over union of two [x, y, w, h] boxes. */
export function iou(a, b) {
  if (!a || !b) return 0;
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** The same box, as records round them (0.1 px). */
export function sameBox(a, b) {
  return !!a && !!b && a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) < 0.06);
}

/** The box of `boxes` overlapping `box` most, at IOU_MIN or more, or null. */
export function bestMatch(box, boxes, min = IOU_MIN) {
  let best = null, score = min;
  for (const b of boxes) {
    const s = iou(box, b);
    if (s >= score) { best = b; score = s; }
  }
  return best;
}

/**
 * The record's classified crops: [{ i (its index in record.animals), box,
 * query, species (top K), queryTop (its suggestions; null in an older
 * record), sure (a name of its own at the threshold) }].
 */
export function cropList(rec, taxa = {}) {
  if (!rec || rec.error || !rec.animal || !Array.isArray(rec.animals)) return [];
  const wl = bro.vision.wildlife;
  const out = [];
  rec.animals.forEach((a, i) => {
    if (!a || !a.box || !a.species || !a.species.length) return;
    out.push({ i, box: a.box, query: a.label || '', species: a.species, queryTop: a.queryTop || null,
      sure: wl.labels({ animal: true, animals: [a] }, null, { taxa }).length > 0 });
  });
  return out;
}

/** The label of `labels` whose boxes hold `box`, or null. */
export function labelOfBox(labels, box) {
  return labels.find((l) => (l.boxes || []).some((b) => sameBox(b, box))) || null;
}

/** Whether a box is one she said is not an animal. */
export function notAnimalBox(answer, box) {
  return !!answer && Array.isArray(answer.notAnimal) && answer.notAnimal.some((b) => sameBox(b, box));
}

/**
 * The crops no name covers: under the threshold and named by nothing shown
 * (`labels`: the photo's shown names, with their boxes). [] when she has
 * answered the photo: her answer is the last word.
 */
export function uncertainCrops(rec, labels, taxa, mine) {
  if (mine) return [];
  return cropList(rec, taxa).filter((c) => !c.sure && !labelOfBox(labels, c.box));
}

/** The best guess for an uncertain crop: its top suggestion ('Blue Jay'; labels.js suggestionsOf), or ''. */
export function guessOf(crop) {
  const s = suggestionsOf(crop, 1)[0];
  return s ? s.common || s.scientific : '';
}

/** That guess's score, or 0. */
export function guessScore(crop) {
  const s = suggestionsOf(crop, 1)[0];
  return s ? s.score : 0;
}

/** What the detector found, counted by query: "3 birds, 1 dog" ('' for nothing). */
export function countsText(rec) {
  if (!rec || rec.error || !rec.detections || !rec.detections.length) return '';
  const by = new Map();
  for (const d of rec.detections) by.set(d.label, (by.get(d.label) || 0) + 1);
  return [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([q, n]) => `${formatNumber(n)} ${plural(q, n)}`).join(', ');
}

// ---- her per-animal answers: boxes on her animals -------------------------------------

/** Her animals without `box`: an animal she named by boxes alone goes with its last one. */
export function detachBox(animals, box) {
  const out = [];
  for (const a of animals) {
    if (!a.boxes || !a.boxes.length) { out.push(a); continue; }
    const boxes = a.boxes.filter((b) => !sameBox(b, box));
    if (boxes.length === a.boxes.length) out.push(a);
    else if (boxes.length) out.push({ ...a, boxes });
  }
  return out;
}

/** Her animals with `box` named `animal` (taken from whatever held it; joined to the same name if she has it). */
export function nameBox(animals, box, animal) {
  const k = animalKey(animal);
  const { boxes: _ignored, ...plain } = animal;
  // The box alone under another name: that name becomes this one, where it was.
  const held = animals.findIndex((a) => (a.boxes || []).length === 1 && sameBox(a.boxes[0], box));
  if (held >= 0 && !animals.some((a, j) => j !== held && animalKey(a) === k)) {
    const out = animals.slice();
    out[held] = { ...plain, boxes: [box] };
    return out;
  }
  const out = detachBox(animals, box);
  const at = out.findIndex((a) => animalKey(a) === k);
  if (at >= 0) out[at] = { ...out[at], boxes: [...(out[at].boxes || []), box] };
  else out.push({ ...plain, boxes: [box] });
  return out;
}
