/**
 * Playback: one song at a time from the queue, streamed from disk by the
 * audio engine (AudioContext.createStreamFromFile decodes on its own thread
 * a little ahead of what plays, so an hour-long FLAC costs a ring buffer,
 * not a gigabyte of PCM).
 *
 *   const player = new Player({ songOf: (path) => record, onChange, onError });
 *   player.playQueue(paths, 2);     player.toggle();   player.next();   player.seek(42);
 *   player.state                    'stopped' | 'playing' | 'paused'
 *   player.position, player.duration (seconds)
 *
 * The page polls the stream once a frame while it plays, for the position
 * and the end of the song; nothing else runs per frame.
 */

import { Queue } from './queue.js';

/** Previous restarts the song when it is further in than this. */
export const RESTART_AFTER = 3;
/** Songs in a row that may fail to open before playback stops trying. */
const MAX_FAILS = 8;

export class Player {
  constructor({ songOf, onChange, onTrack, onError } = {}) {
    this.songOf = songOf || (() => null);
    this.onChange = onChange || (() => {});
    this.onTrack = onTrack || (() => {});
    this.onError = onError || (() => {});
    this.queue = new Queue();
    this.ctx = null;
    this.pb = -1;
    this.pbPath = '';
    this.state = 'stopped';
    this.position = 0;
    this.volume = 0.8;
    this.muted = false;
    this.fails = 0;
    this.ticking = false;
  }

  /** The audio engine, made on first use (not on the way to the first frame). */
  audio() {
    if (!this.ctx) {
      if (typeof AudioContext !== 'function') throw new Error('this build of bro has no audio');
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  get current() {
    const e = this.queue.current;
    return e ? this.songOf(e.path) || { path: e.path, title: e.path.split(/[\\/]/).pop(), artist: '', album: '', duration: 0 } : null;
  }

  get duration() {
    const s = this.current;
    return s ? s.duration || 0 : 0;
  }

  get playing() {
    return this.state === 'playing';
  }

  gain() {
    return this.muted ? 0 : this.volume * this.volume;     // a perceptual curve for the slider
  }

  // ---- the queue --------------------------------------------------------------

  /** Play paths[start] now, with the rest of paths as the queue. */
  playQueue(paths, start = 0) {
    this.queue.set(paths, start);
    this.fails = 0;
    this.startCurrent(0, true);
  }

  /** Play the queue entry at index i. */
  playIndex(i) {
    if (this.queue.go(i) < 0) return;
    this.fails = 0;
    this.startCurrent(0, true);
  }

  next() {
    const i = this.queue.next();
    if (i < 0) { this.stopAtEnd(); return; }
    this.startCurrent(0, this.state !== 'paused');
  }

  /** Previous song, or the start of this one when it is more than 3 s in. */
  prev() {
    if (this.queue.current && this.readPosition() > RESTART_AFTER) {
      this.seek(0);
      return;
    }
    this.queue.prev();
    this.startCurrent(0, this.state !== 'paused');
  }

  /** The queue changed under the current song (removed, cleared). */
  queueChanged() {
    const e = this.queue.current;
    if (!e) { this.close(); this.state = 'stopped'; this.position = 0; }
    else if (e.path !== this.pbPath && this.pb >= 0) this.startCurrent(0, this.state === 'playing');
    this.onChange();
  }

  // ---- transport ------------------------------------------------------------------

  toggle() {
    if (this.state === 'playing') this.pause();
    else this.play();
  }

  play() {
    if (!this.queue.current) return;
    if (this.pb >= 0 && this.pbPath === this.queue.current.path) {
      this.ctx.setPlaybackPlaying(this.pb, true);
      this.state = 'playing';
      this.startTicking();
      this.onChange();
      return;
    }
    this.startCurrent(this.position, true);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.position = this.readPosition();
    if (this.pb >= 0) this.ctx.setPlaybackPlaying(this.pb, false);
    this.state = 'paused';
    this.onChange();
  }

  seek(sec) {
    const d = this.duration;
    const t = Math.max(0, d ? Math.min(sec, d) : sec);
    this.position = t;
    if (this.pb >= 0) this.ctx.seekPlayback(this.pb, t);
    this.onChange();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyGain();
    this.onChange();
  }

  setMuted(m) {
    this.muted = !!m;
    this.applyGain();
    this.onChange();
  }

  setShuffle(on) {
    this.queue.setShuffle(on);
    this.onChange();
  }

  setRepeat(mode) {
    this.queue.setRepeat(mode);
    this.onChange();
  }

  applyGain() {
    if (this.pb >= 0) this.ctx.setPlaybackGain(this.pb, this.gain(), 0.05);
  }

  // ---- the stream ------------------------------------------------------------------

  close() {
    if (this.pb >= 0 && this.ctx) {
      try { this.ctx.closeStream(this.pb); } catch (_) { /* already gone */ }
    }
    this.pb = -1;
    this.pbPath = '';
  }

  /** Open the current entry's file at `at` seconds, playing or paused. */
  startCurrent(at = 0, play = true) {
    this.close();
    const e = this.queue.current;
    this.position = at;
    if (!e) { this.state = 'stopped'; this.onChange(); return; }
    this.onTrack(e);
    if (!play) {
      // Paused on a new song: open it when Play is pressed.
      this.state = 'paused';
      this.onChange();
      return;
    }
    let ctx;
    try {
      ctx = this.audio();
      // Repeat one opens the song again at its end (ended() below) rather than
      // looping the stream: a looping stream's position counts on past the
      // end of the file (GAPS.md), and the seek bar would run off.
      this.pb = ctx.createStreamFromFile(e.path, { gain: this.gain(), loop: false });
      this.pbPath = e.path;
      if (at > 0) ctx.seekPlayback(this.pb, at);
    } catch (err) {
      this.pb = -1;
      this.pbPath = '';
      this.failed(e, err);
      return;
    }
    this.fails = 0;
    this.state = 'playing';
    this.startTicking();
    this.onChange();
  }

  failed(e, err) {
    this.onError(e, err);
    this.fails++;
    if (this.fails >= Math.min(MAX_FAILS, this.queue.length) || this.queue.next() < 0) {
      this.state = 'stopped';
      this.position = 0;
      this.onChange();
      return;
    }
    this.startCurrent(0, true);
  }

  /** Past the last song with repeat off: stop on it, at its start. */
  stopAtEnd() {
    this.close();
    this.state = 'stopped';
    this.position = 0;
    this.onChange();
  }

  readPosition() {
    if (this.pb >= 0 && this.ctx) return this.ctx.getPlaybackPositionSeconds(this.pb);
    return this.position;
  }

  startTicking() {
    if (this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(() => this.tick());
  }

  /** Once a frame while playing: the position, and the end of the song. */
  tick() {
    if (this.state !== 'playing' || this.pb < 0) { this.ticking = false; return; }
    this.position = this.readPosition();
    // isClipPlaying stays true for a finished disk stream (GAPS.md); its stats say when it ended.
    const stats = this.ctx.getStreamStats(this.pb);
    if (stats && stats.finished) {
      this.ended();
    }
    if (this.state === 'playing') requestAnimationFrame(() => this.tick());
    else this.ticking = false;
  }

  ended() {
    const i = this.queue.next({ auto: true });
    if (i < 0) { this.stopAtEnd(); return; }
    this.startCurrent(0, true);
  }
}
