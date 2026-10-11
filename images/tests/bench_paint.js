// A benchmark, not a test (run_tests.sh runs test_*.js only): what painting
// costs Image Viewer's window frame by frame over a grid of 400 images, in
// the windowed frame loop (runFrames: layout and raster threads, as a window).
// Two phases: the grid scrolled 4 px a frame, then the pointer moving over
// its cells. Run it as
//   bro-headless --width 1280 --height 800 images images/tests/bench_paint.js
// Prints one PAINT line a phase: base records a frame and their main-thread
// ms, raster passes and their ms, spans recorded and reused, and why spans
// were recorded (perf.stats().paint). FRAMES=n frames a phase (default 300).

import { app, measureFrames, fixtureDir } from '/lib/test.js';
import { png } from '/app/tests/images.js';

const tree = {};
const N = 400;
for (let i = 0; i < N; i++) tree[`shot-${String(i).padStart(3, '0')}.png`] = png(240, 160, [(i * 37) % 255, (i * 91) % 255, 120]);
app.openPath(fixtureDir(tree));
const sc = app.grid.scroller;
// Every preview in, end to end, so the phases measure painting, not decoding.
measureFrames(() => {
  if (app.grid.items.length !== N) return false;
  const shown = document.querySelectorAll('.iv-grid .vgrid-cell').length;
  const done = Array.from(document.querySelectorAll('.iv-grid .vgrid-cell')).filter((c) => c.querySelector('.iv-thumb img')).length;
  if (shown > 0 && done === shown && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) return true;
  if (shown > 0 && done === shown) sc.scrollTop += sc.clientHeight;
  return false;
}, 'every preview', 60000);
sc.scrollTop = 0;
runFrames(30, { stepMs: 16 });

const most = sc.scrollHeight - sc.clientHeight;
const box = sc.getBoundingClientRect();
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

phase('scroll', () => { sc.scrollTop = (sc.scrollTop + 4) % Math.max(1, most); });
sc.scrollTop = 0;
runFrames(10, { stepMs: 16 });
phase('hover', (i) => mouseMove(box.left + 20 + ((i * 13) % Math.max(1, box.width - 40)),
                                box.top + 20 + ((i * 7) % Math.max(1, box.height - 40))));
