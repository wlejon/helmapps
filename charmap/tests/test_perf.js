/**
 * Performance & responsiveness tests for Character Map (helm.charmap):
 * - Startup time (firstFrameMs - loadedMs < 250 ms)
 * - Switching across Unicode blocks under measureFrames (< 50 ms worst frame)
 * - Scrolling through the All Characters virtual grid of >2,000 glyphs (< 50 ms worst frame)
 * - Running live search queries across the full catalog (< 50 ms worst frame)
 */

import { app, waitFor, measureFrames } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;

// ---- 1. Startup -------------------------------------------------------------

const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

waitFor(() => app && app.list && app.list.items.length > 0, 'initial view ready');

// ---- 2. Switching blocks ----------------------------------------------------

const blocksToVisit = [
  'basic-latin', 'greek', 'cyrillic', 'arrows', 'math',
  'box-drawing', 'braille', 'emoticons', 'all',
];
let blockIdx = 0;

const switchFrames = measureFrames(() => {
  if (blockIdx < blocksToVisit.length) {
    app.selectBlock(blocksToVisit[blockIdx++]);
    return false;
  }
  return app.state.blockId === 'all' && app.list.items.length > 2000;
}, 'switching through Unicode blocks to All Characters');

console.log(`block switch: ${switchFrames.frames} frames, worst ${switchFrames.maxMs.toFixed(1)} ms, mean ${switchFrames.avgMs.toFixed(1)} ms`);
assert(switchFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while switching blocks (worst ${switchFrames.maxMs.toFixed(1)})`);

// ---- 3. Scrolling through All Characters virtual grid -----------------------

const scroller = app.list.scroller;
let scrollStep = 0;
const totalSteps = 16;

const scrollFrames = measureFrames(() => {
  if (scrollStep < totalSteps) {
    scroller.scrollTop = scrollStep * 320;
    app.list.paint();
    scrollStep++;
    return false;
  }
  scroller.scrollTop = 0;
  app.list.paint();
  return true;
}, 'scrolling through All Characters virtual grid');

console.log(`virtual grid scroll: ${scrollFrames.frames} frames, worst ${scrollFrames.maxMs.toFixed(1)} ms, mean ${scrollFrames.avgMs.toFixed(1)} ms`);
assert(scrollFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while scrolling All Characters (worst ${scrollFrames.maxMs.toFixed(1)})`);

// ---- 4. Live search queries across All Characters ---------------------------

const queries = ['arrow', 'rightwards arrow', 'infinity', 'braille', 'U+2192', 'euro', 'lambda', '→', ''];
let qIdx = 0;

const searchFrames = measureFrames(() => {
  if (qIdx < queries.length) {
    app.setSearch(queries[qIdx++]);
    return false;
  }
  return app.state.query === '' && app.list.items.length > 2000;
}, 'running live search queries');

console.log(`live search: ${searchFrames.frames} frames, worst ${searchFrames.maxMs.toFixed(1)} ms, mean ${searchFrames.avgMs.toFixed(1)} ms`);
assert(searchFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms during live search (worst ${searchFrames.maxMs.toFixed(1)})`);

console.log('test_perf PASSED');
