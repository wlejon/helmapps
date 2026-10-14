// Performance test for System Monitor (helm.monitor):
//  1. Startup: first frame follows script load within 250 ms.
//  2. Sampling 500 processes across multiple ticks, sorting, filtering, and
//     switching between Processes and Performance pages stays under 50 ms worst frame.

import { app, measureFrames, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const FRAME_BUDGET_MS = 50;

// ---- 1. Startup --------------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(
  s.firstFrameMs - s.loadedMs < 250,
  `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`
);

// ---- 2. 500 processes fixture ------------------------------------------------
app.sampler.stop();

const t0 = perf.now();
const tree = {
  'proc/stat': [
    'cpu  10000 0 2000 88000 0 0 0 0 0 0',
    'cpu0 2500 0 500 22000 0 0 0 0 0 0',
    'cpu1 2500 0 500 22000 0 0 0 0 0 0',
    'cpu2 2500 0 500 22000 0 0 0 0 0 0',
    'cpu3 2500 0 500 22000 0 0 0 0 0 0',
  ].join('\n'),
  'proc/meminfo': 'MemTotal: 16000000 kB\nMemAvailable: 9000000 kB\nSwapTotal: 4000000 kB\nSwapFree: 3500000 kB\n',
  'proc/diskstats': '   8       0 sda 100 0 4000 10 100 0 2000 10 0 10 20\n',
  'proc/net/dev': 'Inter-|\n face |\n  eth0: 500000 100 0 0 0 0 0 0 250000 100 0 0 0 0 0 0\n',
  'proc/loadavg': '1.10 0.90 0.70 3/800 2500\n',
  'proc/uptime': '86400.00 300000.00\n',
};

const NUM_PROCS = 500;
for (let i = 0; i < NUM_PROCS; i++) {
  const pid = 1000 + i;
  const ppid = i === 0 ? 1 : 1000 + Math.floor((i - 1) / 4);
  const utime = 50 + (i * 7) % 400;
  const stime = 10 + (i * 3) % 100;
  const rssPages = 500 + (i * 37) % 10000;
  tree[`proc/${pid}/stat`] = `${pid} (proc-${i}) S ${ppid} ${pid} ${pid} 0 -1 4194304 10 0 0 0 ${utime} ${stime} 0 0 20 0 2 0 1000 104857600 ${rssPages} 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n`;
  tree[`proc/${pid}/cmdline`] = `/usr/bin/proc-${i}\0--worker=${i}\0`;
  tree[`proc/${pid}/status`] = `Name:\tproc-${i}\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t${rssPages * 4} kB\nThreads:\t2\n`;
}

const dir = fixtureDir(tree);
console.log(`fixture: ${NUM_PROCS} processes created in ${(perf.now() - t0).toFixed(0)} ms`);

app.setPage('processes');
app.setRoot(dir);

// Warm up JIT tiering on initial fixture load, then measure cold & warm ticks
let warmupDone = false;
app.tick(500).then(() => {
  app.processesView.setTreeMode(true);
  app.processesView.setTreeMode(false);
  app.setPage('performance');
  app.setPage('processes');
  app.procSampler.reset();
  warmupDone = true;
});
measureFrames(() => warmupDone, 'warmup fixture load', 30000);

// First measured tick (cold cache: reads stat + cmdline + status for 500 processes)
let tick1Done = false;
app.tick(1000).then(() => { tick1Done = true; });
const coldFrames = measureFrames(() => tick1Done, 'initial 500-process sample tick');
console.log(
  `500-proc cold tick: ${coldFrames.frames} frames, worst ${coldFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${coldFrames.avgMs.toFixed(1)} ms, ${coldFrames.slow} over 16.7 ms`
);
assert(
  coldFrames.maxMs < FRAME_BUDGET_MS,
  `no frame over ${FRAME_BUDGET_MS} ms during cold 500-proc tick (worst ${coldFrames.maxMs.toFixed(1)} ms)`
);
eq(app.list.items.length, NUM_PROCS, 'all 500 processes loaded');

// Update a subset of processes & /proc/stat and measure warm ticks + UI interactions
fs.writeFileSync(path.join(dir, 'proc/stat'), [
  'cpu  10400 0 2100 88500 0 0 0 0 0 0',
  'cpu0 2650 0 525 22075 0 0 0 0 0 0',
  'cpu1 2600 0 525 22125 0 0 0 0 0 0',
  'cpu2 2575 0 525 22150 0 0 0 0 0 0',
  'cpu3 2575 0 525 22150 0 0 0 0 0 0',
].join('\n'));
for (let i = 0; i < 25; i++) {
  const pid = 1000 + i;
  const ppid = i === 0 ? 1 : 1000 + Math.floor((i - 1) / 4);
  const utime = 100 + i * 10;
  const stime = 30 + i * 5;
  const rssPages = 600 + i * 50;
  fs.writeFileSync(
    path.join(dir, `proc/${pid}/stat`),
    `${pid} (proc-${i}) R ${ppid} ${pid} ${pid} 0 -1 4194304 10 0 0 0 ${utime} ${stime} 0 0 20 0 2 0 1000 104857600 ${rssPages} 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n`
  );
}

let tick2Done = false;
app.tick(2000).then(() => { tick2Done = true; });
let tick3Started = false;
let tick3Done = false;
let uiStep = 0;

const warmFrames = measureFrames(() => {
  if (!tick2Done) return false;
  uiStep++;
  if (uiStep === 1) { app.processesView.setTreeMode(true); return false; }
  if (uiStep === 2) { app.setFilter('proc-1'); return false; }
  if (uiStep === 3) { app.setFilter(''); return false; }
  if (uiStep === 4) { app.processesView.setTreeMode(false); return false; }
  if (uiStep === 5) { app.setPage('performance'); return false; }
  if (!tick3Started) {
    tick3Started = true;
    app.tick(3000).then(() => { tick3Done = true; });
    return false;
  }
  if (!tick3Done) return false;
  app.setPage('processes');
  return true;
}, 'warm 500-proc ticks + tree mode + filter + performance charts');

console.log(
  `500-proc warm ticks + UI: ${warmFrames.frames} frames, worst ${warmFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${warmFrames.avgMs.toFixed(1)} ms, ${warmFrames.slow} over 16.7 ms`
);
assert(
  warmFrames.maxMs < FRAME_BUDGET_MS,
  `no frame over ${FRAME_BUDGET_MS} ms during warm 500-proc ticks (worst ${warmFrames.maxMs.toFixed(1)} ms)`
);

console.log('test_perf PASSED');
