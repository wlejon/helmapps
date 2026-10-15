// Radio on a fake backend (no models): the empty state, the atlas, axes,
// going somewhere, a path ahead timed at chunk boundaries, hysteresis while
// wandering, the trail, knobs, and resume (briefs/radio.md acceptance 1-4, 7).

import { app, waitFor, eq, press } from '/lib/test.js';
import { fakeBackend } from '/app/tests/fake_backend.js';

const RATE = 48000;

// With no models (a fresh BRO_APP_HOME, no BRO_MODELS) the radio says so.
if (app.state.phase === 'missing') {
  assert(document.querySelector('.radio-blank .empty-title').textContent.includes('needs its models'), 'the missing-models state');
  assert(document.querySelector('.radio-blank .empty-hint').textContent.includes('Looked in'), 'it says where it looked');
} else {
  console.log(`test_ui: models present here (phase ${app.state.phase}); the empty state is not checked`);
}

const be = fakeBackend();
app.useBackend(be);
waitFor(() => app.state.phase === 'ready', 'the map');
const anchors = app.state.anchors;
eq(anchors.length, 120, 'the shipped anchors');
assert(anchors.every((a) => Math.abs(a.x) <= 1 && Math.abs(a.y) <= 1), 'anchors fill [-1, 1]');
assert(app.state.listener && app.state.owner >= 0, 'the listener starts on an anchor');
waitFor(() => app.view.size.w > 0, 'the map has a size');

// Changing the axes re-projects the anchors.
const before = anchors.map((a) => [a.x, a.y]);
assert(document.querySelector('.toolbar .select'), 'the axes picker');
eq(app.settings.get('axes'), 'pca', 'principal axes by default');
app.setAxes('mood');
assert(anchors.some((a, i) => Math.abs(a.x - before[i][0]) > 1e-6), 'the anchors move with the axes');
eq(app.settings.get('axes'), 'mood', 'the choice is kept');

// Play: audio flows, the now strip names the place, chunks start.
press('space');
eq(app.state.playing, true, 'Space plays');
waitFor(() => app.state.radio.playhead > 2 * RATE, 'two seconds played', 15000);
const startTag = be.stream.target.tag;
eq(startTag, `a${app.state.owner}`, 'the stream starts at the listener\'s anchor');
waitFor(() => document.querySelector('.radio-now-name').textContent === anchors[app.state.owner].label, 'the now strip names it');

// Go somewhere far: one target, at the anchor nearest the click.
const here = anchors[app.state.owner];
const far = anchors.reduce((b, a) => (Math.hypot(a.x - here.x, a.y - here.y) > Math.hypot(b.x - here.x, b.y - here.y) ? a : b));
const nTargets = () => be.calls.filter((c) => c.kind === 'setTarget').length;
const t0 = nTargets();
app.goTo(far.x, far.y);
eq(nTargets(), t0 + 1, 'a click makes one target');
eq(be.calls.filter((c) => c.kind === 'setTarget').pop().arg.tag, `a${far.id}`, 'at the nearest anchor');
waitFor(() => document.querySelector('.radio-now-next').textContent.includes(far.label), 'the strip says when it is heard');

// The trail: each played chunk lands where CLAP (here the fake) hears it.
waitFor(() => app.state.trail.length >= 2, 'two chunks on the trail', 60000);
waitFor(() => app.state.trail.some((t) => t.heard === far.id), 'the new place on the trail', 60000);

// A path of three points: three timed targets, in order, LEG_SECONDS apart from the open chunk.
const pts = [anchors[3], anchors[40], anchors[90]];
for (const a of pts) app.addWaypoint(a.x, a.y);
const lastPath = be.calls.filter((c) => c.kind === 'setPath').pop().arg;
eq(lastPath.map((p) => p.tag), pts.map((a) => `a${a.id}`), 'three targets in order');
const open = app.state.radio.openSeconds();
eq(lastPath.map((p) => Math.round(p.at - lastPath[0].at)), [0, 20, 40], 'one every 20 s');
assert(Math.abs(lastPath[0].at - open) < 10.01, `the first from the open chunk (${lastPath[0].at} vs ${open})`);
press('escape');
eq(app.state.path.length, 0, 'Escape clears the path');
eq(be.calls.filter((c) => c.kind === 'setPath').pop().arg.length, 0, 'and the stream\'s');

// Wandering: a drag back and forth across a border makes at most one style change.
const a = anchors[10];
const b = anchors.filter((x) => x.id !== a.id).reduce((m, x) => (Math.hypot(x.x - a.x, x.y - a.y) < Math.hypot(m.x - a.x, m.y - a.y) ? x : m));
app.goTo(a.x, a.y);
const t1 = nTargets();
const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
const dx = (b.x - a.x) * 0.06, dy = (b.y - a.y) * 0.06;
for (let i = 0; i < 6; i++) {
  app.wander(mid.x + dx, mid.y + dy, false);
  app.wander(mid.x - dx, mid.y - dy, false);
}
app.wander(mid.x + dx, mid.y + dy, true);
waitFor(() => true, 'settle');
assert(nTargets() - t1 <= 1, `at most one style change across a border (${nTargets() - t1})`);
// Inside one anchor's neighbourhood: no style change at all.
const t2 = nTargets();
const own = anchors[app.state.owner];
app.wander(own.x + 0.005, own.y, false);
app.wander(own.x - 0.005, own.y, true);
eq(nTargets(), t2, 'a drag within the neighbourhood changes no style');

// Knobs go to the stream.
eq(document.querySelectorAll('.radio-knob').length, 3, 'three knobs');
app.setKnob('density', 0.5);
waitFor(() => be.calls.some((c) => c.kind === 'setKnobs' && c.arg.density === 0.5), 'the knob reaches the stream', 3000);
eq(app.settings.get('knobs').density, 0.5, 'and is saved');

// Pause stops the playhead.
press('space');
eq(app.state.playing, false, 'Space pauses');
const ph = app.state.radio.playhead;
waitFor(() => true, 'a frame');
for (let i = 0; i < 30; i++) advanceTime(16);
eq(app.state.radio.playhead, ph, 'paused, the playhead holds');

// Resume: the listener, its anchor and the trail are saved.
waitFor(() => (app.settings.get('trail') || []).length >= 2, 'the trail saved', 5000);
eq(app.settings.get('owner'), app.state.owner, 'the anchor saved');
const L = app.settings.get('listener');
assert(L && Math.abs(L.x - app.state.listener.x) < 1e-9, 'the listener saved');

console.log('test_ui PASSED');
