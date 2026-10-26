// Find Animals over a big card stays responsive: 1500 photos in bursts,
// answers landing one by one (the test stub stands in for the models;
// decoding, the records and regrouping the bursts are the real ones) while a
// photo is open with the strip and the details showing. Every frame stays
// short however many photos are analysed already, and a photo's names are
// worked out again only when its record, its burst or her answer changed:
// bro.vision.wildlife.labels() is called O(n) times over the whole run, not
// once a photo a result (which made the 300th result cost 400 ms a frame).

import { app, waitFor, eq, fixtureDir, timeFrame } from '/lib/test.js';
import { stubTable, scene, JAY, CARDINAL, TABLE } from '/app/tests/wildlife.js';
import { datedJpeg } from '/app/tests/burst.js';
import { shown } from '/app/tests/images.js';

const path = require('path');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.labels !== 'function') {
  skipTest('this bro has no bro.vision.wildlife');
} else run();

function run() {
const N = Number(process.env.IV_PERF_N || 1500);
const BURST = 6;                // frames a burst, 0.2 s apart; bursts 3 s apart
const FRAME_BUDGET_MS = process.env.CI ? 60 : 35;   // ~15 ms a frame here throughout (it was 30 ms at the start, 130 ms by the end)
const w = 96, h = 72;
// Three scenes: a jay, a cardinal, nothing (every sixth burst is empty).
const scenes = [JAY, CARDINAL, null].map((a) => scene(w, h, a ? [{ color: a.color, at: [w / 2, h / 2], r: 14 }] : []));
let t0 = perf.now();
const tree = {};
for (let i = 0; i < N; i++) {
  const b = Math.floor(i / BURST), f = i % BURST;
  const s = b % 6 === 5 ? 2 : b % 2;
  tree[`p_${String(i).padStart(4, '0')}.jpg`] = datedJpeg(scenes[s], w, h, b * 3 + f * 0.2, 80);
}
const dir = fixtureDir(tree);
console.log(`fixture: ${N} photos in ${(perf.now() - t0).toFixed(0)} ms`);

// Count every labels() call the app makes.
const wl = bro.vision.wildlife;
const labelsOf = wl.labels;
let calls = 0;
wl.labels = function (...args) { calls++; return labelsOf.apply(this, args); };

app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === N, 'the folder', 30000);
const first = path.join(dir, 'p_0000.jpg');
app.openImage(first);
shown(app, waitFor, 'p_0000.jpg');
if (!app.settings.get('showDetails')) app.commands.run('details');
advanceTime(16);

const W = app.wildlife;
const a = W.analysis;
W.useStub(stubTable(TABLE));
// Frames while the answers land: the worst one in each tenth of the run, so a climb shows.
const tenths = Array.from({ length: 10 }, () => 0);
let k = 0;
// What must not grow with the photos analysed so far (each tenth: total ms, calls):
// regrouping the bursts (it sorted every record each time), and a message to a
// worker (relaying a photo's pixels detached a buffer, and bronze walked the
// page's whole heap for its views: 0.4 ms a message at the start, 0.7 by the end).
const timed = (obj, name, into) => {
  const f = obj[name];
  obj[name] = function (...args) {
    const t = perf.now();
    try { return f.apply(this, args); } finally { into[k].ms += perf.now() - t; into[k].n++; }
  };
  return () => { obj[name] = f; };
};
const perTenth = () => Array.from({ length: 10 }, () => ({ ms: 0, n: 0 }));
const regroups = perTenth(), posts = perTenth();
const untimeRegroup = timed(a, 'regroup', regroups);
const untimePost = timed(Worker.prototype, 'postMessage', posts);
let frames = 0, worst = 0;
const end = Date.now() + 300000;
let done = false;
while (Date.now() < end) {
  k = Math.min(9, Math.floor((a.results.size / N) * 10));
  const dt = timeFrame();
  frames++;
  if (dt > tenths[k]) tenths[k] = dt;
  if (dt > worst) worst = dt;
  if (a.state === 'done' && a.results.size === N && !a.groupTimer) { done = true; break; }
  wallSleep(2);
}
assert(done, `every photo analysed (${a.results.size} of ${N})`);
// What the last results' frames left to draw.
for (let i = 0; i < 4; i++) worst = Math.max(worst, timeFrame());
console.log(`Find Animals over ${N} photos: ${frames} frames, worst ${worst.toFixed(1)} ms; worst a tenth: ` +
  `${tenths.map((x) => x.toFixed(0)).join(' ')} ms; labels() ${calls} calls (${(calls / N).toFixed(2)} a photo)`);
eq(app.state.path, first, 'the photo stays on screen');
assert(a.bursts.length > N / BURST / 2, `bursts grouped (${a.bursts.length})`);
assert(W.answerOf(first).labels.length > 0, 'the photo on screen is named');
assert(calls < 3 * N, `labels() is worked out O(n) times: ${calls} calls for ${N} photos`);
assert(worst < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while answers land (worst ${worst.toFixed(1)}; a tenth: ${tenths.map((x) => x.toFixed(0)).join(' ')})`);
untimeRegroup();
untimePost();
// Flat: the last third of the results costs what the first did (the first tenth
// left out: the folder and the workers start there). A regroup was 1.5 ms over
// tenths 2-4 and 2.8 ms over 8-10 here (O(n log n) each time); now about 1 ms throughout.
const mean = (xs, from, to) => {
  let ms = 0, n = 0;
  for (let i = from; i < to; i++) { ms += xs[i].ms; n += xs[i].n; }
  return n ? ms / n : 0;
};
const show = (xs) => xs.map((x) => (x.n ? x.ms / x.n : 0).toFixed(2)).join(' ');
console.log(`regroup ms a call, a tenth: ${show(regroups)}; postMessage ms a call: ${show(posts)}`);
const early = mean(regroups, 1, 4), late = mean(regroups, 7, 10);
assert(late <= early * 1.4 + 0.2, `regrouping does not grow with the records: ${late.toFixed(2)} ms a call over the last third, ${early.toFixed(2)} over the first (a tenth: ${show(regroups)})`);
const worstPost = Math.max(...posts.map((x) => (x.n ? x.ms / x.n : 0)));
assert(worstPost < 0.25, `a message to a worker does not cost the page's heap: ${worstPost.toFixed(2)} ms a call at worst (a tenth: ${show(posts)})`);
wl.labels = labelsOf;

// The bursts kept up result by result are the ones grouping every record at once makes.
const membersOf = () => new Map([...a.byPath].map(([p, b]) => [p, b.photos.join('\n')]));
const kept = membersOf();
a.landed = null;
a.regroup();
const whole = membersOf();
eq(kept.size, whole.size, 'as many photos in bursts as a whole regroup puts in them');
let differ = 0;
for (const [p, m] of whole) if (kept.get(p) !== m) differ++;
eq(differ, 0, 'every photo in the burst a whole regroup puts it in');

console.log('test_animals_perf PASSED');
}
