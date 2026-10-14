/**
 * Procedural chime / alarm sound synthesis using bro's SynthGraph.
 * Needs no external audio files and degrades gracefully when audio is unavailable.
 */

import { attempt } from '/lib/dom.js';
import { now } from './time.js';

let ctx = null;
let timerChimeGraph = null;
let alarmChimeGraph = null;

function ensureAudio() {
  if (ctx) return true;
  if (typeof AudioContext === 'undefined' || typeof SynthGraph === 'undefined') return false;
  return attempt('clock.audio.init', () => {
    ctx = new AudioContext();
    timerChimeGraph = new SynthGraph({
      layers: {
        bell1: {
          offset: 0,
          gain: 0.45,
          nodes: {
            tone: { type: 'fm', freq: 880, ratio: 2, index: 1.4, gain: 'env1' },
            env1: { type: 'env', attack: 0.004, decay: 0.55, sustain: 0, release: 0.1 },
          },
          output: 'tone',
        },
        bell2: {
          offset: 0.16,
          gain: 0.45,
          nodes: {
            tone2: { type: 'fm', freq: 1318.5, ratio: 2, index: 1.1, gain: 'env2' },
            env2: { type: 'env', attack: 0.004, decay: 0.75, sustain: 0, release: 0.15 },
          },
          output: 'tone2',
        },
      },
      duration: 1.1,
    });
    alarmChimeGraph = new SynthGraph({
      layers: {
        a1: {
          offset: 0,
          gain: 0.5,
          nodes: {
            o1: { type: 'fm', freq: 784, ratio: 2, index: 1.6, gain: 'e1' },
            e1: { type: 'env', attack: 0.004, decay: 0.35, sustain: 0, release: 0.08 },
          },
          output: 'o1',
        },
        a2: {
          offset: 0.14,
          gain: 0.5,
          nodes: {
            o2: { type: 'fm', freq: 987.77, ratio: 2, index: 1.4, gain: 'e2' },
            e2: { type: 'env', attack: 0.004, decay: 0.35, sustain: 0, release: 0.08 },
          },
          output: 'o2',
        },
        a3: {
          offset: 0.28,
          gain: 0.55,
          nodes: {
            o3: { type: 'fm', freq: 1174.66, ratio: 2, index: 1.2, gain: 'e3' },
            e3: { type: 'env', attack: 0.004, decay: 0.65, sustain: 0, release: 0.12 },
          },
          output: 'o3',
        },
      },
      duration: 1.15,
    });
    return true;
  }, false);
}

/** Play a pleasant chime for a finished timer or ringing alarm. */
export function playChime(state, kind = 'timer') {
  if (state) {
    state.lastSoundPlayedAt = now();
    state.soundPlayCount = (state.soundPlayCount || 0) + 1;
  }
  attempt('clock.audio.play', () => {
    if (!ensureAudio() || !ctx) return;
    const graph = kind === 'alarm' ? alarmChimeGraph : timerChimeGraph;
    if (graph && typeof ctx.playSynth === 'function') {
      ctx.playSynth(graph);
    }
  });
}
