// Disk Usage stays responsive: how long the window took to show, and the
// worst frame while a large tree is scanned, walked into and walked out of
// mid-scan, and while a folder of more files than the list shows is drawn.
// docs/performance.md says how to read these numbers and what to do when
// one is over budget.
//
// DU_PERF_ROOT=<folder> also scans a real tree (a whole drive, /usr) and
// reports, without failing on the time it takes.

import { app, waitFor, measureFrames, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const FRAME_BUDGET_MS = 50;   // generous for a shared test box; a healthy frame is a few ms

// ---- startup ---------------------------------------------------------------------
// The engine stamps both times; the test runs after the first frame.
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- a large tree --------------------------------------------------------------------
// Files cost real time to create (most of it the OS's, per file), so the
// tree is small and the app's row cap is lowered to match.
const t0 = perf.now();
const tree = {};
for (let d = 0; d < 30; d++) {
  for (let e = 0; e < 6; e++) {
    for (let f = 0; f < 5; f++) tree[`d${d}/e${e}/f${f}.bin`] = new Uint8Array(d + 1);
  }
}
for (let i = 0; i < 1500; i++) tree[`wide/w${i}.txt`] = '';
const dir = fixtureDir(tree);
console.log(`fixture: ${Object.keys(tree).length} files in ${(perf.now() - t0).toFixed(0)} ms`);
app.state.maxRows = 1000;

app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.scan, 'the scan to start');
// Walk into a folder while the scan may still be running, then back out.
const scanFrames = measureFrames(() => {
  const p = app.state.scan.progress();
  if (app.state.currentPath === dir && app.list.items.some((n) => n.name === 'd29')) app.show(path.join(dir, 'd29'));
  else if (app.state.currentPath !== dir) app.show(dir);
  return p.finished;
}, 'the scan to finish');
console.log(`scan: ${scanFrames.frames} frames, worst ${scanFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${scanFrames.avgMs.toFixed(1)} ms, ${scanFrames.slow} over 16.7 ms`);
assert(scanFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while scanning (worst ${scanFrames.maxMs.toFixed(1)})`);

app.show(dir);
waitFor(() => app.state.current && app.state.current.complete && app.list.items.length === 31, 'the whole folder listed');
eq(app.list.items[0].name, 'd29', 'the biggest folder first');
eq(app.state.current.files, 900 + 1500, 'every file counted');

// ---- more files than the list shows --------------------------------------------------------
const drawFrames = measureFrames(() => {
  if (app.state.currentPath !== path.join(dir, 'wide')) app.show(path.join(dir, 'wide'));
  return app.list.items.length === 1000;
}, 'the wide folder');
console.log(`a folder of 1500 files: worst frame ${drawFrames.maxMs.toFixed(1)} ms`);
assert(drawFrames.maxMs < FRAME_BUDGET_MS, `showing 1000 rows of 1500 stays under ${FRAME_BUDGET_MS} ms`);
const status = document.querySelector('.statusbar').textContent;
assert(status.includes('largest 1,000 of 1,500'), `the status bar says the list is cut to the largest 1,000: ${status}`);

// ---- optional: a real tree -------------------------------------------------------------
const real = process.env.DU_PERF_ROOT;
if (real) {
  app.openPath(real);
  waitFor(() => app.state.rootPath === path.resolve(real), 'the real scan to start');
  const f = measureFrames(() => app.state.scan.progress().finished, `the scan of ${real}`, 600000);
  const p = app.state.scan.progress();
  console.log(`${real}: ${p.files} files, ${p.directories} folders, ${(p.bytes / 1e9).toFixed(1)} GB in ` +
    `${(p.elapsedMs / 1000).toFixed(1)} s; ${f.frames} frames, worst ${f.maxMs.toFixed(1)} ms, ${f.slow} over 16.7 ms`);
  assert(f.maxMs < FRAME_BUDGET_MS * 2, `no frame over ${FRAME_BUDGET_MS * 2} ms while scanning ${real}`);
}

console.log('test_perf PASSED');
