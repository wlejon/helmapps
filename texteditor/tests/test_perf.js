// Performance test for Text Editor (docs/performance.md):
//  1. Startup first frame follows page load under 250 ms.
//  2. Opening a 5,000-line file (~250 KB), finding across all lines, and
//     running Replace All keeps the worst frame under 50 ms.

import { app, waitFor, measureFrames, eq, fixtureDir } from '/lib/test.js';

const path = require('path');

const FRAME_BUDGET_MS = 50;

// ---- 1. Startup ------------------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports firstFrameMs');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(
  s.firstFrameMs - s.loadedMs < 250,
  `first frame follows load within 250 ms (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`,
);

waitFor(() => app.state && app.state.ready, 'app ready');

// ---- 2. Large 5,000-line fixture -------------------------------------------------
const lines = [];
for (let i = 1; i <= 5000; i++) {
  lines.push(`Line ${i}: config_key_${i} = "value_${i}" # token_marker_${i % 25 === 0 ? 'TARGET' : 'normal'}`);
}
const bigText = lines.join('\n') + '\n';
const dir = fixtureDir({ 'large.conf': bigText });
const bigPath = path.join(dir, 'large.conf');

app.openFile(bigPath);
const openFrames = measureFrames(
  () => app.activeDoc() && app.activeDoc().path === bigPath && app.activeDoc().lineCount === 5001,
  'opening 5,000-line file',
);
console.log(
  `open 5,000 lines (${(bigText.length / 1024).toFixed(0)} KB): ${openFrames.frames} frames, ` +
  `worst ${openFrames.maxMs.toFixed(1)} ms, mean ${openFrames.avgMs.toFixed(1)} ms`,
);
assert(
  openFrames.maxMs < FRAME_BUDGET_MS,
  `opening 5,000-line file stays under ${FRAME_BUDGET_MS} ms (worst ${openFrames.maxMs.toFixed(1)} ms)`,
);

// ---- 3. Find and Replace All across 5,000 lines ----------------------------------
let replaced = false;
const findReplaceFrames = measureFrames(() => {
  if (!app.findBar.visible) {
    app.findBar.open({ replace: true });
    app.findBar.setQuery('token_marker_TARGET', { replaceWith: 'token_marker_REPLACED' });
    eq(app.findBar.matches.length, 200, '200 matches located in 5,000-line file');
    return false;
  }
  if (!replaced) {
    const n = app.findBar.replaceAll();
    eq(n, 200, '200 occurrences replaced');
    replaced = true;
  }
  return replaced && app.findBar.matches.length === 0;
}, 'Find and Replace All across 5,000 lines');

console.log(
  `find + replaceAll 200 matches in 5,000 lines: ${findReplaceFrames.frames} frames, ` +
  `worst ${findReplaceFrames.maxMs.toFixed(1)} ms, mean ${findReplaceFrames.avgMs.toFixed(1)} ms`,
);
assert(
  findReplaceFrames.maxMs < FRAME_BUDGET_MS,
  `find + replaceAll stays under ${FRAME_BUDGET_MS} ms (worst ${findReplaceFrames.maxMs.toFixed(1)} ms)`,
);

console.log('test_perf PASSED');
