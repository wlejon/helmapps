// Every frame's picture in the stabilize view's timeline is painted, however
// many frames the burst has: a 120-frame burst at the window size the bug was
// seen at (2000x1080), every cell's picture checked in the frame the windowed
// loop presented (pixels, not the DOM), along the timeline to the end and
// back. Cells are recycled as the timeline scrolls (only those on screen
// exist); a recycled cell's canvas used to lose its drawing for good (bro's
// canvas sweep dropped a canvas that left the document for a frame), and every
// picture after about the 18th frame was blank. Also: the timeline keeps few
// cells, and a frame of scrolling it stays cheap.

import { app, waitFor, press, fixtureDir } from '/lib/test.js';
import { burstTree, withoutAnimals, useKeyModel, pickSubject } from '/app/tests/burst.js';

const path = require('path');

resize(2000, 1080);

const N = Number(process.env.IV_BURST_N || (process.env.CI ? 72 : 120));
const burstLen = Math.floor(N / 3);
const frames = [];
for (let k = 0; k < N; k++) {
  const b = Math.floor(k / burstLen);              // three bursts, 2 s apart
  const time = b * 6 + 0.1 * (k % burstLen);
  frames.push({ name: `t_${String(k + 1).padStart(3, '0')}.jpg`, time,
    bg: [0.6 * k, -0.4 * k], subject: [110 + 0.5 * k, 100 + 0.25 * k] });
}
const dir = fixtureDir(burstTree(frames, { w: 320, h: 240, r: 16 }));
const names = frames.map((f) => f.name);
withoutAnimals();
app.openPath(path.join(dir, names[0]));
waitFor(() => app.state.mode === 'image' && app.state.pic && app.state.pic.path.endsWith(names[0]) && !app.state.pic.placeholder,
  `${names[0]} on screen`);
waitFor(() => app.strip.items.length === names.length, 'the strip lists the burst');
useKeyModel();
pickSubject(frames[0].subject);
// Every frame: the strip's own range selection, as Shift+click on the last would (it is off screen).
app.strip.select(app.strip.items.map((it) => it.path), { scroll: false });
waitFor(() => app.strip.selection.size === names.length, 'every frame selected');
press('b');
waitFor(() => app.burst.active && app.burst.session.ready() && app.burst.view.crop, 'every frame tracked', 180000);
const view = app.burst.view;
waitFor(() => view.previews.size === frames.length, 'every preview decoded', 60000);
runFrames(30);

/** How much a picture's pixels vary: a painted one shows texture, a blank one is flat. */
function spread(img, r, dpr) {
  let lo = 765, hi = 0;
  const x0 = Math.round((r.left + 4) * dpr), x1 = Math.round((Math.min(r.right, r.left + 96) - 4) * dpr);
  const y0 = Math.round((r.top + 4) * dpr), y1 = Math.round((r.bottom - 4) * dpr);
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const i = (y * img.width + x) * 4;
      const v = img.data[i] + img.data[i + 1] + img.data[i + 2];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return hi - lo;
}

/** Each picture fully on screen in the presented frame: index -> how much it varies. */
function look(seen) {
  const img = presentedImage();
  assert(img, 'the frame loop presented a frame');
  const dpr = img.width / window.innerWidth;
  const W = window.innerWidth;
  for (const t of document.querySelectorAll('.iv-tl-thumb')) {
    const r = t.getBoundingClientRect();
    if (r.width < 8 || r.left < 0 || r.left + 96 > W) continue;
    const k = Number(t.closest('[data-index]').dataset.index);
    seen.set(k, spread(img, r, dpr));             // the last look: after the way back
  }
}

// Along the timeline to the last frame and back to the first: cells leave
// the document as the timeline scrolls and come back for other frames.
const seen = new Map();
const order = [];
for (let k = 0; k < N; k += 6) order.push(k);
order.push(N - 1);
for (let k = N - 1; k >= 0; k -= 6) order.push(k);
order.push(0);
let maxCells = 0;
for (const k of order) {
  view.go(k);
  runFrames(12);
  look(seen);
  maxCells = Math.max(maxCells, document.querySelectorAll('.iv-tl-cell').length);
}
const blank = [];
for (let k = 0; k < N; k++) if (!(seen.get(k) > 40)) blank.push(`${k + 1}:${seen.get(k)}`);
assert(seen.size === N, `every frame's picture was on screen (${seen.size} of ${N})`);
assert(!blank.length, `blank pictures (frame:spread): ${blank.join(' ')}`);
assert(maxCells < 50, `only the cells on screen exist (${maxCells} at most, of ${N})`);

// A frame of scrolling the timeline, cells recycled and painted, stays cheap.
const sc = view.tl.scroller;
let worst = 0;
for (let i = 0; i < 40; i++) {
  const t0 = perf.now();
  sc.scrollLeft = (i % 2 ? 0.8 : 0.2) * sc.scrollWidth;
  advanceTime(16);
  worst = Math.max(worst, perf.now() - t0);
}
console.log(`timeline: ${maxCells} cells at most of ${N}; worst scroll frame ${worst.toFixed(1)} ms`);
assert(worst < 120, `scrolling the timeline stays cheap (worst frame ${worst.toFixed(1)} ms)`);

if (process.env.IV_SHOT_DIR) {
  view.go(60);
  runFrames(20);
  screenshot(path.join(process.env.IV_SHOT_DIR, 'burst-120-frames.png'));
}

console.log('test_burst_thumbs PASSED');
