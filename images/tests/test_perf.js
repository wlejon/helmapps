// Image Viewer stays responsive: how long the window took to show, and the
// worst frame while (1) a folder of hundreds of images fills its grid with
// previews as it is scrolled, and (2) a run of 24-megapixel photos is
// stepped through faster than they decode. docs/performance.md says how to
// read these numbers and what to do when one is over budget.
//
// IV_PERF_DIR=<folder of real photos> also steps through a real folder and
// reports, without failing on the time it takes.

import { app, waitFor, measureFrames, eq, fixtureDir } from '/lib/test.js';
import { pixels, png } from '/app/tests/images.js';

const fs = require('fs');
const path = require('path');

const FRAME_BUDGET_MS = 50;   // generous for a shared test box; a healthy frame is a few ms
// The full-resolution bitmap's upload copies beside the frames (bro's copy
// queue) and the canvas keeps the preview until it is in, so no frame of
// that step waits for it: ~6-12 ms worst. A frame that waits for the copy
// (60-130 ms on an idle GPU) fails this.
const FULL_RES_BUDGET_MS = 30;

// ---- startup ---------------------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- a folder of many images -------------------------------------------------------
let t0 = perf.now();
const tree = {};
const N = 400;
for (let i = 0; i < N; i++) tree[`shot-${String(i).padStart(3, '0')}.png`] = png(240, 160, [(i * 37) % 255, (i * 91) % 255, 120]);
const many = fixtureDir(tree);
console.log(`fixture: ${N} images in ${(perf.now() - t0).toFixed(0)} ms`);

app.openPath(many);
const cellsWithPreview = () => Array.from(document.querySelectorAll('.iv-grid .vgrid-cell'))
  .filter((c) => c.querySelector('.iv-thumb img')).length;
