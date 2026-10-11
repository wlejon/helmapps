// The burst's timing numbers (js/burst/timing.js): EXIF times with
// sub-seconds and offsets, bursts cut at gaps (over 0.4 s, or over 3x the
// typical step), gaps trimmed to the hold, the speed, a frame's own hold, a
// frame left out, and the GIF delays and WebM repeats that keep it exact.

import { eq } from '/lib/test.js';
import { exifSeconds, bursts, schedule, gifDelays, repeatCounts, fillTimes } from '/app/js/burst/timing.js';
import { datedJpeg, framePixels } from '/app/tests/burst.js';

const near = (a, b, what, tol = 1e-9) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// EXIF: sub-seconds, and an offset moves the instant.
near(exifSeconds('2026-05-01T10:00:46.24') - exifSeconds('2026-05-01T10:00:46.00'), 0.24, 'sub-seconds', 1e-6);
near(exifSeconds('2026-05-01T10:00:00+02:00') - exifSeconds('2026-05-01T10:00:00Z'), -7200, 'an offset', 1e-6);
assert(Number.isNaN(exifSeconds('')), 'no date is NaN');
// The tests' dated JPEGs read back to the hundredth.
const jpg = datedJpeg(framePixels(32, 24, { bg: [0, 0], subject: [10, 10], r: 4 }), 32, 24, 46.24);
const exif = bro.image.readExif(jpg);
near(exifSeconds(exif.dateTaken) - exifSeconds('2026-05-01T10:00:00'), 46.24, `EXIF date read back (${exif.dateTaken})`, 1e-6);
// Unknown times are filled from the neighbours.
eq(fillTimes([1, NaN, NaN, 2]).map((t) => t.toFixed(1)).join(), '1.0,1.1,1.2,2.0', 'filled times');

// Bursts: the robin's five (0.1 s steps; gaps of seconds).
const robin = [46.24, 46.34, 51.17, 51.27, 51.36, 54.22, 54.32, 56.6, 56.7, 56.8, 56.9, 57.0, 57.04, 58.98];
eq(JSON.stringify(bursts(robin)), '[[0,1],[2,4],[5,6],[7,12],[13,13]]', 'five bursts');
// A step 3x the typical one is a gap even under 0.4 s.
eq(JSON.stringify(bursts([0, 0.05, 0.1, 0.15, 0.35, 0.4])), '[[0,3],[4,5]]', 'a 0.2 s step among 0.05 s ones');

// The schedule: steps as shot, gaps trimmed to the hold, the last frame a typical step.
const fr = (times) => times.map((time) => ({ time, included: true, hold: null }));
let s = schedule(fr(robin), { hold: 0.1, speed: 1 });
eq(s.frames.length, 14, 'every frame');
near(s.realElapsed, 58.98 - 46.24, 'shot over', 1e-9);
eq(s.frames.filter((f) => f.gap).map((f) => f.index).join(), '1,4,6,12', 'the gaps follow frames 2, 5, 7 and 13');
near(s.frames[1].duration, 0.1, 'a gap lasts the hold');
near(s.frames[0].duration, 0.1, 'a step lasts as shot', 1e-9);
near(s.frames[11].duration, 0.04, 'a short step stays short', 1e-9);
near(s.frames[13].duration, s.typical, 'the last frame lasts a typical step');
near(s.typical, 0.1, 'typical step', 1e-9);
near(s.total, s.frames.reduce((a, f) => a + f.duration, 0), 'total is the sum', 1e-9);

// Hold and speed: a gap is hold / speed; a step is its time / speed.
s = schedule(fr(robin), { hold: 0.5, speed: 2 });
near(s.frames[1].duration, 0.25, 'gap: hold / speed');
near(s.frames[0].duration, 0.05, 'step / speed', 1e-9);
// A frame's own hold replaces its step, and the speed applies to it too (the
// animation keeps its pace); a frame left out is not in it (its step goes to the frame before).
const f2 = fr(robin);
f2[0].hold = 1;
f2[1].hold = 0.4;
f2[8].included = false;
s = schedule(f2, { hold: 0.1, speed: 2 });
near(s.frames[0].duration, 0.5, 'a frame\'s own hold, at the speed');
eq(s.frames[0].custom && !s.frames[2].custom, true, 'custom marks the frames with their own hold');
near(s.frames[0].asShot, 0.1, 'and asShot keeps what it would be', 1e-9);
near(s.frames[1].duration, 0.2, 'a gap\'s own hold replaces the trimmed gap', 1e-9);
eq(s.frames[1].gap, true, 'and it is still a gap');
eq(s.frames.map((f) => f.index).includes(8), false, 'the frame left out');
const seven = s.frames.find((f) => f.index === 7);
near(seven.duration, 0.1, 'its step goes to the frame before (0.2 s / 2)', 1e-9);

// GIF delays: rounded ends, so 1/30 s steps do not drift; at least 2 cs.
s = schedule(fr([0, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 5 / 30]), { hold: 0.1, speed: 1 });
eq(gifDelays(s).join(), '3,4,3,3,4,3', 'delays in cs, no drift');
eq(gifDelays(s).reduce((a, b) => a + b, 0), Math.round(s.total * 100), 'they add up to the total');
s = schedule(fr([0, 0.005, 0.01]), { hold: 0.1, speed: 1 });
assert(gifDelays(s).every((d) => d >= 2), 'never under 2 cs (browsers slow those down)');
// WebM repeats at 30 fps: whole frames, adding up to the total.
s = schedule(fr(robin), { hold: 0.1, speed: 1 });
const reps = repeatCounts(s, 30);
eq(reps.reduce((a, b) => a + b, 0), Math.round(s.total * 30), 'repeats add up to the total at 30 fps');
assert(reps.every((n) => n >= 1), 'every frame shows at least once');

console.log('test_burst_timing PASSED');
