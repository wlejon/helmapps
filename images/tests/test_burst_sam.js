// The real subject model on a synthetic burst: SAM (or SAM 2.1) from
// bro.models segments the clicked disc and tracks it through the frames.
// Skips where this machine has no weights (bro.models finds none) or this
// bro has no bro.vision.

import { app, waitFor, eq, press, clickEl, fixtureDir } from '/lib/test.js';
import { burstTree, defaultBurst, pickSubject, withoutAnimals } from '/app/tests/burst.js';
import { findModelSpec } from '/app/js/burst/session.js';

const path = require('path');

const spec = findModelSpec();
if (!spec) skipTest(`no segmentation weights in bro.models (${typeof bro !== 'undefined' && bro.models ? bro.models.dirs.join(', ') : 'no bro.models'})`);
else run();

function run() {
console.log(`model: ${spec.name} (${spec.kind}) from ${spec.dir}`);

const frames = defaultBurst(5, 0);
const r = 36;
const dir = fixtureDir(burstTree(frames, { r }));
const names = frames.map((f) => f.name);
withoutAnimals();
app.openPath(path.join(dir, names[0]));
waitFor(() => app.state.pic && !app.state.pic.placeholder && app.state.pic.path.endsWith(names[0]), 'the first photo');
waitFor(() => app.strip.items.length === names.length, 'the strip lists the burst');

const t0 = Date.now();
const track = pickSubject(frames[0].subject);
console.log(`segment: ${Date.now() - t0} ms, area ${Math.round(track.area)} (disc ${Math.round(Math.PI * r * r)})`);
const disc = Math.PI * r * r;
assert(track.area > 0.7 * disc && track.area < 1.4 * disc, `the mask is the disc (${Math.round(track.area)} px)`);
assert(Math.hypot(track.centroid[0] - frames[0].subject[0], track.centroid[1] - frames[0].subject[1]) < 3,
  `centred on it (${track.centroid.map((v) => v.toFixed(1))})`);

waitFor(() => app.strip.selection.size === names.length, 'the burst is selected');
press('b');
const s = app.burst.session;
waitFor(() => app.burst.active && s.ready(), 'every frame tracked', 120000);
console.log(`steps: ${s.timings.step.join(' ')} ms; confidence ${s.frames.map((f) => f.track.confidence.toFixed(2)).join(' ')}`);
s.frames.forEach((f, k) => {
  const c = f.track.centroid;
  const err = Math.hypot(c[0] - frames[k].subject[0], c[1] - frames[k].subject[1]);
  assert(err < 3, `frame ${k + 1} tracked onto the disc (off by ${err.toFixed(1)} px)`);
  assert(f.status === 'ok' || f.status === 'seed', `frame ${k + 1} confident (${f.status})`);
});
eq(document.querySelector('.iv-bp-model').textContent.startsWith('Subject found with SAM'), true, 'the panel names the model');

console.log('test_burst_sam PASSED');
}
