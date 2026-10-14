// Performance test for helm.files:
//  - Startup time (firstFrameMs - loadedMs < 250 ms)
//  - Opening a 1,500-file folder stays under the 50 ms frame budget
//  - Switching between grid and list views and scrolling through 1,500 items
//    stays under the 50 ms frame budget.

import { app, settle, measureFrames, eq, fixtureDir } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;

// 1. Startup
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250,
  `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// 2. Create a 1,500-file fixture directory
const t0 = perf.now();
const tree = {};
for (let i = 0; i < 1500; i++) {
  tree[`file_${String(i).padStart(4, '0')}.txt`] = 'x';
}
const bigDir = fixtureDir(tree);
console.log(`fixture: 1500 files created in ${(perf.now() - t0).toFixed(0)} ms`);
settle(100);

// 3. Measure frames while opening the 1,500-file folder
app.openPath(bigDir);
const openStats = measureFrames(
  () => app.state.currentPath === bigDir && app.state.done && app.list.items.length === 1500,
  'opening 1500-file folder',
);
console.log(`open 1500 files: ${openStats.frames} frames, worst ${openStats.maxMs.toFixed(1)} ms, ` +
  `mean ${openStats.avgMs.toFixed(1)} ms, ${openStats.slow} over 16.7 ms`);
assert(openStats.maxMs < FRAME_BUDGET_MS,
  `no frame over ${FRAME_BUDGET_MS} ms while opening 1500 files (worst ${openStats.maxMs.toFixed(1)} ms)`);

// 4. Measure frames while switching views and scrolling across the 1,500 items
let step = 0;
const scrollStats = measureFrames(() => {
  step++;
  if (step === 1) app.views.setViewMode('list');
  else if (step <= 10) app.list.scrollToIndex(step * 140);
  else if (step === 11) app.views.setViewMode('grid');
  else if (step <= 20) app.list.scrollToIndex((20 - step) * 140);
  return step >= 21;
}, 'view switching and scrolling 1500 items');
console.log(`switch+scroll: ${scrollStats.frames} frames, worst ${scrollStats.maxMs.toFixed(1)} ms, ` +
  `mean ${scrollStats.avgMs.toFixed(1)} ms, ${scrollStats.slow} over 16.7 ms`);
assert(scrollStats.maxMs < FRAME_BUDGET_MS,
  `no frame over ${FRAME_BUDGET_MS} ms during view switch & scroll (worst ${scrollStats.maxMs.toFixed(1)} ms)`);

eq(app.list.items.length, 1500, 'all 1500 items remain indexed');

console.log('test_perf PASSED');
