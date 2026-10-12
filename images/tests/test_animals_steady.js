// Nothing moves under her while Find Animals works: with a photo open, its
// animal's picker open and the other photos' answers landing, the photo, its
// outline and the picker stay exactly where they are (no pan, no re-fit, no
// outline made again under the pointer), and the field keeps the focus.

import { app, waitFor, clickEl, fixtureDir } from '/lib/test.js';
import { stubTable, scene, JAY, CARDINAL, TABLE } from '/app/tests/wildlife.js';
import { datedJpeg } from '/app/tests/burst.js';
import { shown } from '/app/tests/images.js';

const path = require('path');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.labels !== 'function') {
  skipTest('this bro has no bro.vision.wildlife');
} else run();

function run() {
// Bursts of a jay, a cardinal, nothing (photos without animals leave the strip as they are found).
const N = 400, BURST = 4, OPEN = 'p_0100.jpg';
const w = 320, h = 240;
const scenes = [JAY, CARDINAL, null].map((a) => scene(w, h, a ? [{ color: a.color, at: [w / 2, h / 2], r: 40 }] : []));
const tree = {};
for (let i = 0; i < N; i++) {
  const b = Math.floor(i / BURST), f = i % BURST;
  tree[`p_${String(i).padStart(4, '0')}.jpg`] = datedJpeg(scenes[b % 3], w, h, b * 3 + f * 0.2, 80);
}
const dir = fixtureDir(tree);
const first = path.join(dir, OPEN);

app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === N, 'the folder');
app.openImage(first);
shown(app, waitFor, OPEN);
if (!app.settings.get('showDetails')) app.commands.run('details');
advanceTime(16);

const W = app.wildlife;
const a = W.analysis;
const O = W.outlines;
W.useStub(stubTable(TABLE));
// The photo on screen answered, then a pause while the picker opens: most of the folder still to come.
waitFor(() => a.record(first) && O.state().boxes.length === 1, 'the photo on screen analysed, its outline');
a.pause();
waitFor(() => !a.inflight.size, 'the photos in flight landed');
const left = N - a.results.size;
assert(left > N / 2, `most of the folder still to analyse (${left})`);
const stripCell = () => Array.from(app.strip.pool.values()).find((c) => c._path === first) || null;
assert(stripCell(), 'the photo\'s thumbnail in the strip');
clickEl(document.querySelector('.iv-outlines .iv-outline'));
waitFor(() => O.state().picker, 'the picker');
const field = document.querySelector('.iv-picker .combobox-input');
assert(document.activeElement === field, 'the field has the focus');

const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 10) / 10).join(' '); };
const outlineEl = document.querySelector('.iv-outlines .iv-outline');
const where = () => ({
  stage: rect(app.viewer.el),
  matrix: Array.from(app.viewer.pictureMatrix()).map((x) => Math.round(x * 100) / 100).join(' '),
  outline: rect(outlineEl),
  picker: rect(document.querySelector('.iv-picker')),
  strip: stripCell() ? rect(stripCell()) : 'none',
});
const before = where();

a.resume();
let frames = 0, moved = null;
const end = Date.now() + 60000;
while (Date.now() < end && !(a.state === 'done' && a.results.size === N && !a.groupTimer)) {
  advanceTime(16);
  frames++;
  const now = where();
  for (const k of Object.keys(before)) {
    if (!moved && now[k] !== before[k]) moved = `${k} moved at ${a.results.size} of ${N}: ${before[k]} -> ${now[k]}`;
  }
  wallSleep(2);
}
advanceTime(16);
assert(a.state === 'done' && a.results.size === N, `every photo analysed (${a.results.size} of ${N})`);
assert(!moved, moved || '');
const after = where();
for (const k of Object.keys(before)) assert(after[k] === before[k], `${k} where it was: ${before[k]} -> ${after[k]}`);
assert(O.state().picker, 'the picker still open');
assert(document.querySelector('.iv-outlines .iv-outline') === outlineEl, 'the outline the same element (the pointer over it stays over it)');
assert(document.activeElement === field, 'the field keeps the focus');
console.log(`${N - left} photos analysed before the picker opened, ${left} while it was open, over ${frames} frames`);

console.log('test_animals_steady PASSED');
}
