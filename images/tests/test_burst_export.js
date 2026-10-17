// Export a stabilized burst: the timing (the gap trimmed to the hold, the
// speed, a frame's own hold, a frame removed) reaches the file; the
// save dialog suggests the photos' folder and a name from the first and last
// photo; the GIF carries one frame per photo with the scheduled delays; the
// WebM is at 30 fps with frames repeated to the same timing.

import { app, waitFor, eq, press, mod } from '/lib/test.js';
import { openBurst } from '/app/tests/burst.js';
import { gifDelays, repeatCounts } from '/app/js/burst/timing.js';

const fs = require('fs');
const path = require('path');

const { dir, frames, names } = openBurst();
const view = app.burst.view;
const near = (a, b, what, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// As shot: 0.1 s steps; the 1.2 s gap between the bursts trimmed to the 0.1 s hold.
let t = view.timeline();
eq(t.frames.length, 8, 'every frame in the animation');
near(t.realElapsed, 1.8, 'shot over 1.8 s', 0.011);
near(t.total, 0.8, 'plays 0.8 s (gap trimmed)', 0.011);
eq(t.frames.filter((f) => f.gap).map((f) => f.index).join(), '3', 'the gap is after the fourth frame');
const times = document.querySelector('.iv-bp-summary').textContent;
assert(/8 frames/.test(times) && /1\.80 s/.test(times) && /0\.80 s/.test(times), `the panel says so: ${times}`);

// The gap held 0.3 s (its own hold) and 2x speed: steps 0.05 s, the gap 0.15 s.
view.setHolds([3], 0.3);
view.tl.speedSel.onChange(2);
eq(app.settings.get('burstSpeedPct'), 200, 'the speed is a setting');
t = view.timeline();
near(t.frames[3].duration, 0.15, 'the gap at its hold / speed', 1e-9);
near(t.frames[1].duration, 0.05, 'a step at half its time', 1e-3);
// Frame 2 held 1 s (0.5 s at 2x); frame 6 removed with Delete.
view.setHolds([1], 1);
view.go(5);
press('delete');
assert(!app.burst.session.frames[5].included, 'Delete takes the frame out');
assert(!document.querySelector('.iv-tl-cell[data-index="5"]'), 'and out of the timeline');
t = view.timeline();
eq(t.frames.map((f) => f.index).join(), '0,1,2,3,4,6,7', 'the frame removed is not in the animation');
near(t.frames[1].duration, 0.5, 'the frame\'s own hold, at the speed');
near(t.total, 0.05 + 0.5 + 0.05 + 0.15 + 0.1 + 0.05 + 0.05, 'the total (frame 5 to 7 is 0.2 s as shot)', 2e-3);
const delays = gifDelays(t);
const repeats = repeatCounts(t, 30);
console.log(`delays ${delays.join(' ')} cs; repeats at 30 fps ${repeats.join(' ')}`);
eq(delays.join(), '5,50,5,15,10,5,5', 'GIF delays');

if (typeof GifEncoder !== 'function' || typeof VideoEncoder !== 'function') {
  skipTest('GifEncoder / VideoEncoder is compiled out of this build');
} else {
  // The save dialog suggests the photos' folder and a name from the first and
  // last photo; with nothing queued, headless accepts the suggestion.
  const gifOut = path.join(dir, 'burst_01-08.gif');
  press(`${mod}+e`);
  waitFor(() => view.exporting, 'the export starts');
  assert(!document.querySelector('.iv-burst-progress').classList.contains('hidden'), 'progress shows');
  waitFor(() => !view.exporting, 'the GIF is written', 120000);
  assert(fs.existsSync(gifOut), `written where the dialog suggested: ${gifOut}`);
  assert(document.querySelector('.iv-burst-progress').classList.contains('hidden'), 'progress hides');

  const dec = bro.image.openFrames(gifOut);
  assert(dec, 'the GIF decodes');
  eq(dec.frameCount, 7, 'one GIF frame per included photo');
  eq(dec.width + 'x' + dec.height, `${view.outputSize().width}x${view.outputSize().height}`, 'at the output size');
  eq(dec.delays.map((ms) => Math.round(ms / 10)).join(), delays.join(), 'the GIF\'s delays are the schedule\'s');
  dec.close();

  // WebM through the real dialog path (headless answers with the queued path).
  view.panel.on.format('webm');
  eq(app.settings.get('burstFormat'), 'webm', 'the format is a setting');
  const webmOut = path.join(dir, 'out.webm');
  setPickedFiles([webmOut]);
  press(`${mod}+e`);
  waitFor(() => view.exporting, 'the WebM export starts');
  waitFor(() => !view.exporting, 'the WebM is written', 120000);
  assert(fs.existsSync(webmOut) && fs.statSync(webmOut).size > 1000, 'the WebM has content');
  const v = document.createElement('video');
  v.muted = true;
  document.body.appendChild(v);
  v.src = webmOut;
  flush();
  assert(v.readyState >= 1, `the WebM loads (readyState ${v.readyState})`);
  const total = repeats.reduce((a, b) => a + b, 0);
  near(v.duration, total / 30, 'WebM duration: the repeated frames at 30 fps', 0.034);
  let pictures = 1;
  while (pictures < 200 && v.stepFrame(1) > 0) pictures++;
  eq(pictures, total, 'WebM pictures');
  v.remove();

  console.log('test_burst_export PASSED');
}
