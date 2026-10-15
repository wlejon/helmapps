/**
 * The radio's models: YuE2-3B (the music), its VAE (the audio), and CLAP
 * (where the music is). Each is a folder: one the listener chose in the app
 * (kept in settings), else the one bro.models finds by name. A missing or
 * wrong folder is reported, never faked.
 *
 * A backend is what the radio runs on:
 *   endless(opts)              yue.endless (docs/music-endless-api.js)
 *   embedText(list)            CLAP text embeddings, unit length, 512
 *   embedAudio(mono48k, done)  CLAP audio embedding, async: done(vec | null)
 *   createPlayer()             the program player (player.js)
 *   dispose()                  frees the models (none may be busy)
 *   device                     a few words for the status bar
 * The real one is built here; tests hand the app a fake with the same shape.
 */

import { programPlayer } from './player.js';

const fs = require('fs');
const path = require('path');

/**
 * The model folders the radio needs. name: the bro.models name; has: files
 * the folder must hold; not: a file that says it is another model's folder.
 */
export const MODELS = [
  { key: 'yue', name: 'YuE2-3B', label: 'YuE2-3B', what: 'makes the music',
    has: ['config.json', 'model.safetensors', 'qwen.tiktoken'] },
  { key: 'vae', name: 'yue2-vae', label: 'YuE2 VAE', what: 'turns it into audio',
    has: ['config.json', 'model.safetensors'], not: 'qwen.tiktoken' },
  { key: 'clap', name: 'clap', label: 'CLAP', what: 'places the music on the map',
    has: ['model.safetensors', 'tokenizer.json', 'preprocessor_config.json'] },
];

/** The AR decode weights YuE2 can load with (faster sampling, more VRAM than bf16 alone). */
export const AR_WEIGHTS = [
  { value: 'int8', label: 'int8', title: 'Quantised AR decode: fast (the default)' },
  { value: 'fp8', label: 'fp8', title: 'fp8 AR decode' },
  { value: 'bf16', label: 'bf16', title: 'The reference weights: slowest, least VRAM' },
];

/** Why this bro cannot run the radio at all, or '' when it can. */
export function capability() {
  const music = typeof bro !== 'undefined' ? bro.music : null;
  if (!music || music.available === false || typeof music.loadYuE2 !== 'function') {
    return 'This build of bro has no bro.music (it needs the ML build with BRO_WITH_SOUNDML).';
  }
  if (!bro.ear || typeof bro.ear.loadClap !== 'function') return 'This build of bro has no CLAP (bro.ear.loadClap).';
  return '';
}

/** Why `dir` is not a folder of model `m`, or '' when it is. */
export function checkDir(m, dir) {
  if (!dir) return 'No folder';
  let names;
  try { names = new Set(fs.readdirSync(dir)); } catch (_) { return 'The folder cannot be read'; }
  const missing = m.has.filter((f) => !names.has(f));
  if (missing.length) return `Not a ${m.label} folder (no ${missing.join(', ')})`;
  if (m.not && names.has(m.not)) return `Not a ${m.label} folder (this looks like another model)`;
  return '';
}

/**
 * Where each model is: { key: { dir, source, error } }. source is 'chosen'
 * (picked in the app), 'found' (bro.models) or 'missing'. error says why a
 * chosen folder will not do.
 */
export function resolveModels(chosen = {}) {
  const out = {};
  for (const m of MODELS) {
    const pick = chosen[m.key];
    if (pick) { out[m.key] = { dir: pick, source: 'chosen', error: checkDir(m, pick) }; continue; }
    const found = typeof bro !== 'undefined' && bro.models ? bro.models.find(m.name) : null;
    out[m.key] = found ? { dir: found, source: 'found', error: checkDir(m, found) }
      : { dir: null, source: 'missing', error: 'Not found' };
  }
  return out;
}

/** True when every model has a usable folder. */
export const allReady = (where) => MODELS.every((m) => where[m.key] && where[m.key].dir && !where[m.key].error);

/** Where bro.models looked, for the panel's hint. */
export const searchedDirs = () => (typeof bro !== 'undefined' && bro.models ? bro.models.dirs : []);

/** Loads the three models (each on its own thread); resolves to a backend. */
export function loadBackend(dirs, { arWeights = 'int8', onStep } = {}) {
  return new Promise((resolve, reject) => {
    const got = {};
    let pending = 3, failed = false;
    const fail = (what) => (e) => {
      if (failed) return;
      failed = true;
      // Free whatever did load; the next try starts clean.
      const free = () => { for (const k of Object.keys(got)) { try { got[k].dispose(); } catch (_) { /* busy or gone */ } } };
      setTimeout(free, 0);
      reject(new Error(`${what}: ${e}`));
    };
    const done = (key) => (m) => {
      got[key] = m;
      if (onStep) onStep(key);
      if (failed) { try { m.dispose(); } catch (_) { /* fine */ } return; }
      if (--pending) return;
      resolve(makeBackend(got, dirs.clap));
    };
    bro.music.loadYuE2(dirs.yue, { arWeights, onReady: done('yue'), onError: fail('YuE2') });
    bro.music.loadVae(dirs.vae, { decoderOnly: true, onReady: done('vae'), onError: fail('VAE') });
    bro.ear.loadClap(dirs.clap, { onReady: done('clap'), onError: fail('CLAP') });
  });
}

/** A short stable hash of a string (FNV-1a), for cache file names. */
function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

function makeBackend({ yue, vae, clap }, clapDir) {
  let embedding = false;
  return {
    device: `${yue.device} · AR ${yue.arWeights}`,
    cacheKey: hashKey(path.resolve(clapDir)),   // the anchors' text vectors are cached per CLAP folder
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
    /** Frees the weights. False while a stream or embedding still holds one: try again after its onDone. */
    dispose() {
      if (yue.busy || vae.busy || embedding) return false;
      yue.dispose(); vae.dispose(); clap.dispose();
      return true;
    },
  };
}

/** A short form of a folder path for the panel: the last two parts. */
export const shortDir = (dir) => (dir ? dir.split(/[\\/]/).filter(Boolean).slice(-2).join(path.sep) : '');
