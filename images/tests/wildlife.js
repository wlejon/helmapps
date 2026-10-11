// Synthetic photos for the Find Animals tests: a plain scene with, or
// without, coloured discs standing in for animals, each JPEG dated in its
// EXIF to the hundredth of a second like a camera's. The test stub
// (js/wildlife/stub.js) finds the discs by colour, every disc an animal;
// no personal photos, no binary fixtures. Species rows carry their lineage
// (class, order, family; the genus is the scientific name's first word) so
// the names fall back to a genus, family, order or class as with the models.

import { datedJpeg } from '/app/tests/burst.js';

const bird = (order, family) => ({ class: 'Aves', order, family });

export const CARDINAL = { color: [220, 30, 40], label: 'a bird',
  species: [{ common: 'Northern Cardinal', scientific: 'Cardinalis cardinalis', score: 0.9, ...bird('Passeriformes', 'Cardinalidae') },
    { common: 'Scarlet Tanager', scientific: 'Piranga olivacea', score: 0.05, ...bird('Passeriformes', 'Cardinalidae') }] };
export const JAY = { color: [40, 90, 230], label: 'a bird',
  species: [{ common: 'Blue Jay', scientific: 'Cyanocitta cristata', score: 0.92, ...bird('Passeriformes', 'Corvidae') },
    { common: 'Eastern Bluebird', scientific: 'Sialia sialis', score: 0.05, ...bird('Passeriformes', 'Turdidae') }] };
export const SQUIRREL = { color: [150, 100, 40], label: 'a squirrel',
  species: [{ common: 'Eastern Gray Squirrel', scientific: 'Sciurus carolinensis', score: 0.88,
    class: 'Mammalia', order: 'Rodentia', family: 'Sciuridae' }] };
export const TABLE = [CARDINAL, JAY, SQUIRREL];
/** An animal no rank is sure of (0.5 + 0.3: under 0.85 even for its class): found, not identified. Not in TABLE. */
export const FROG = { color: [235, 215, 30], label: 'a frog',
  species: [{ common: 'Green Frog', scientific: 'Lithobates clamitans', score: 0.5, class: 'Amphibia', order: 'Anura', family: 'Ranidae' },
    { common: 'American Toad', scientific: 'Anaxyrus americanus', score: 0.3, class: 'Amphibia', order: 'Anura', family: 'Bufonidae' }] };

// Several animals a photo, and a name above species.
export const EGRET = { color: [245, 245, 245], label: 'a bird',
  species: [{ common: 'Great Egret', scientific: 'Ardea alba', score: 0.95, ...bird('Pelecaniformes', 'Ardeidae') }] };
export const MALLARD = { color: [20, 60, 20], label: 'a bird',
  species: [{ common: 'Mallard', scientific: 'Anas platyrhynchos', score: 0.9, ...bird('Anseriformes', 'Anatidae') },
    { common: 'American Black Duck', scientific: 'Anas rubripes', score: 0.06, ...bird('Anseriformes', 'Anatidae') }] };
/** Three darners, none sure, their family sure: "Darners (Aeshnidae)" (TAXA names it). */
export const DARNER = { color: [40, 200, 200], label: 'a dragonfly',
  species: [{ common: 'Common Green Darner', scientific: 'Anax junius', score: 0.45, class: 'Insecta', order: 'Odonata', family: 'Aeshnidae' },
    { common: 'Shadow Darner', scientific: 'Aeshna umbrosa', score: 0.3, class: 'Insecta', order: 'Odonata', family: 'Aeshnidae' },
    { common: 'Lance-tipped Darner', scientific: 'Aeshna constricta', score: 0.2, class: 'Insecta', order: 'Odonata', family: 'Aeshnidae' }] };
export const SPARROW = { color: [200, 160, 110], label: 'a bird',
  species: [{ common: 'House Sparrow', scientific: 'Passer domesticus', score: 0.93, ...bird('Passeriformes', 'Passeridae') }] };
/** The names of genera and up, as a species list's taxa map. */
export const TAXA = { Aeshnidae: { rank: 'family', common: 'Darners' }, Anatidae: { rank: 'family', common: 'Ducks' } };

/** A w x h scene (a soft green-grey gradient) with discs [{ color, at: [cx, cy], r }]. */
export function scene(w, h, discs = []) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = (x + y) / (w + h);
      let R = 90 + 40 * t, G = 120 + 30 * t, B = 90 + 20 * t;
      for (const d of discs) {
        const a = Math.max(0, Math.min(1, d.r - Math.hypot(x + 0.5 - d.at[0], y + 0.5 - d.at[1]) + 0.5));
        if (!a) continue;
        R += (d.color[0] - R) * a; G += (d.color[1] - G) * a; B += (d.color[2] - B) * a;
      }
      px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = 255;
    }
  }
  return px;
}

/**
 * A photo -> a dated JPEG: { time (s), animal (a table entry or null), at } for
 * one disc in the middle, or { time, discs: [{ animal, at: [x, y], r? }] } for several.
 */
export function photo({ time, animal = null, discs = null, w = 320, h = 240, at = null }) {
  const list = discs
    ? discs.map((d) => ({ color: d.animal.color, at: d.at, r: d.r || 20 }))
    : animal ? [{ color: animal.color, at: at || [w / 2, h / 2], r: Math.min(w, h) / 6 }] : [];
  return datedJpeg(scene(w, h, list), w, h, time, 92);
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

/** The details panel's animals: [{ name, score, meta, guess, hit, el }]. */
export function detailAnimals() {
  const text = (el, sel) => { const e = el.querySelector(sel); return e ? e.textContent : ''; };
  return Array.from(document.querySelectorAll('.iv-details .iv-animal')).map((el) => ({
    name: text(el, '.iv-animal-name'), score: text(el, '.iv-animal-score'), meta: text(el, '.iv-animal-meta'),
    guess: text(el, '.iv-animal-guess'), hit: el.classList.contains('iv-animal-hit'), dim: el.classList.contains('dim'), el,
  }));
}
