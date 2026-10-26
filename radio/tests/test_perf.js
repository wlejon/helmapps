// Radio stays responsive: the first frame, and the worst frame while the
// stream plays, the timeline fills and the listener is dragged in circles
// across the mood plane (on the fake backend; the real stream's work is on
// its own worker).

import { app, waitFor, measureFrames } from '/lib/test.js';
import { fakeBackend } from '/app/tests/fake_backend.js';

const FRAME_BUDGET_MS = 50;

const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// Where the models are found, let their load finish first (it is not what is measured).
waitFor(() => app.state.phase !== 'loading', 'the models load to settle', 120000);
app.useBackend(fakeBackend());
waitFor(() => app.state.phase === 'ready', 'ready');
app.play();
// The first frame after Play builds the playing screen and opens the audio: one frame, reported on its own.
const p0 = perf.now();
advanceTime(16);
const playMs = perf.now() - p0;
console.log(`the frame after Play: ${playMs.toFixed(1)} ms`);
const playBudget = process.env.CI ? 200 : 120;
assert(playMs < playBudget, `Play answers within ${playBudget} ms (${playMs.toFixed(1)})`);

let step = 0;
const f = measureFrames(() => {
  const t = step++ / 40;
  app.moveTo(0.8 * Math.cos(t), 0.8 * Math.sin(t), step % 30 === 0);
  return app.state.radio.playhead > 40 * 48000 && document.querySelectorAll('.tl-card.played').length >= 3;
  // 40 s of program is 2500 frames of the page clock whatever the machine; the
  // wall-clock limit only catches a stream that never gets there.
}, '40 s of program while dragging', 150000);
console.log(`playing + dragging: ${f.frames} frames, worst ${f.maxMs.toFixed(1)} ms, mean ${f.avgMs.toFixed(1)} ms, ${f.slow} over 16.7 ms`);
assert(f.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms (worst ${f.maxMs.toFixed(1)})`);

console.log('test_perf PASSED');
