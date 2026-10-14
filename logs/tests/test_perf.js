/**
 * Performance tests for helm.logs:
 *  - Verifies fast startup (firstFrameMs - loadedMs < 250)
 *  - Generates a 10,000-line mixed-format log file
 *  - Measures loading, severity filtering, regex searching, and scrolling
 *    under measureFrames(), asserting worst frame < 50 ms
 */

import { app, waitFor, measureFrames, eq, fixtureDir } from '/lib/test.js';

const path = require('path');

const FRAME_BUDGET_MS = 50;

// ---- 1. Startup timing ------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(
  s.firstFrameMs - s.loadedMs < 250,
  `first frame follows load within budget (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`,
);

// ---- 2. Generate 10,000-line mixed log fixture ------------------------------
const t0 = perf.now();
const lines = new Array(10000);
for (let i = 0; i < 10000; i++) {
  const mod = i % 4;
  if (mod === 0) {
    lines[i] = `[2026-10-14 10:00:${String(i % 60).padStart(2, '0')}.${String(i % 1000).padStart(3, '0')}] [INFO] [helm.compositor] Frame ${i} presented cleanly`;
  } else if (mod === 1) {
    lines[i] = `{"timestamp":"2026-10-14T10:01:00.000Z","level":"debug","service":"vfs","message":"Stat cache hit for node ${i}"}`;
  } else if (mod === 2) {
    lines[i] = `Oct 14 10:02:11 archbox kernel: [ ${100 + i}.123456] usb 1-1: warning: device ${i} link state slow`;
  } else {
    lines[i] = `[2026-10-14 10:03:00.000] [ERROR] [bro.audio] Buffer underrun on stream ${i}`;
  }
}

const dir = fixtureDir({
  'large-10k.log': lines.join('\n') + '\n',
});
const bigLogPath = path.join(dir, 'large-10k.log');
console.log(`fixture: generated 10,000 log lines in ${(perf.now() - t0).toFixed(0)} ms`);

// ---- 3. Load 10,000-line log file -------------------------------------------
app.openLogFile(bigLogPath);
const loadFrames = measureFrames(
  () => app.state.activeSourceId === path.resolve(bigLogPath) && app.state.entries.length === 10000,
  'loading 10,000 log entries',
);
console.log(
  `load 10k: ${loadFrames.frames} frames, worst ${loadFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${loadFrames.avgMs.toFixed(1)} ms, ${loadFrames.slow} over 16.7 ms`,
);
assert(loadFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while loading 10k lines (worst ${loadFrames.maxMs.toFixed(1)})`);

// ---- 4. Severity filtering across 10,000 entries ----------------------------
let filterTriggered = false;
const sevFrames = measureFrames(() => {
  if (!filterTriggered) {
    filterTriggered = true;
    app.setSeverity('error');
  }
  return app.state.filtered.length === 2500;
}, 'filtering 10,000 entries by error severity');
console.log(`severity filter 10k: worst ${sevFrames.maxMs.toFixed(1)} ms`);
assert(sevFrames.maxMs < FRAME_BUDGET_MS, `severity filter stays under ${FRAME_BUDGET_MS} ms (worst ${sevFrames.maxMs.toFixed(1)})`);

app.setSeverity('all');
waitFor(() => app.state.filtered.length === 10000, 'reset to 10,000 entries');

// ---- 5. Regex search across 10,000 entries ----------------------------------
let regexTriggered = false;
const regexFrames = measureFrames(() => {
  if (!regexTriggered) {
    regexTriggered = true;
    app.setUseRegex(true);
    app.setQuery('stream (9999|5003|1003)$');
  }
  return app.state.filtered.length === 3;
}, 'regex searching 10,000 entries');
console.log(`regex search 10k: worst ${regexFrames.maxMs.toFixed(1)} ms`);
assert(regexFrames.maxMs < FRAME_BUDGET_MS, `regex search stays under ${FRAME_BUDGET_MS} ms (worst ${regexFrames.maxMs.toFixed(1)})`);

app.setUseRegex(false);
app.setQuery('');
waitFor(() => app.state.filtered.length === 10000, 'cleared search query');

// ---- 6. Scrolling through 10,000 entries in VirtualList ---------------------
let step = 0;
const scrollTargets = [1000, 3000, 6000, 9000, 9999, 0];
const scrollFrames = measureFrames(() => {
  if (step < scrollTargets.length) {
    app.list.scrollToIndex(scrollTargets[step]);
    step++;
    return false;
  }
  return true;
}, 'scrolling through 10,000 entries');
console.log(
  `scroll 10k: ${scrollFrames.frames} frames, worst ${scrollFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${scrollFrames.avgMs.toFixed(1)} ms`,
);
assert(scrollFrames.maxMs < FRAME_BUDGET_MS, `scrolling 10k entries stays under ${FRAME_BUDGET_MS} ms (worst ${scrollFrames.maxMs.toFixed(1)})`);

eq(app.state.entries.length, 10000, 'all 10,000 entries retained in model');
console.log('test_perf PASSED');
