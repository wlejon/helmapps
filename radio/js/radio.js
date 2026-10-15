/**
 * The radio: one yue.endless stream, its player, and what each chunk turned
 * out to sound like.
 *
 * The app sets targets ({ style, tag, knobs }); this module runs the stream
 * and reports what it does:
 *   onEvent(e)                       every stream event (the timeline reads them)
 *   onHeard({ index, sample, vec })  a main-line chunk's CLAP embedding, once all
 *                                    its audio has been handed out
 *   onError(message)                 the stream stopped
 *
 * Each main-line chunk's audio (mono, from its first sample to the next
 * chunk's) is embedded by CLAP one at a time, off the page thread.
 */

import { PROGRAM_RATE } from './player.js';

/** Seconds of program audio kept (mono) for the CLAP embeddings. */
const KEEP_SECONDS = 40;
/** The CLAP window: a chunk longer than this is embedded from its middle. */
const CLAP_SECONDS = 10;
/** Audio the stream hands out ahead of the playhead (the player's ring holds 4 s). */
const EMIT_LEAD_SECONDS = 2;

export class Radio {
  constructor(backend, hooks = {}) {
    this.backend = backend;
    this.hooks = hooks;
    this.stream = null;
    this.player = null;
    this.paused = false;
    this.keep = new Float32Array(KEEP_SECONDS * PROGRAM_RATE);
    this.keep0 = 0;            // program sample of keep[0]
    this.emitted = 0;          // program samples handed out
    this.starts = [];          // main-line chunk starts not yet embedded: { index, sample }
    this.playhead = 0;
    this.error = '';
  }

  get running() { return !!this.stream; }

  /** Starts the stream under `target` ({ style, tag, knobs }). */
  start(target) {
    this.stop();
    this.error = '';
    this.player = this.backend.createPlayer();
    this.player.setPaused(this.paused);
    this.emitted = 0; this.keep0 = 0; this.starts = []; this.playhead = 0;
    this.stream = this.backend.endless({
      target,
      // The page thread feeds the player; 2 s of audio in hand rides out a
      // stalled frame (the default 0.75 s underran on a busy box).
      emitLeadSeconds: EMIT_LEAD_SECONDS,
      onAudio: (a) => this.audio(a),
      onEvent: (e) => this.event(e),
      onDone: (r) => { if (r && r.error) this.fail(r.error); },
    });
  }

  stop() {
    if (this.stream) { try { this.stream.stop(); } catch (_) { /* already stopped */ } }
    if (this.player) this.player.stop();
    this.stream = null;
    this.player = null;
  }

  fail(message) {
    this.error = message;
    this.stop();
    if (this.hooks.onError) this.hooks.onError(message);
  }

  /** A new style from the open chunk ({ style, tag }); 'planned' says when it is heard. */
  setTarget(target) { if (this.stream) this.stream.setTarget(target); }

  setKnobs(knobs) { if (this.stream) this.stream.setKnobs(knobs); }

  setPaused(p) {
    this.paused = !!p;
    if (this.player) this.player.setPaused(this.paused);
  }

  stats() { return this.stream ? this.stream.stats : null; }

  // ---- the stream's callbacks ----------------------------------------------

  audio(a) {
    if (!this.player) return;
    this.player.push(a);
    // Keep the mono mix for CLAP, as a sliding window of KEEP_SECONDS.
    const end = a.sample0 + a.frames, cap = this.keep.length;
    if (end - this.keep0 > cap) {
      const shift = end - this.keep0 - cap;
      if (shift < cap) this.keep.copyWithin(0, shift);
      this.keep0 += shift;
    }
    const l = a.samples, r = a.samples.subarray(a.frames);
    for (let i = 0; i < a.frames; i++) {
      const j = a.sample0 + i - this.keep0;
      if (j >= 0) this.keep[j] = 0.5 * (l[i] + r[i]);
    }
    this.emitted = end;
  }

  event(e) {
    if (e.kind === 'chunkStart' && e.branch === 0) this.starts.push({ index: e.chunk, sample: e.sample });
    if (this.hooks.onEvent) this.hooks.onEvent(e);
    if (e.kind === 'error') this.fail(e.text);
  }

  // ---- once a frame --------------------------------------------------------

  tick() {
    if (!this.stream) return;
    this.playhead = this.player.tick();
    this.stream.setPlayhead(this.playhead);
    this.embedNext();
  }

  /** Embeds the oldest chunk whose audio is all handed out (one at a time). */
  embedNext() {
    if (this.starts.length < 2 || !this.hooks.onHeard) return;
    const c = this.starts[0], end = this.starts[1].sample;
    if (this.emitted < end) return;
    let s0 = c.sample, s1 = end;
    if (s1 - s0 > CLAP_SECONDS * PROGRAM_RATE) {
      const mid = (s0 + s1) / 2;
      s0 = Math.round(mid - CLAP_SECONDS * PROGRAM_RATE / 2); s1 = s0 + CLAP_SECONDS * PROGRAM_RATE;
    }
    if (s0 < this.keep0) { this.starts.shift(); return; }   // fell out of the window
    const mono = this.keep.slice(s0 - this.keep0, s1 - this.keep0);
    const started = this.backend.embedAudio(mono, (vec) => {
      if (vec && this.hooks.onHeard) this.hooks.onHeard({ index: c.index, sample: c.sample, vec });
    });
    if (started) this.starts.shift();
  }
}
