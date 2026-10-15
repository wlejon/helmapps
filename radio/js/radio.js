/**
 * The radio: one yue.endless stream, its player, and the trail of where the
 * music actually went.
 *
 * The app says where to go (go(), setPath(), setKnobs()); this module turns
 * that into stream targets and reports back what the stream does:
 *   onPlanned({ tag, anchor, sample })   a target placed: first heard at sample
 *   onChunk({ index, tag, anchor, sample })  a main-line chunk's first sample handed out
 *   onTrail({ x, y, anchor, tag, sample })   a played chunk, placed by its CLAP embedding
 *   onError(message)                     the stream stopped
 *
 * Trail: each main-line chunk's audio (mono, from its first sample to the
 * next chunk's) is embedded by CLAP once all of it has been handed out; the
 * point joins the trail when the playhead reaches the chunk.
 *
 * A target's tag is the anchor id ("a17"), so every event says which anchor
 * the stream was making music under.
 */

import { PROGRAM_RATE } from './player.js';

/** Seconds of program audio kept (mono) for the CLAP embeddings. */
const KEEP_SECONDS = 40;
/** The CLAP window: a chunk longer than this is embedded from its middle. */
const CLAP_SECONDS = 10;
/** Audio the stream hands out ahead of the playhead (the player's ring holds 4 s). */
const EMIT_LEAD_SECONDS = 2;

export const anchorTag = (id) => `a${id}`;
export const tagAnchor = (tag) => (/^a\d+$/.test(tag || '') ? Number(tag.slice(1)) : -1);

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
    this.chunks = [];          // main-line chunk starts not yet embedded: { index, tag, sample }
    this.pendingTrail = [];    // embedded, waiting for the playhead
    this.playhead = 0;
    this.error = '';
  }

  get running() { return !!this.stream; }

  /** Starts the stream at an anchor with knobs. */
  start(anchor, knobs) {
    this.stop();
    this.error = '';
    this.player = this.backend.createPlayer();
    this.player.setPaused(this.paused);
    this.emitted = 0; this.keep0 = 0; this.chunks = []; this.pendingTrail = []; this.playhead = 0;
    this.stream = this.backend.endless({
      target: { style: anchor.style, tag: anchorTag(anchor.id), knobs: knobs || {} },
      // The page thread feeds the player; 2 s of audio in hand rides out a
      // stalled frame (the default 0.75 s underran on a busy box).
      emitLeadSeconds: EMIT_LEAD_SECONDS,
      onAudio: (a) => this.audio(a),
      onEvent: (e) => this.event(e),
      onDone: (r) => {
        if (r && r.error) this.fail(r.error);
      },
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

  /** Steer to an anchor now (from the open chunk); clears any path. */
  go(anchor) {
    if (!this.stream) return;
    this.stream.setPath([]);
    this.stream.setTarget({ style: anchor.style, tag: anchorTag(anchor.id) });
  }

  /** A path ahead: [{ anchor, at }] with at in program seconds, replacing the old one. */
  setPath(points) {
    if (!this.stream) return;
    this.stream.setPath(points.map((p) => ({ style: p.anchor.style, tag: anchorTag(p.anchor.id), at: p.at })));
  }

  setKnobs(knobs) {
    if (this.stream) this.stream.setKnobs(knobs);
  }

  setPaused(p) {
    this.paused = !!p;
    if (this.player) this.player.setPaused(this.paused);
  }

  /** Where a target set now is first heard, in program seconds (null: no stream). */
  openSeconds() {
    if (!this.stream) return null;
    return this.stream.stats.openSample / PROGRAM_RATE;
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
    if (e.kind === 'planned') {
      if (this.hooks.onPlanned) this.hooks.onPlanned({ tag: e.tag, anchor: tagAnchor(e.tag), sample: e.sample });
    } else if (e.kind === 'chunkStart' && e.branch === 0) {
      this.chunks.push({ index: e.chunk, tag: e.tag, sample: e.sample });
      if (this.hooks.onChunk) this.hooks.onChunk({ index: e.chunk, tag: e.tag, anchor: tagAnchor(e.tag), sample: e.sample });
    } else if (e.kind === 'error') {
      this.fail(e.text);
    }
  }

  // ---- once a frame --------------------------------------------------------

  tick() {
    if (!this.stream) return;
    this.playhead = this.player.tick();
    this.stream.setPlayhead(this.playhead);
    this.embedNext();
    while (this.pendingTrail.length && this.pendingTrail[0].sample <= this.playhead) {
      const p = this.pendingTrail.shift();
      if (this.hooks.onTrail) this.hooks.onTrail(p);
    }
  }

  /** Embeds the oldest chunk whose audio is all handed out (one at a time). */
  embedNext() {
    if (this.chunks.length < 2 || !this.hooks.place) return;
    const c = this.chunks[0], end = this.chunks[1].sample;
    if (this.emitted < end) return;
    let s0 = c.sample, s1 = end;
    if (s1 - s0 > CLAP_SECONDS * PROGRAM_RATE) {
      const mid = (s0 + s1) / 2;
      s0 = Math.round(mid - CLAP_SECONDS * PROGRAM_RATE / 2); s1 = s0 + CLAP_SECONDS * PROGRAM_RATE;
    }
    if (s0 < this.keep0) { this.chunks.shift(); return; }   // fell out of the window
    const mono = this.keep.slice(s0 - this.keep0, s1 - this.keep0);
    const started = this.backend.embedAudio(mono, (vec) => {
      if (!vec) return;
      const p = this.hooks.place(vec);
      this.pendingTrail.push({ x: p.x, y: p.y, anchor: tagAnchor(c.tag), heard: p.anchor, tag: c.tag, sample: c.sample, vec });
    });
    if (started) this.chunks.shift();
  }
}
