// The real thing (briefs/radio.md acceptance 8): YuE2-3B, its VAE and CLAP
// found by bro.models, 60 s of stream with one style change, the audio
// contiguous (no gap, no underrun), and the change heard: CLAP places the
// chunks after it nearer the new anchor than the old one.
//
// Skips when the models are not on this machine. Point bro.models at them,
// e.g. BRO_MODELS="D:/projects;D:/projects/brosoundml/weights", and keep it
// on one GPU (yue2-research scripts/gpu0.sh on the 4090 box).

import { app } from '/lib/test.js';

const RATE = 48000;

function until(pred, what, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    advanceTime(16);
    wallSleep(8);
    if (pred()) return;
  }
  throw new Error(`timed out: ${what} (phase ${app.state.phase}: ${app.state.reason})`);
}

until(() => app.state.phase === 'ready' || app.state.phase === 'missing', 'the models', 300000);
if (app.state.phase === 'missing') skipTest(app.state.reason);
else run();

function run() {
const anchors = app.state.anchors;
// A fixed start (the stream is seeded, so the run repeats): from jazz to the
// anchor farthest from it. A random pair is a weaker test: some styles come
// out as a neighbour (YuE2's "energetic blues" plays as nu-disco).
const from = anchors.find((a) => a.label === 'melancholic jazz') || anchors[0];
app.goTo(from.x, from.y);
const to = anchors.reduce((b, a) => (Math.hypot(a.x - from.x, a.y - from.y) > Math.hypot(b.x - from.x, b.y - from.y) ? a : b));
console.log(`from ${from.label} to ${to.label}`);

app.play();
until(() => app.state.radio.playhead > 15 * RATE, '15 s played', 180000);
app.goTo(to.x, to.y);
until(() => app.state.radio.playhead > 60 * RATE, '60 s played', 300000);

const st = app.state.radio.stats();
const under = app.state.radio.player.stats().underrunSeconds;
console.log(`60 s: worst gap ${st.worstGapSeconds.toFixed(3)} s, underrun ${under.toFixed(3)} s, chunk ${st.playing}`);
assert(st.worstGapSeconds < 0.2, `the stream was serviced throughout (worst gap ${st.worstGapSeconds})`);
assert(under < 0.05, `the player never ran dry (${under} s)`);

// The change heard, as CLAP zero-shot: each chunk's audio against the old
// and the new prompt. Chunks made under the new anchor should lean to it,
// and further than the chunks before the change do.
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const lean = (t) => dot(t.vec, to.vec) - dot(t.vec, from.vec);
const before = app.state.trail.filter((t) => t.vec && t.anchor === from.id);
const after = app.state.trail.filter((t) => t.vec && t.anchor === to.id);
console.log(`lean to ${to.label}: before ${before.map((t) => lean(t).toFixed(3)).join(' ')} | after ${after.map((t) => lean(t).toFixed(3)).join(' ')}`);
console.log(`heard as: ${app.state.trail.map((t) => `${anchors[t.anchor].label} -> ${anchors[t.heard].label}`).join('; ')}`);
assert(before.length >= 1 && after.length >= 2, 'chunks of both places on the trail');
const mean = (l) => l.reduce((s, t) => s + lean(t), 0) / l.length;
const shift = mean(after) - mean(before);
console.log(`the music moved ${shift.toFixed(3)} toward ${to.label}`);
assert(shift > 0.1, `the change is heard: the chunks after it lean toward the new place (${shift.toFixed(3)})`);

app.state.radio.stop();
console.log('test_smoke_gpu done');
}
