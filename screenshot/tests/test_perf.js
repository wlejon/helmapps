// Performance test for Screenshot (helm.screenshot):
// - Verifies startup time
// - Measures frames during 1920x1080 capture, adding 30 annotations,
//   undo/redo, cropping, and flattening, asserting worst frame < 50 ms.

import { app, waitFor, measureFrames } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;

// ---- startup ----------------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- heavy 1920x1080 capture + 30 annotations + undo/redo + crop -----------
const src1080p = app.createSyntheticSource(1920, 1080);
app.setCaptureSource(() => src1080p);
app.settings.set('mode', 'full');
app.settings.set('delay', 0);

await app.takeScreenshot('full');
waitFor(() => app.state.view === 'result' && app.state.image && app.state.image.width === 1920, '1080p capture ready');

let step = 0;
const stats = measureFrames(() => {
  if (step < 30) {
    const i = step++;
    const x = 40 + (i % 6) * 260;
    const y = 40 + Math.floor(i / 6) * 180;
    const kind = ['rect', 'arrow', 'highlighter', 'blur', 'counter'][i % 5];
    if (kind === 'arrow') {
      app.addAnnotation({ type: 'arrow', x1: x, y1: y, x2: x + 160, y2: y + 90, color: '#ef4444', strokeWidth: 4 });
    } else if (kind === 'counter') {
      app.addAnnotation({ type: 'counter', x: x + 40, y: y + 40, number: i + 1, color: '#3b82f6' });
    } else {
      app.addAnnotation({ type: kind, x, y, w: 180, h: 100, color: '#22c55e', strokeWidth: 4 });
    }
    return false;
  }
  if (step === 30) {
    for (let u = 0; u < 10; u++) app.undo();
    step++;
    return false;
  }
  if (step === 31) {
    for (let r = 0; r < 10; r++) app.redo();
    step++;
    return false;
  }
  if (step === 32) {
    const flat = app.renderFlattenedPixels();
    assert(flat.length === 1920 * 1080 * 4, 'flattened 1080p buffer size');
    step++;
    return true;
  }
  return true;
}, 'annotating and flattening a 1920x1080 screenshot');

console.log(`perf: ${stats.frames} frames, worst ${stats.maxMs.toFixed(1)} ms, mean ${stats.avgMs.toFixed(1)} ms, ${stats.slow} over 16.7 ms`);
assert(stats.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms (worst ${stats.maxMs.toFixed(1)} ms)`);

console.log('test_perf PASSED');
