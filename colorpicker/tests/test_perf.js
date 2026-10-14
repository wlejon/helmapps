/**
 * Performance & responsiveness test for helm.colorpicker.
 * Verifies startup budget and measures frame times while sweeping Hue across
 * both HSV and Oklch 2D planes, computing live harmonies/scales, and running
 * contrast auto-adjustments.
 */

import { app, measureFrames } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;

// 1. Startup timing
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports firstFrameMs');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `first frame follows load promptly (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// 2. Sweep 30 hues across both HSV and Oklch 2D rasterizers + live harmonies & contrast
app.setView('picker');
let step = 0;
const sweepFrames = measureFrames(() => {
  const hue = (step * 12) % 360;
  app.setPlaneSpace(step % 2 === 0 ? 'oklch' : 'hsv');
  app.setColor(`oklch(0.65 0.18 ${hue})`, { pushHistory: false });
  app.contrastView.setPair(app.state.formats.hex6, '#0f172a');
  step++;
  return step >= 30;
}, 'sweeping 30 Oklch/HSV planes and contrast updates');

console.log(`sweep: ${sweepFrames.frames} frames, worst ${sweepFrames.maxMs.toFixed(1)} ms, ` +
  `mean ${sweepFrames.avgMs.toFixed(1)} ms, ${sweepFrames.slow} over 16.7 ms`);
assert(sweepFrames.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms (worst ${sweepFrames.maxMs.toFixed(1)} ms)`);

console.log('test_perf PASSED');
