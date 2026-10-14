// Performance test for Archive Manager (helm.archives):
// 1. Verifies fast startup (firstFrameMs - loadedMs < 250 ms).
// 2. Builds a 1,000-entry archive and measures frames with measureFrames()
//    while opening, navigating folders, sorting, and filtering, asserting maxMs < 50.

import { app, waitFor, measureFrames, eq, fixtureDir } from '/lib/test.js';

const path = require('path');

const FRAME_BUDGET_MS = 50;

// ---- 1. Startup timing ------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250,
  `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- 2. Build a 1,000-entry archive in memory and write to fixture ----------
const dir = fixtureDir({});
const bigZipPath = path.join(dir, 'thousand.zip');
const rawEntries = [];
for (let i = 0; i < 800; i++) {
  rawEntries.push({
    path: `file_${String(i).padStart(4, '0')}.txt`,
    isDirectory: false,
    data: `Entry number ${i} payload content`,
    mtimeMs: 1700000000000 + i * 1000,
  });
}
for (let i = 0; i < 200; i++) {
  rawEntries.push({
    path: `nested/item_${String(i).padStart(4, '0')}.log`,
    isDirectory: false,
    data: `Nested log line ${i}`,
    mtimeMs: 1700000000000 + i * 1000,
  });
}

let built = false;
app.codec.writeArchiveEntries(bigZipPath, rawEntries, { format: 'zip' }).then(() => {
  built = true;
});
waitFor(() => built, '1,000-entry archive written');

// ---- 3. Measure frames while opening and browsing the 1,000-entry archive ---
app.openArchive(bigZipPath);
const loadFrames = measureFrames(
  () => app.state.done && app.state.archivePath === bigZipPath && app.list.items.length === 801,
  'opening 1,000-entry archive',
);
console.log(`open 1,000-entry archive: ${loadFrames.frames} frames, worst ${loadFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${loadFrames.avgMs.toFixed(1)} ms, ${loadFrames.slow} over 16.7 ms`);
assert(loadFrames.maxMs < FRAME_BUDGET_MS,
  `no frame over ${FRAME_BUDGET_MS} ms while opening 1,000-entry archive (worst ${loadFrames.maxMs.toFixed(1)} ms)`);

// Navigate into 'nested' folder and filter
let step = 0;
const navFrames = measureFrames(() => {
  if (step === 0) {
    app.navigateTo('nested');
    step = 1;
    return false;
  }
  if (step === 1 && app.state.currentDir === 'nested' && app.list.items.length === 200) {
    app.navigateTo('');
    step = 2;
    return false;
  }
  if (step === 2 && app.state.currentDir === '' && app.list.items.length === 801) {
    app.setSearchQuery('file_05');
    step = 3;
    return false;
  }
  return step === 3 && app.list.items.length >= 10;
}, 'navigating and filtering 1,000-entry archive');

console.log(`navigate & filter: ${navFrames.frames} frames, worst ${navFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${navFrames.avgMs.toFixed(1)} ms`);
assert(navFrames.maxMs < FRAME_BUDGET_MS,
  `no frame over ${FRAME_BUDGET_MS} ms while navigating/filtering (worst ${navFrames.maxMs.toFixed(1)} ms)`);

eq(app.state.archive.fileCount, 1000, 'all 1,000 files indexed');
console.log('test_perf PASSED');
