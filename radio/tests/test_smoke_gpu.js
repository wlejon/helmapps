// The real thing (briefs/radio.md acceptance 8): YuE2-3B, its VAE and CLAP
// found by bro.models, 60 s of stream with one style change, the audio
// contiguous (no gap, no underrun), and the change heard: CLAP gives the
// chunks after it more of the new genre than the chunks before.
//
// Skips when the models are not on this machine. Point bro.models at them,
// e.g. BRO_MODELS="D:/projects;D:/projects/brosoundml/weights", and keep it
// on one GPU (yue2-research scripts/gpu0.sh on the 4090 box).

import { app } from '/lib/test.js';
import { GENRES, MOODS, makeStyle, styleLabel } from '/app/js/styles.js';

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

until(() => app.state.phase === 'ready' || app.state.phase === 'missing' || app.state.phase === 'unavailable', 'the models', 300000);
if (app.state.phase === 'unavailable') skipTest(app.state.reason);
else if (app.state.phase === 'missing') skipTest(app.state.reason || 'the models are not found (set BRO_MODELS, or choose them in the app)');
else run();

function run() {
  // A fixed start (the stream is seeded, so the run repeats), and a change far
  // from it in both genre family and mood.
  const go = (genre, mood) => {
    app.pickGenre(genre);
    const m = MOODS.find((q) => q.id === mood);
    app.moveTo(m.x, m.y, true);
  };
  go('jazz', 'calm');
  const from = app.state.style;
  const to = makeStyle({ genre: 'metal', mood: 'aggressive' });
  assert(GENRES.includes(from.genre) && GENRES.includes(to.genre), 'both genres are on the list');
  console.log(`from ${styleLabel(from)} to ${styleLabel(to)}`);

  app.play();
  until(() => app.state.radio.playhead > 15 * RATE, '15 s played', 180000);
  go(to.genre, to.mood);
  until(() => app.state.radio.playhead > 60 * RATE, '60 s played', 300000);

  const st = app.state.radio.stats();
  const under = app.state.radio.player.stats().underrunSeconds;
  console.log(`60 s: worst gap ${st.worstGapSeconds.toFixed(3)} s, underrun ${under.toFixed(3)} s`);
  assert(st.worstGapSeconds < 0.2, `the stream was serviced throughout (worst gap ${st.worstGapSeconds})`);
  assert(under < 0.05, `the player never ran dry (${under} s)`);

  // Every heard chunk, scored against the new style: P(new genre) by CLAP zero-shot.
  until(() => [...app.state.program.chunks.values()].filter((c) => c.heard).length >= 5, 'CLAP on the played chunks', 60000);
  const heard = [...app.state.program.chunks.values()].filter((c) => c.heard && c.style);
  const pNew = (c) => app.state.ear.hear(c.heard.vec, to).askedGenreP;
  const before = heard.filter((c) => c.style.genre === from.genre);
  const after = heard.filter((c) => c.style.genre === to.genre);
  console.log(`heard as: ${heard.map((c) => `${styleLabel(c.style)} -> ${c.heard.mood} ${c.heard.genre} (${c.heard.askedGenreP.toFixed(2)})`).join('; ')}`);
  assert(before.length >= 1 && after.length >= 2, `chunks of both styles heard (${before.length} / ${after.length})`);
  const mean = (l) => l.reduce((s, c) => s + pNew(c), 0) / l.length;
  const shift = mean(after) - mean(before);
  console.log(`P(${to.genre}): before ${before.map((c) => pNew(c).toFixed(2)).join(' ')} | after ${after.map((c) => pNew(c).toFixed(2)).join(' ')}`);
  assert(shift > 0.2, `the change is heard: the chunks after it sound more like ${to.genre} (${shift.toFixed(3)})`);

  app.state.radio.stop();
  console.log('test_smoke_gpu done');
}