const gridFrames = measureFrames(() => {
  if (app.grid.items.length !== N) return false;
  // Scroll a screenful every frame until the end, then wait for that screen's previews.
  const sc = app.grid.scroller;
  if (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1) { sc.scrollTop += sc.clientHeight; return false; }
  const shown = document.querySelectorAll('.iv-grid .vgrid-cell').length;
  return shown > 0 && cellsWithPreview() === shown;
}, 'the grid scrolled to the end with previews', 60000);
console.log(`grid of ${N}: ${gridFrames.frames} frames, worst ${gridFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${gridFrames.avgMs.toFixed(1)} ms, ${gridFrames.slow} over 16.7 ms`);
assert(gridFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms filling the grid (worst ${gridFrames.maxMs.toFixed(1)})`);
eq(app.grid.items.length, N, 'one cell per image');

// ---- Find Animals over the folder: answers streaming in, the grid refiltered ------------
// The test stub stands in for the models (js/wildlife/stub.js); decoding, the
// records, the cache and regrouping the bursts are the real ones.
if (bro.vision && bro.vision.wildlife) {
  t0 = perf.now();
  app.wildlife.useStub([{ color: [200, 80, 120], tolerance: 60, label: 'a bird',
    species: [{ common: 'Northern Cardinal', scientific: 'Cardinalis cardinalis', score: 0.9 }] }]);
  const wa = app.wildlife.analysis;
  const animalFrames = measureFrames(() => wa.state === 'done' && wa.results.size === N && !wa.groupTimer,
    'Find Animals over the folder', 120000);
  console.log(`Find Animals over ${N} images: ${(perf.now() - t0).toFixed(0)} ms, ${animalFrames.frames} frames, ` +
    `worst ${animalFrames.maxMs.toFixed(1)} ms, mean ${animalFrames.avgMs.toFixed(1)} ms, ${animalFrames.slow} over 16.7 ms; ` +
    `${app.grid.items.length} with animals shown`);
  assert(animalFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while answers arrive (worst ${animalFrames.maxMs.toFixed(1)})`);
  // Opening it again: every answer from the cache in one message.
  app.openPath(path.dirname(many));
  waitFor(() => app.folder.dir === path.dirname(many), 'another folder');
  t0 = perf.now();
  app.openPath(many);
  const again = measureFrames(() => wa.dir === many && wa.state === 'done' && wa.results.size === N, 'the folder again, from the cache', 60000);
  console.log(`Find Animals from the cache: ${(perf.now() - t0).toFixed(0)} ms, worst frame ${again.maxMs.toFixed(1)} ms`);
  assert(again.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms reading the cache (worst ${again.maxMs.toFixed(1)})`);
  app.commands.run('find-animals');
}

// ---- big photos, stepped through faster than they decode ---------------------------------
t0 = perf.now();
const W = 6000, H = 4000;
const big = {};
const px = pixels(W, H, [180, 120, 60]);
for (let i = 0; i < 4; i++) big[`photo-${i}.jpg`] = bro.image.encodeJpeg(px, W, H, 4, 80);
const photos = fixtureDir(big);
console.log(`fixture: 4 photos of ${W}x${H} in ${(perf.now() - t0).toFixed(0)} ms`);

app.openPath(path.join(photos, 'photo-0.jpg'));
waitFor(() => app.folder.dir === photos && app.folder.items.length === 4, 'the photo folder listed');
let presses = 0;
const stepFrames = measureFrames(() => {
  // Press Next on every 4th frame until the fourth photo, then wait for it.
  if (presses < 3 && (app.state.pic || Math.random() < 0.25)) { app.commands.run('next'); presses++; return false; }
  return presses >= 3 && app.state.pic && app.state.pic.path === path.join(photos, 'photo-3.jpg');
}, 'stepping through the photos', 60000);
console.log(`stepping 24 MP photos: ${stepFrames.frames} frames, worst ${stepFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${stepFrames.avgMs.toFixed(1)} ms, ${stepFrames.slow} over 16.7 ms; decode ${app.state.pic.ms.toFixed(0)} ms off the page`);
assert(stepFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms stepping through big photos (worst ${stepFrames.maxMs.toFixed(1)})`);

assert(app.state.pic.partial, 'a 24 MP photo arrives as a screen-sized preview first');

// 100%, then 400% and a pan: the whole 24 MP picture arrives at full
// resolution (a transferred ImageBitmap, uploaded ahead of its draw) and is drawn.
const tileFrames = measureFrames((() => {
  let stage = 0, settled = 0;
  return () => {
    const m = app.viewer.model();
    if (stage === 0) { app.viewer.zoomTo(1); stage = 1; return false; }
    if (m.waitingFull || !app.state.pic.full) { settled = 0; return false; }
    if (++settled < 3) return false;           // drawn, a frame after the last arrived
    settled = 0;
    if (stage === 1) { app.viewer.zoomTo(4); stage = 2; return false; }
    if (stage === 2) { app.viewer.v.panX -= 3000; app.viewer.v.panY -= 2000; app.viewer.drawNow(); stage = 3; return false; }
    return true;
  };
})(), 'full resolution at 100% and 400%');
eq([app.state.pic.full.width, app.state.pic.full.height], [app.state.pic.width, app.state.pic.height], 'the full-resolution bitmap');
console.log(`100% and 400% of a 24 MP photo (full resolution in one bitmap): ${tileFrames.frames} frames, ` +
  `worst ${tileFrames.maxMs.toFixed(1)} ms, ${tileFrames.slow} over 16.7 ms`);
assert(tileFrames.maxMs < FULL_RES_BUDGET_MS, `fetching full resolution stays under ${FULL_RES_BUDGET_MS} ms (worst ${tileFrames.maxMs.toFixed(1)})`);

// Zooming and turning a 24 MP picture.
const viewFrames = measureFrames((() => {
  let n = 0;
  return () => {
    n++;
    if (n % 3 === 0) app.viewer.zoomIn(); else if (n % 3 === 1) app.viewer.rotate(90); else app.viewer.fit();
    return n >= 30;
  };
})(), 'zooming and turning');
console.log(`zoom/rotate a 24 MP picture: worst ${viewFrames.maxMs.toFixed(1)} ms, mean ${viewFrames.avgMs.toFixed(1)} ms`);
assert(viewFrames.maxMs < FRAME_BUDGET_MS, `view changes stay under ${FRAME_BUDGET_MS} ms (worst ${viewFrames.maxMs.toFixed(1)})`);

// ---- optional: a real folder -----------------------------------------------------------
const real = process.env.IV_PERF_DIR;
if (real) {
  app.openPath(real);
  waitFor(() => app.folder.dir === path.resolve(real) && app.folder.items.length, 'the real folder listed', 30000);
  const first = app.folder.items[0].path;
  app.openImage(first);
  const count = Math.min(20, app.folder.items.length);
  let k = 0;
  const f = measureFrames(() => {
    if (app.state.pic && app.state.pic.path === app.state.path) { if (++k >= count) return true; app.commands.run('next'); }
    return false;
  }, `stepping through ${real}`, 600000);
  console.log(`${real}: ${count} images; ${f.frames} frames, worst ${f.maxMs.toFixed(1)} ms, ${f.slow} over 16.7 ms`);

  // IV_PERF_ANIMALS=1: Find Animals over the real folder with the real models
  // (BRO_MODELS), timed, with the page's worst frame while it runs.
  if (process.env.IV_PERF_ANIMALS && app.wildlife.supported) {
    app.wildlife.stub = null;
    if (!app.settings.get('findAnimals')) app.commands.run('find-animals');
    app.openPath(real);
    const wa = app.wildlife.analysis;
    const t1 = Date.now();
    const fa = measureFrames(() => wa.dir === path.resolve(real) && wa.state === 'done' && !wa.groupTimer, `Find Animals over ${real}`, 3600000);
    const recs = [...wa.results.values()];
    const species = new Map();
    for (const b of wa.bursts) if (b.species) species.set(b.species.common, (species.get(b.species.common) || 0) + b.count);
    console.log(`Find Animals over ${recs.length} photos: ${((Date.now() - t1) / 1000).toFixed(1)} s, ${wa.analysed} analysed; ` +
      `worst frame ${fa.maxMs.toFixed(1)} ms, ${fa.slow} of ${fa.frames} over 16.7 ms; ${recs.filter((r) => r.animal).length} with an animal, ` +
      `${recs.filter((r) => r.error).length} errors, ${wa.bursts.length} bursts`);
    console.log(`species by photos (burst consensus): ${[...species].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}

console.log('test_perf PASSED');
