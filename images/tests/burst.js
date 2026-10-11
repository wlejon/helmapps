// Synthetic bursts for the stabilize tests: textured frames in which the
// background moves by one set of known offsets (the camera) and a subject,
// a textured magenta disc, moves by another; each frame a JPEG dated in its
// EXIF to the hundredth of a second, like a camera's burst. No personal
// photos, no binary fixtures.

import { app, waitFor, press, mod, clickEl, fixtureDir } from '/lib/test.js';

const path = require('path');

export const SUBJECT_COLOR = [235, 10, 235];
export const MARKER_COLOR = [250, 230, 20];

/** Smooth value noise in 0..1 at (x, y), from a lattice of `cell` px. */
function hash(ix, iy, seed) {
  let n = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, cell, seed) {
  const fx = x / cell, fy = y / cell;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  let tx = fx - ix, ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * One frame's RGBA: the background's texture at world (x - bg[0], y - bg[1]),
 * with the marker (a soft yellow blob, `marker` its world centre) and the
 * subject (a disc of radius r centred at `subject` in frame coordinates, its
 * texture moving with it, its edge antialiased). Both are drawn smooth so
 * their centroids are sub-pixel exact, and a 1 px test measures the
 * stabilizer rather than the fixture's pixel grid.
 */
export function framePixels(w, h, { bg, subject, r, marker = [180, 150], markerSigma = 8 }) {
  const px = new Uint8Array(w * h * 4);
  const s2 = 2 * markerSigma * markerSigma;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = x + 0.5 - bg[0], v = y + 0.5 - bg[1];
      const n = 0.55 * noise(u, v, 23, 1) + 0.3 * noise(u, v, 7, 2) + 0.15 * noise(u, v, 3, 3);
      let R = 30 + 110 * n, G = 60 + 130 * n, B = 50 + 90 * n;
      const mu = u - marker[0], mv = v - marker[1];
      const am = Math.exp(-(mu * mu + mv * mv) / s2);
      if (am > 0.002) {
        R += (MARKER_COLOR[0] - R) * am; G += (MARKER_COLOR[1] - G) * am; B += (MARKER_COLOR[2] - B) * am;
      }
      const sx = x + 0.5 - subject[0], sy = y + 0.5 - subject[1];
      const as = Math.max(0, Math.min(1, r - Math.sqrt(sx * sx + sy * sy) + 0.5));
      if (as > 0) {
        const t = noise(sx + 1000, sy + 1000, 5, 7) - 0.5;
        R += (SUBJECT_COLOR[0] + 20 * t - R) * as; G += (SUBJECT_COLOR[1] + 10 * t - G) * as; B += (SUBJECT_COLOR[2] + 20 * t - B) * as;
      }
      px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = 255;
    }
  }
  return px;
}

/** Put a little-endian TIFF into a JPEG as its EXIF (APP1) segment. */
function withExif(jpg, tiff) {
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, len >> 8, len & 255, ...payload];
  const out = new Uint8Array(jpg.length + app1.length);
  out.set(jpg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpg.subarray(2), 2 + app1.length);
  return out;
}

