// Synthetic photos for the Find Animals tests: a plain scene with, or
// without, a coloured disc standing in for an animal, each JPEG dated in its
// EXIF to the hundredth of a second like a camera's. The test stub
// (js/wildlife/stub.js) finds the discs by colour; no personal photos, no
// binary fixtures.

import { datedJpeg } from '/app/tests/burst.js';

export const CARDINAL = { color: [220, 30, 40], label: 'a bird',
  species: [{ common: 'Northern Cardinal', scientific: 'Cardinalis cardinalis', score: 0.9 },
    { common: 'Scarlet Tanager', scientific: 'Piranga olivacea', score: 0.05 }] };
export const JAY = { color: [40, 90, 230], label: 'a bird',
  species: [{ common: 'Blue Jay', scientific: 'Cyanocitta cristata', score: 0.8 },
    { common: 'Eastern Bluebird', scientific: 'Sialia sialis', score: 0.1 }] };
export const SQUIRREL = { color: [150, 100, 40], label: 'a squirrel',
  species: [{ common: 'Eastern Gray Squirrel', scientific: 'Sciurus carolinensis', score: 0.7 }] };
export const TABLE = [CARDINAL, JAY, SQUIRREL];

/** A w x h scene (a soft green-grey gradient) with a disc of `color` at (cx, cy), or none. */
export function scene(w, h, color = null, cx = w / 2, cy = h / 2, r = Math.min(w, h) / 6) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (x + y) / (w + h);
      let R = 90 + 40 * t, G = 120 + 30 * t, B = 90 + 20 * t;
      if (color) {
        const a = Math.max(0, Math.min(1, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
        R += (color[0] - R) * a; G += (color[1] - G) * a; B += (color[2] - B) * a;
      }
      px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = 255;
    }
  }
  return px;
}

/** A photo: { name, time (s), animal (a TABLE entry or null) } -> a dated JPEG. */
export function photo({ time, animal, w = 320, h = 240, at = null }) {
  const [cx, cy] = at || [w / 2, h / 2];
  return datedJpeg(scene(w, h, animal ? animal.color : null, cx, cy), w, h, time, 92);
}

/**
 * The folder the tests open (times in seconds):
 *   a_01-03  a cardinal burst, 0.1 s apart; in a_02 the bird has flown (no disc)
 *   b_01     a jay, alone
 *   c_01-02  a jay again, 0.5 s apart: one burst by groupBursts' 1.0 s gap
 *   d_01     a squirrel
 *   e_01-02  nothing, seconds apart
 */
export const SHOTS = [
  { name: 'a_01.jpg', time: 0.0, animal: CARDINAL },
  { name: 'a_02.jpg', time: 0.1, animal: null },
  { name: 'a_03.jpg', time: 0.2, animal: CARDINAL },
  { name: 'b_01.jpg', time: 5.0, animal: JAY },
  { name: 'c_01.jpg', time: 10.0, animal: JAY },
  { name: 'c_02.jpg', time: 10.5, animal: JAY },
  { name: 'd_01.jpg', time: 15.0, animal: SQUIRREL },
  { name: 'e_01.jpg', time: 20.0, animal: null },
  { name: 'e_02.jpg', time: 30.0, animal: null },
];

export function shotsTree(shots = SHOTS) {
  const tree = {};
  for (const s of shots) tree[s.name] = photo(s);
  return tree;
}

/** The stub's table as useStub takes it (colours and species only). */
export function stubTable(entries = TABLE) {
  return entries.map((e) => ({ color: e.color, tolerance: 40, label: e.label, species: e.species }));
}

/** Wait until Find Animals has answered every photo of the folder on screen. */
export function analysed(app, waitFor, what = 'every photo analysed', ms = 30000) {
  const a = app.wildlife.analysis;
  waitFor(() => a.state === 'done' && a.total > 0 && a.results.size === a.total && !a.groupTimer, what, ms);
}

export const names = (items) => items.map((it) => require('path').basename(it.path));
