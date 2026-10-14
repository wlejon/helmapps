/**
 * Performance test for Calculator (helm.calculator):
 * Verifies fast startup (firstFrameMs) and responsive frames (< 50 ms)
 * while evaluating 200 complex expressions, switching modes, toggling bits,
 * and rendering 100 history items.
 */

import { app, measureFrames, eq } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;

// ---- startup ----------------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- heavy workload across frames -------------------------------------------
app.clearHistory();
app.clearAll();

let step = 0;
const f = measureFrames(() => {
  // Each frame does a batch of evaluations, history commits, mode switches, and bit toggles
  for (let i = 0; i < 20; i++) {
    const n = step * 20 + i + 1;
    if (step < 5) {
      app.setMode('scientific');
      app.setInput(`sin(${n}) + cos(${n}) * sqrt(${n}) + (${n}%7) + 5!`);
      app.commit();
    } else if (step < 8) {
      app.setMode('programmer');
      app.setInput(`0xFF00FF AND ${n * 17} OR (${n} << 3)`);
      app.commit();
      app.toggleBit(n % 64);
    } else {
      app.setMode('basic');
      app.setInput(`${n}*3 + (${n}+12)/4`);
      app.commit();
    }
  }
  step++;
  return step >= 10;
}, '200 evaluations, mode switches, bit toggles, and 100 history renders');

console.log(`workload: ${f.frames} frames, worst ${f.maxMs.toFixed(1)} ms, mean ${f.avgMs.toFixed(1)} ms, ${f.slow} over 16.7 ms`);
assert(f.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms (worst ${f.maxMs.toFixed(1)} ms)`);
eq(app.state.history.length, 100, 'history capped at 100 entries');

console.log('test_perf PASSED');
