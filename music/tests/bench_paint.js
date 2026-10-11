// A benchmark, not a test (run_tests.sh runs test_*.js only): what painting
// costs Music's window frame by frame over a 1500-song library, in the
// windowed frame loop (runFrames: layout and raster threads, as a window).
// Two phases on the Songs list: scrolled 4 px a frame, then the pointer moving
// down its rows. Run it as
//   bro-headless --width 1280 --height 800 music music/tests/bench_paint.js
// Prints one PAINT line a phase: base records a frame and their main-thread
// ms, raster passes and their ms, spans recorded and reused (and translated
// for a scroll), and why spans were recorded (perf.stats().paint).
// FRAMES=n frames a phase (default 300).

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
press(`${mod}+1`);
settle(500);

// The list that scrolls: the element with the most to scroll.
let scroller = null, most = 0;
for (const el of document.querySelectorAll('*')) {
  const extra = el.scrollHeight - el.clientHeight;
  const ov = getComputedStyle(el).overflowY;
  if (extra > most && (ov === 'auto' || ov === 'scroll')) { most = extra; scroller = el; }
}
assert(scroller, 'a scrolling list');
const box = scroller.getBoundingClientRect();
const FRAMES = Number(process.env.FRAMES || 300);

function phase(name, perFrame) {
  let i = 0, running = true;
  const tick = () => { if (!running) return; perFrame(i++); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  runFrames(30, { stepMs: 16 });   // warm up
  const p0 = perf.stats().paint;
  runFrames(FRAMES, { stepMs: 16 });
  const p1 = perf.stats().paint;
  running = false;
  runFrames(2, { stepMs: 16 });
  const d = (k) => p1[k] - p0[k];
  const misses = Object.keys(p1.misses).map((k) => [k, p1.misses[k] - p0.misses[k]]).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${(v / FRAMES).toFixed(1)}`).join(', ');
  console.log(`PAINT ${name}: records ${(d('records') / FRAMES).toFixed(2)}/frame at ` +
    `${(d('recordMs') / Math.max(1, d('records'))).toFixed(3)} ms, raster ${(d('rasterPasses') / FRAMES).toFixed(2)}/frame at ` +
    `${(d('rasterMs') / Math.max(1, d('rasterPasses'))).toFixed(3)} ms, spans recorded ${(d('recorded') / FRAMES).toFixed(1)} ` +
    `reused ${(d('reused') / FRAMES).toFixed(1)} (scrolled ${(d('reusedScrolled') / FRAMES).toFixed(1)})/frame; misses: ${misses}`);
}

phase('scroll', () => { scroller.scrollTop = (scroller.scrollTop + 4) % Math.max(1, most); });
scroller.scrollTop = 0;
runFrames(10, { stepMs: 16 });
phase('hover', (i) => mouseMove(box.left + box.width / 2, box.top + 10 + ((i * 7) % Math.max(1, box.height - 20))));
