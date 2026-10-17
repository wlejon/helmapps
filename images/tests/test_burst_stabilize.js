// Stabilize a synthetic burst and measure the exported animation: the camera
// pans (the background moves by known offsets) and the subject flies (by
// others), across two bursts with a gap. With the subject held, the subject
// stays put in every exported frame to within 1 px; with the scene held, the
// background's marker does, and the subject moves as it moved over the
// ground. The lock is an app setting: the last one used comes back.

import { app, waitFor, eq, press } from '/lib/test.js';
import { openBurst, exportTo, centroidOf } from '/app/tests/burst.js';

const path = require('path');

const { dir, frames } = openBurst();
const view = app.burst.view;
eq(view.model().statuses.filter((s) => s === 'ok' || s === 'seed').length, frames.length,
  `every frame tracked with confidence (${view.model().statuses.join(' ')})`);
eq(view.lock, 'subject', 'subject lock by default');
assert(document.querySelectorAll('.iv-tl .iv-tl-cell').length === frames.length, 'a cell per frame in the timeline');

/** The exported GIF's frames: where a colour's centroid is in each. */
function measure(file, what) {
  const dec = bro.image.openFrames(file);
  assert(dec, `${path.basename(file)} decodes`);
  const out = [];
  for (let f = dec.next(); f; f = dec.next()) out.push(centroidOf(f.pixels, dec.width, dec.height, what));
  dec.close();
  return out;
}
function spread(points) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

// A square crop holding the subject and, in the reference, the marker; output 1:1 (400 px).
view.setCrop([150, 100, 400, 400]);
eq(view.crop.join(), [150, 100, 400, 400].join(), 'the crop is inside the common area');
eq(view.outputSize().width, 400, 'output at the crop\'s own size');

if (typeof GifEncoder !== 'function') {
  skipTest('GifEncoder is compiled out of this build');
} else {
  // Subject held.
  const subjectGif = path.join(dir, 'subject.gif');
  exportTo(subjectGif);
  const s1 = measure(subjectGif, 'subject');
  eq(s1.length, frames.length, 'one GIF frame per photo');
  assert(s1.every((p) => p.n > 2000), `the subject is in every frame (${s1.map((p) => p.n).join(' ')})`);
  const subjectSpread = spread(s1);
  console.log(`subject lock: subject centroid spread ${subjectSpread.toFixed(2)} px over ${s1.length} frames`);
  assert(subjectSpread <= 1, `the subject holds still within 1 px (${subjectSpread.toFixed(2)})`);

  // Scene held: L toggles the lock (and the setting).
  press('l');
  eq(view.lock, 'scene', 'L holds the scene');
  eq(app.settings.get('burstLock'), 'scene', 'remembered as an app setting');
  view.setCrop([150, 100, 400, 400]);
  eq(view.crop.join(), [150, 100, 400, 400].join(), 'the same crop fits the scene lock');
  const sceneGif = path.join(dir, 'scene.gif');
  exportTo(sceneGif);
  const m2 = measure(sceneGif, 'marker');
  assert(m2.every((p) => p.n > 200), `the marker is in every frame (${m2.map((p) => p.n).join(' ')})`);
  const markerSpread = spread(m2);
  const s2 = measure(sceneGif, 'subject');
  console.log(`scene lock: marker spread ${markerSpread.toFixed(2)} px; subject travels ${spread(s2).toFixed(1)} px`);
  assert(markerSpread <= 1, `the scene holds still within 1 px (${markerSpread.toFixed(2)})`);
  // Over the ground the subject moved by its own motion less the camera's: frame 0 to the last.
  const f0 = frames[0], fz = frames[frames.length - 1];
  const wantDx = (fz.subject[0] - fz.bg[0]) - (f0.subject[0] - f0.bg[0]);
  const wantDy = (fz.subject[1] - fz.bg[1]) - (f0.subject[1] - f0.bg[1]);
  const got = [s2[s2.length - 1].x - s2[0].x, s2[s2.length - 1].y - s2[0].y];
  assert(Math.abs(got[0] - wantDx) <= 1 && Math.abs(got[1] - wantDy) <= 1,
    `the subject moves over the ground as it flew (${got.map((v) => v.toFixed(1))} vs ${wantDx}, ${wantDy})`);

  // The lock comes back the next time.
  press('escape');
  eq(app.state.mode, 'image', 'Escape closes the stabilize view');
  press('b');
  waitFor(() => app.burst.active && app.burst.session.ready() && view.crop, 'open again');
  eq(view.lock, 'scene', 'the last lock used');

  console.log('test_burst_stabilize PASSED');
}
