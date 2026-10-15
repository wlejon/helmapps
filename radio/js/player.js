/**
 * The program player: one append-only engine stream for the radio's audio.
 *
 * yue.endless hands out the program from sample 0 in contiguous planar
 * stereo chunks at 48 kHz, and only emitLeadSeconds ahead of the playhead
 * this player reports. So there is no prebuffer (it would wait for audio the
 * stream will not hand out yet): the engine stream opens with the first
 * chunk and plays at once, and the playhead is what the mixer has consumed
 * of what was pushed, in program samples. Chunks that do not fit the ring
 * wait in a queue that tick() drains. (The yue2-lab's radio player.)
 */

export const PROGRAM_RATE = 48000;

let sharedCtx = null;
function audioContext() {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

/** Linear resample of a mono buffer, used only when the engine is not at 48 kHz. */
function resample(samples, inRate, outRate) {
  const ratio = outRate / inRate, n = Math.floor(samples.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / ratio, j = t | 0, f = t - j;
    const a = samples[j], b = j + 1 < samples.length ? samples[j + 1] : a;
    out[i] = a * (1 - f) + b * f;
  }
  return out;
}

function interleave(l, r) {
  const out = new Float32Array(l.length * 2);
  for (let i = 0; i < l.length; i++) { out[2 * i] = l[i]; out[2 * i + 1] = r[i]; }
  return out;
}

export function programPlayer({ ringSeconds = 4 } = {}) {
  let pb = -1;
  let queue = [];
  let pushed = 0;               // program samples received
  let playedAtClose = 0;
  let paused = false;
  let gain = 1;

  const ctx = () => audioContext();
  const engineRate = () => ctx().sampleRate || PROGRAM_RATE;
  const streamStats = () => {
    if (pb < 0) return null;
    try { return ctx().getStreamStats(pb); } catch (_) { return null; }
  };

  function drain() {
    if (pb < 0) return;
    while (queue.length) {
      const head = queue[0];
      const wrote = ctx().pushStreamSamples(pb, head);
      if (wrote * 2 >= head.length) { queue.shift(); continue; }
      if (wrote > 0) queue[0] = head.subarray(wrote * 2);
      break;
    }
  }

  const api = {
    /** One onAudio chunk (planar stereo, program rate, contiguous). */
    push(c) {
      const er = engineRate();
      let l = c.samples.subarray(0, c.frames), r = c.samples.subarray(c.frames, 2 * c.frames);
      if (Math.abs(er - c.sampleRate) >= 1) { l = resample(l, c.sampleRate, er); r = resample(r, c.sampleRate, er); }
      queue.push(interleave(l, r));
      pushed = c.sample0 + c.frames;
      if (pb < 0) {
        // Opened with the first chunk, so the mixer plays no silence before sample 0.
        pb = ctx().createStream(2, Math.round(ringSeconds * er));
        if (gain !== 1) ctx().setPlaybackGain(pb, gain);
        if (paused) ctx().setPlaybackPlaying(pb, false);
      }
      drain();
    },
    /** Once a frame: feed the ring; returns the playhead in program samples. */
    tick() { drain(); return api.playhead(); },
    /** Program samples played (what the stream's setPlayhead wants). */
    playhead() {
      const s = streamStats();
      const played = s ? s.playedFrames : playedAtClose;
      return Math.min(pushed, Math.round(played * PROGRAM_RATE / engineRate()));
    },
    setPaused(p) {
      paused = !!p;
      if (pb >= 0) ctx().setPlaybackPlaying(pb, !paused);
    },
    setGain(g, ramp = 0.05) {
      gain = g;
      if (pb >= 0) ctx().setPlaybackGain(pb, g, ramp);
    },
    stop() {
      const s = streamStats();
      if (s) playedAtClose = s.playedFrames;
      if (pb >= 0) { try { ctx().closeStream(pb); } catch (_) { /* gone */ } }
      pb = -1;
      queue = [];
    },
    stats() {
      const s = streamStats(), er = engineRate();
      return {
        bufferedSeconds: (s ? s.bufferedFrames : 0) / er,
        underrunSeconds: (s ? s.underrunFrames : 0) / er,
      };
    },
  };
  return api;
}
