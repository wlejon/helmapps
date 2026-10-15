// Radio stays responsive: the first frame, and the worst frame while the
// stream plays, the trail grows and the listener is dragged across the map
// (on the fake backend; the real stream's work is on its own worker).

import { app, waitFor, measureFrames } from '/lib/test.js';
import { fakeBackend } from '/app/tests/fake_backend.js';

const FRAME_BUDGET_MS = 50;

const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

app.useBackend(fakeBackend());
waitFor(() => app.state.phase === 'ready', 'the map');
app.play();

// Drag the listener in a circle through the map for 40 s of program.
let step = 0;
const f = measureFrames(() => {
  const t = step++ / 40;
  app.wander(0.7 * Math.cos(t), 0.7 * Math.sin(t), step % 30 === 0);
  return app.state.radio.playhead > 40 * 48000 && app.state.trail.length >= 3;
}, '40 s of program while dragging', 60000);
console.log(`playing + dragging: ${f.frames} frames, worst ${f.maxMs.toFixed(1)} ms, mean ${f.avgMs.toFixed(1)} ms, ${f.slow} over 16.7 ms`);
assert(f.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms (worst ${f.maxMs.toFixed(1)})`);

console.log('test_perf PASSED');
