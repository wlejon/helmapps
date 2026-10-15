/**
 * The radio's models: YuE2-3B (the music), its VAE (the audio), and CLAP
 * (where the music is). All three are found by name with bro.models, so the
 * app carries no paths; a missing one is reported, never faked.
 *
 * A backend is what the radio runs on:
 *   endless(opts)              yue.endless (docs/music-endless-api.js)
 *   embedText(list)            CLAP text embeddings, unit length, 512
 *   embedAudio(mono48k, done)  CLAP audio embedding, async: done(vec | null)
 *   createPlayer()             the program player (player.js)
 *   device                     a few words for the status bar
 * The real one is built here; tests hand the app a fake with the same shape.
 */

import { programPlayer } from './player.js';

/** The model folders the radio needs, by bro.models name. */
export const MODELS = [
  { key: 'yue', name: 'YuE2-3B', what: 'YuE2-3B (the music)' },
  { key: 'vae', name: 'yue2-vae', what: 'the YuE2 VAE (the audio)' },
  { key: 'clap', name: 'clap', what: 'CLAP (the map)' },
];

/**
 * Whether the radio can run here: { ok, reason, dirs, missing }.
 * reason says why not, in a sentence the empty state can show.
 */
export function probe() {
  const music = typeof bro !== 'undefined' ? bro.music : null;
  if (!music || music.available === false || typeof music.loadYuE2 !== 'function') {
    return { ok: false, reason: 'This build of bro has no bro.music (it needs the ML build with BRO_WITH_SOUNDML).', missing: [] };
  }
  if (!bro.ear || typeof bro.ear.loadClap !== 'function') {
    return { ok: false, reason: 'This build of bro has no CLAP (bro.ear.loadClap).', missing: [] };
  }
  if (!bro.models) return { ok: false, reason: 'This build of bro has no bro.models.', missing: [] };
  const dirs = {}, missing = [];
  for (const m of MODELS) {
    const d = bro.models.find(m.name);
    if (d) dirs[m.key] = d; else missing.push(m);
  }
  if (missing.length) {
    return { ok: false, missing, dirs,
      reason: `Missing ${missing.map((m) => m.what).join(', ')}. Looked in: ${bro.models.dirs.join(', ') || '(no model folders)'}` };
  }
  return { ok: true, dirs, missing: [] };
}

/** Loads the three models (each on its own thread); resolves to a backend. */
export function loadBackend(dirs, { onStep } = {}) {
  return new Promise((resolve, reject) => {
    const got = {};
    let pending = 3, failed = false;
    const fail = (what) => (e) => { if (!failed) { failed = true; reject(new Error(`${what}: ${e}`)); } };
    const done = (key) => (m) => {
      got[key] = m;
      if (onStep) onStep(key);
      if (--pending || failed) return;
      resolve(makeBackend(got));
    };
    bro.music.loadYuE2(dirs.yue, { arWeights: 'int8', onReady: done('yue'), onError: fail('YuE2') });
    bro.music.loadVae(dirs.vae, { decoderOnly: true, onReady: done('vae'), onError: fail('VAE') });
    bro.ear.loadClap(dirs.clap, { onReady: done('clap'), onError: fail('CLAP') });
  });
}

function makeBackend({ yue, vae, clap }) {
  let embedding = false;
  return {
    device: `${yue.device} · AR ${yue.arWeights}`,
    cacheable: true,          // the anchors' text vectors may be cached on disk
    knobRanges: bro.music.knobRanges || null,
    endless: (opts) => yue.endless(Object.assign({ vae }, opts)),
    embedText: (list) => {
      const r = clap.embedText(list);
      return Array.isArray(r) ? r : [r];
    },
    /** One embedding at a time (the model allows one call); a busy call answers null. */
    embedAudio(mono, done) {
      if (embedding) { done(null); return false; }
      embedding = true;
      clap.embedAudio(mono, { sampleRate: 48000, onDone: (vec, r) => {
        embedding = false;
        done(r && (r.cancelled || r.error) ? null : vec);
      } });
      return true;
    },
    createPlayer: () => programPlayer(),
  };
}
