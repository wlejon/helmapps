// When tracking loses the subject (here it jumps far between two frames),
// that frame and the ones carried from it are marked; going to the frame
// asks for a click, the click sets its subject and tracking carries on from
// there, so the burst can be exported. Then playback: Space plays and
// pauses, the arrows step.

import { app, waitFor, eq, press } from '/lib/test.js';
import { burstTree, defaultBurst, useKeyModel, pickSubject } from '/app/tests/burst.js';
import { apply, invert } from '/app/js/burst/affine.js';
import { fixtureDir, clickEl } from '/lib/test.js';

const path = require('path');

// One burst of eight, the subject jumping 260 px right and 120 px down at frame 6.
const frames = defaultBurst(8, 0).map((f, k) => ({ ...f, subject: k >= 5 ? [f.subject[0] + 260, f.subject[1] + 120] : f.subject }));
const dir = fixtureDir(burstTree(frames));
const names = frames.map((f) => f.name);
app.openPath(path.join(dir, names[0]));
waitFor(() => app.state.pic && !app.state.pic.placeholder && app.state.pic.path.endsWith(names[0]), 'the first photo');
waitFor(() => app.strip.items.length === 8, 'the strip lists the burst');
useKeyModel();
pickSubject(frames[0].subject);
waitFor(() => app.strip.selection.size === 8, 'the whole burst is selected (one burst)');
press('b');
const s = app.burst.session;
const view = app.burst.view;
waitFor(() => app.burst.active && !s.busy && s.frames.every((f) => f.status !== 'pending' && f.status !== 'tracking'), 'tracking ran', 60000);
const statuses = () => s.frames.map((f) => f.status);
eq(statuses().slice(0, 5).every((x) => x === 'ok' || x === 'seed'), true, `held up to the jump (${statuses().join(' ')})`);
eq(statuses().slice(5).join(), 'lost,lost,lost', 'lost from the jump on');
assert(!view.canExport(), 'no export while frames are lost');
assert(/need a look/.test(document.querySelector('.statusbar').textContent), 'the status bar says frames need a look');
const badge = document.querySelector('.iv-burst-row .vgrid-cell[data-index="5"] .iv-burst-badge');
eq(badge && badge.textContent, 'Click subject', 'the lost frame\'s badge');

// Go to the frame: it asks for a click; click the subject where it is now.
view.go(5);
assert(view.correcting, 'a lost frame asks for the subject');
assert(!view.hint.classList.contains('hidden'), 'with a hint');
const V = view.viewMatrix();
const q = apply(invert(view.T[5]), frames[5].subject);          // frame 6 -> stabilized
const [x, y] = apply(V, q);
const r = view.stage.getBoundingClientRect();
click(r.left + x, r.top + y, 0);
waitFor(() => !s.busy && s.ready(), 'the click re-seeds and tracking carries on', 60000);
eq(statuses()[5], 'seed', 'the frame clicked is the user\'s');
assert(statuses().slice(6).every((x) => x === 'ok'), `the rest tracked from it (${statuses().join(' ')})`);
const c5 = s.frames[5].track.centroid;
assert(Math.hypot(c5[0] - frames[5].subject[0], c5[1] - frames[5].subject[1]) < 1, `on the subject (${c5.map((v) => v.toFixed(1))})`);
waitFor(() => view.canExport(), 'export is possible again');

// Playback: Space plays (frames advance on their own), Space pauses, the arrows step.
view.go(0);
press('space');
assert(view.playing, 'Space plays');
const seen = new Set();
waitFor(() => { seen.add(view.cur); return seen.size >= 4; }, 'the frames advance while playing');
press('space');
assert(!view.playing, 'Space pauses');
const at = view.cur;
press('right');
eq(view.cur, (at + 1) % 8, 'Right steps a frame');
press('left');
eq(view.cur, at, 'Left steps back');

console.log('test_burst_correct PASSED');
