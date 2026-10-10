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

// 100%, then 400% and a pan: the full-resolution tiles on screen arrive and
// are drawn, one per frame.
const tileFrames = measureFrames((() => {
  let stage = 0, settled = 0;
  return () => {
    const m = app.viewer.model();
    if (stage === 0) { app.viewer.zoomTo(1); stage = 1; return false; }
    if (m.missingTiles > 0 || app.state.pic.tiles.size === 0) { settled = 0; return false; }
    if (++settled < 3) return false;           // drawn, a frame after the last arrived
    settled = 0;
    if (stage === 1) { app.viewer.zoomTo(4); stage = 2; return false; }
    if (stage === 2) { app.viewer.v.panX -= 3000; app.viewer.v.panY -= 2000; app.viewer.drawNow(); stage = 3; return false; }
    return true;
  };
})(), 'full-resolution tiles at 100% and 400%');
console.log(`100% and 400% of a 24 MP photo (${app.state.pic.tiles.size} tiles fetched): ${tileFrames.frames} frames, ` +
  `worst ${tileFrames.maxMs.toFixed(1)} ms, ${tileFrames.slow} over 16.7 ms`);
assert(tileFrames.maxMs < FRAME_BUDGET_MS, `fetching full resolution stays under ${FRAME_BUDGET_MS} ms (worst ${tileFrames.maxMs.toFixed(1)})`);

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
}

console.log('test_perf PASSED');
