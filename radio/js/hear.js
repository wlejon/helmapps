/**
 * What a chunk sounds like, by CLAP: its audio embedding scored against
 * every genre and every mood as text ("jazz music", "calm music"), the way
 * CLAP classifies zero-shot. The timeline shows the top genre and mood and
 * whether they agree with what the chunk was asked to be.
 */

import { GENRES, MOODS } from './styles.js';

const LOGIT_SCALE = 38.7;   // CLAP's learned logit scale

function softmaxTop(vec, table) {
  let best = -1, bs = -Infinity;
  const sims = table.vecs.map((t, i) => {
    let s = 0;
    for (let k = 0; k < t.length; k++) s += t[k] * vec[k];
    if (s > bs) { bs = s; best = i; }
    return s;
  });
  let z = 0;
  for (const s of sims) z += Math.exp((s - bs) * LOGIT_SCALE);
  const prob = (i) => Math.exp((sims[i] - bs) * LOGIT_SCALE) / z;
  return { id: table.ids[best], p: prob(best), probOf: (id) => prob(table.ids.indexOf(id)) };
}

/** Builds the ear on a backend (embedText once for the 38 prompts). */
export function makeEar(backend) {
  const genres = { ids: GENRES, vecs: backend.embedText(GENRES.map((g) => `${g} music`)) };
  const moods = { ids: MOODS.map((m) => m.id), vecs: backend.embedText(MOODS.map((m) => `${m.id} music`)) };
  return {
    /**
     * { genre, genreP, mood, moodP, askedGenreP }: the likeliest genre and
     * mood (softmax probabilities among all of them) and the probability of
     * the genre that was asked for.
     */
    hear(vec, asked) {
      const g = softmaxTop(vec, genres), m = softmaxTop(vec, moods);
      return { genre: g.id, genreP: g.p, mood: m.id, moodP: m.p, askedGenreP: asked ? g.probOf(asked.genre) : 0 };
    },
    /** The genre and mood nearest a text phrase ("rain on a tin roof"). */
    place(text) {
      const [v] = backend.embedText([text]);
      return { genre: softmaxTop(v, genres).id, mood: softmaxTop(v, moods).id };
    },
  };
}
