// The crop on the stabilized burst: it stays inside the area every included
// frame covers (asked for more, it gets the most of it that fits), keeps the
// chosen aspect, moves and sizes by dragging on the stage, and leaving a
// frame out widens the area it may use.

import { app, waitFor, eq, drag } from '/lib/test.js';
import { openBurst } from '/app/tests/burst.js';
import { rectInConvex, area, apply } from '/app/js/burst/affine.js';
import { aspectRatio } from '/app/js/burst/stabilize.js';

const { frames } = openBurst();
const view = app.burst.view;
const inside = (what) => assert(rectInConvex(view.crop, view.poly, 1e-3), `${what}: crop ${view.crop.map((v) => v.toFixed(1))} inside the common area`);

// The common area: smaller than a frame (the frames moved), inside the reference.
const W = frames.length && app.burst.session.frames[0].width, H = app.burst.session.frames[0].height;
const a0 = area(view.poly);
assert(a0 > 0.5 * W * H && a0 < W * H - 1000, `the common area is the overlap (${Math.round(a0)} of ${W * H})`);
inside('the default crop');
const r1 = aspectRatio('1:1');
assert(Math.abs(view.crop[2] / view.crop[3] - r1) < 1e-6, 'the default crop is 1:1');

// Asked for the whole frame and more: the largest of it inside the area.
view.setCrop([-200, -200, W + 400, H + 400]);
inside('asked for everything');
assert(view.crop[2] * view.crop[3] > 0.4 * a0, `and it is most of the area (${Math.round(view.crop[2] * view.crop[3])})`);

// Each aspect preset: that shape, inside.
for (const v of ['4:5', '3:2', '16:9', '1:1']) {
  view.panel.on.aspect(v);
  eq(app.settings.get('burstAspect'), v, `${v} is remembered`);
  assert(Math.abs(view.crop[2] / view.crop[3] - aspectRatio(v)) < 1e-3, `${v}: ${view.crop[2].toFixed(1)} x ${view.crop[3].toFixed(1)}`);
  inside(v);
}

// Free: a drag on a corner sizes it in any shape; a drag inside moves it.
view.panel.on.aspect('free');
view.setCrop([300, 200, 300, 200]);
const st = view.stage.getBoundingClientRect();
const V = view.viewMatrix();
const screen = (q) => { const [x, y] = apply(V, q); return [st.left + x, st.top + y]; };
const before = view.crop.slice();
drag(screen([450, 300]), screen([500, 330]));
assert(Math.abs(view.crop[0] - (before[0] + 50)) < 2 && Math.abs(view.crop[1] - (before[1] + 30)) < 2,
  `dragged inside, it moved (${view.crop.map((v) => v.toFixed(1))})`);
eq(Math.round(view.crop[2]) + 'x' + Math.round(view.crop[3]), '300x200', 'at the same size');
const c0 = view.crop.slice();
drag(screen([c0[0] + c0[2], c0[1] + c0[3]]), screen([c0[0] + c0[2] + 60, c0[1] + c0[3] + 20]));
assert(Math.abs(view.crop[2] - (c0[2] + 60)) < 3 && Math.abs(view.crop[3] - (c0[3] + 20)) < 3,
  `dragged by its corner, it grew (${view.crop.map((v) => v.toFixed(1))})`);
eq(Math.round(view.crop[0]) + ',' + Math.round(view.crop[1]), `${Math.round(c0[0])},${Math.round(c0[1])}`, 'from the opposite corner');
// Dragged far past the edge, it stops at the area's edge.
drag(screen([view.crop[0] + 20, view.crop[1] + 20]), screen([view.crop[0] - 900, view.crop[1] + 20]));
inside('dragged past the edge');

// Leaving out the frame that moved most widens the area.
view.setIncluded(frames.length - 1, false);
const a1 = area(view.poly);
assert(a1 > a0 + 100, `without the last frame the area grows (${Math.round(a0)} -> ${Math.round(a1)})`);
view.setIncluded(frames.length - 1, true);
inside('the frame back in');

console.log('test_burst_crop PASSED');
