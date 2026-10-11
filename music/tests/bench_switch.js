// A benchmark, not a test (run_tests.sh runs test_*.js only): the view
// switch (Songs / Albums / Artists) over a 1500-song library, timed per
// switch. Run it as
//   bro-headless --width 1280 --height 800 music music/tests/bench_switch.js
// Environment:
//   COLD=1      sleep 60 ms of wall time before each switch, as a user does;
//               the CPU clocks down in between (on an M2 Pro a cold switch runs
//               ~4x a warm one), which is what a real switch pays
//   ROUNDS=n    rounds of six switches (default 12; the first two warm up)
//   PROFILE=1   run bro.profiler (where it is supported) over the measured
//               rounds and print its report: the switch's JS split by tier
// Prints one AVG line: wall per switch, split into the key handler and the
// frame after it, the style and layout milliseconds and counts, and the DOM
// sweep's collections.

import { app, measureFrames, fixtureDir, press, mod, settle } from '/lib/test.js';
import { wav, flacWithComments, useLibrary } from '/app/tests/fixtures.js';

const tree = {};
const tone = wav(0.05);
let n = 0;
for (let a = 0; a < 100; a++) for (let b = 0; b < 5; b++) for (let t = 1; t <= 3; t++) {
  const title = `Song ${a}-${b}-${t}`;
  tree[`Artist ${a}/Album ${a}-${b}/0${t} ${title}.${(n++ % 2) ? 'flac' : 'wav'}`] = (n % 2) ? tone
    : flacWithComments({ TITLE: title, ARTIST: `Artist ${a}`, ALBUM: `Album ${a}-${b}`, TRACKNUMBER: String(t) }, { seconds: 180 + t });
}
useLibrary(app, fixtureDir(tree));
measureFrames(() => app.library.lastScan && !app.library.scanning, 'the scan', 120000);
settle(500);

const keys = { songs: '1', albums: '2', artists: '3' };
const order = ['albums', 'artists', 'songs', 'artists', 'albums', 'songs'];
const COLD = !!process.env.COLD;
const ROUNDS = Number(process.env.ROUNDS || 12);
const WARMUP = 2;
const profiling = !!process.env.PROFILE && bro.profiler;
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  if (round === WARMUP && profiling) {
    try { bro.profiler.start({ hz: 2000 }); } catch (e) { console.log('profiler: ' + e.message); }
  }
  for (const v of order) {
    if (COLD) settle(60); else { advanceTime(16); advanceTime(16); }
    perf.reset();
    const d0 = perf.stats().dom;
    const t0 = perf.now();
    press(`${mod}+${keys[v]}`);
    const t1 = perf.now();
    advanceTime(16);
    const t2 = perf.now();
    const s = perf.stats(), d = s.dom;
    if (round >= WARMUP) rows.push({ wall: t2 - t0, handler: t1 - t0, frame: t2 - t1, style: s.styleMs, cascade: s.cascadeMs,
      layout: s.layoutMs, styled: s.elementsStyled, resolved: s.stylesResolved, collections: d.collections - d0.collections });
  }
}
if (profiling) {
  try {
    const p = bro.profiler.stop({ callers: false, report: true, top: 40 });
    console.log(p.report);
  } catch (e) { console.log('profiler: ' + e.message); }
}
const avg = (k) => (rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2);
const max = (k) => Math.max(...rows.map((r) => r[k])).toFixed(2);
console.log(`AVG ${COLD ? 'cold' : 'warm'} n=${rows.length} wall ${avg('wall')} (max ${max('wall')}) handler ${avg('handler')} ` +
  `frame ${avg('frame')} style ${avg('style')} cascade ${avg('cascade')} layout ${avg('layout')} ` +
  `styled ${avg('styled')} resolved ${avg('resolved')} collections ${avg('collections')}`);