/** A JPEG dated `seconds` after 2026-05-01 10:00:00 in DateTimeOriginal + SubSecTimeOriginal. */
export function datedJpeg(rgba, w, h, seconds, quality = 95) {
  const jpg = bro.image.encodeJpeg(rgba, w, h, 4, quality);
  const whole = Math.floor(seconds + 1e-6);
  const cs = Math.round((seconds - whole) * 100);
  const mm = Math.floor(whole / 60), ss = whole % 60;
  const date = `2026:05:01 10:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const dt = ascii(date), sub = ascii(String(cs).padStart(2, '0'));
  const ifd0 = 8, ifd0Size = 2 + 12 + 4;
  const exif = ifd0 + ifd0Size, exifSize = 2 + 2 * 12 + 4;
  const dtAt = exif + exifSize;
  const t = new Uint8Array(dtAt + dt.length);
  const dv = new DataView(t.buffer);
  t.set([0x49, 0x49, 0x2a, 0]); dv.setUint32(4, ifd0, true);
  dv.setUint16(ifd0, 1, true);
  dv.setUint16(ifd0 + 2, 0x8769, true); dv.setUint16(ifd0 + 4, 4, true); dv.setUint32(ifd0 + 6, 1, true); dv.setUint32(ifd0 + 10, exif, true);
  dv.setUint16(exif, 2, true);
  dv.setUint16(exif + 2, 0x9003, true); dv.setUint16(exif + 4, 2, true); dv.setUint32(exif + 6, dt.length, true); dv.setUint32(exif + 10, dtAt, true);
  dv.setUint16(exif + 14, 0x9291, true); dv.setUint16(exif + 16, 2, true); dv.setUint32(exif + 18, sub.length, true);
  t.set(sub, exif + 22);                      // three bytes: inline in the value field
  t.set(dt, dtAt);
  return withExif(jpg, Array.from(t));
}

/**
 * A burst: frames[i] = { name, time, bg, subject } -> a fixture tree of
 * dated JPEGs, w x h, with a subject disc of radius r.
 */
export function burstTree(frames, { w = 960, h = 640, r = 36 } = {}) {
  const tree = {};
  for (const f of frames) tree[f.name] = datedJpeg(framePixels(w, h, { bg: f.bg, subject: f.subject, r }), w, h, f.time);
  return tree;
}

/**
 * The default synthetic burst: two bursts (0.1 s apart within, a 1.2 s gap
 * between), the camera panning (bg) and the subject flying (subject) at
 * different rates, and a jump across the gap.
 */
export function defaultBurst(n1 = 4, n2 = 4) {
  const frames = [];
  for (let k = 0; k < n1 + n2; k++) {
    const second = k >= n1;
    const j = second ? k - n1 : k;
    const time = second ? 1.5 + 0.1 * j : 0.1 * j;
    // Sub-pixel steps, so holding still to 1 px is measured, not given.
    const bg = second ? [30.6 + 3.3 * j, 18.2 - 2.6 * j] : [3.3 * j, -2.6 * j];
    const subject = second ? [520.3 + 9.2 * j, 330.7 + 4.4 * j] : [430 + 11.4 * j, 300 + 5.7 * j];
    frames.push({ name: `burst_${String(k + 1).padStart(2, '0')}.jpg`, time, bg, subject });
  }
  return frames;
}

/** Where a photo pixel is on screen, through the viewer's current view. */
export function screenOf(viewer, [x, y]) {
  const M = viewer.pictureMatrix();
  const r = viewer.el.getBoundingClientRect();
  return [r.left + M[0] * x + M[1] * y + M[2], r.top + M[3] * x + M[4] * y + M[5]];
}

/**
 * Find Animals off: the burst tests are about the burst, and must run the
 * same whether the animal models are installed or not (with them, the
 * analysis would land at a moment of its own; test_animals_hold covers the two
 * together). Call before opening the burst.
 */
export function withoutAnimals() {
  app.settings.set('findAnimals', false);
}

/** Colour-key the subject (the tests' stand-in for SAM). */
export function useKeyModel() {
  app.burst.useModel({ kind: 'key', color: SUBJECT_COLOR, tolerance: 60, name: 'key' });
}

/** Turn on Select Subject and click the subject at photo pixel p; wait for its mask. */
export function pickSubject(p) {
  if (!app.burst.picking) app.burst.togglePicking();
  advanceTime(16);
  const [x, y] = screenOf(app.viewer, p);
  click(x, y, 0);
  const n = app.burst.tool.points.length;
  waitFor(() => app.burst.subject && app.burst.subject.points.length === n, 'the subject is segmented', 30000);
  return app.burst.subject.track;
}

/** Open the stabilize view and wait until every frame is tracked and the crop is set. */
export function stabilize() {
  waitFor(() => app.burst.canStabilize(), 'a subject to stabilize');
  app.burst.openStabilize();
  waitFor(() => app.burst.active && app.burst.session.ready() && app.burst.view.crop, 'every frame tracked', 60000);
}

/**
 * The whole flow up to a tracked stabilize view: the burst's photos in a
 * fixture folder, the first opened, its subject clicked, every frame
 * selected (Shift+click the last), B. Answers { dir, frames, names }.
 */
export function openBurst(frames = defaultBurst(), size = {}) {
  const dir = fixtureDir(burstTree(frames, size));
  const names = frames.map((f) => f.name);
  withoutAnimals();
  app.openPath(path.join(dir, names[0]));
  waitFor(() => app.state.mode === 'image' && app.state.pic && app.state.pic.path.endsWith(names[0]) && !app.state.pic.placeholder,
    `${names[0]} on screen`);
  waitFor(() => app.strip.items.length === names.length, 'the strip lists the burst');
  useKeyModel();
  pickSubject(frames[0].subject);
  waitFor(() => app.strip.selection.size > 1, 'the photo\'s burst is selected');
  const last = () => Array.from(document.querySelectorAll('.iv-strip .vgrid-cell')).find((c) => c.title === names[names.length - 1]);
  waitFor(last, 'the last frame in the strip');
  clickEl(last(), 'shift');
  waitFor(() => app.strip.selection.size === names.length, 'every frame selected');
  press('b');
  waitFor(() => app.burst.active && app.burst.session.ready() && app.burst.view.crop, 'every frame tracked', 60000);
  return { dir, frames, names };
}

/** Export through the save dialog (answered with `out`) and wait for the file. */
export function exportTo(out) {
  setPickedFiles([out]);
  press(`${mod}+e`);
  waitFor(() => app.burst.view.exporting, 'the export starts');
  waitFor(() => !app.burst.view.exporting, 'the export finishes', 120000);
}

/**
 * Where the subject ('subject': how magenta a pixel is) or the marker
 * ('marker': how yellow) is in RGBA: the centroid weighted by that, and how
 * many pixels have any. The background is neither, so it weighs nothing.
 */
export function centroidOf(data, w, h, what) {
  let n = 0, sw = 0, sx = 0, sy = 0;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const v = what === 'subject' ? (r + b) / 2 - g - 40 : (r + g) / 2 - b - 40;
      if (v <= 0) continue;
      n++; sw += v; sx += v * (x + 0.5); sy += v * (y + 0.5);
    }
  }
  return n ? { n, x: sx / sw, y: sy / sw } : { n: 0, x: NaN, y: NaN };
}

export const base = (p) => path.basename(p);
