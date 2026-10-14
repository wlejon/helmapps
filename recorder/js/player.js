/**
 * Audio playback controller for Sound Recorder.
 * Uses `AudioContext` (`createClip`, `playClip`, `setPlaybackRate`,
 * `seekPlayback`, `setPlaybackPlaying`, `stopPlayback`) with a synchronized
 * `performance.now()` clock fallback so headless `advanceTime()` tests and
 * live desktop audio both advance playhead position accurately.
 */

import { clamp, attempt } from '/lib/dom.js';

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export class AudioPlayer {
  constructor({ onTimeUpdate, onStateChange } = {}) {
    this.onTimeUpdate = onTimeUpdate || null;
    this.onStateChange = onStateChange || null;

    this.ctx = null;
    this.clipId = -1;
    this.playbackId = -1;

    this.playing = false;
    this.duration = 0;
    this.currentTime = 0;
    this.playbackRate = 1.0;

    this._lastTickMs = 0;
    this._raf = 0;
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext !== 'undefined') {
      this.ctx = attempt('new AudioContext', () => new AudioContext(), null);
    }
    return this.ctx;
  }

  /**
   * Load PCM samples or recording metadata into the player.
   * @param {{ duration: number, sampleRate?: number, samples?: Float32Array }} clip
   */
  load(clip) {
    this.stop();
    this._releaseClip();

    if (!clip) {
      this.duration = 0;
      this.currentTime = 0;
      this._emitTime();
      this._emitState();
      return;
    }

    this.duration = Math.max(0, Number(clip.duration) || 0);
    this.currentTime = 0;

    if (clip.samples && clip.samples.length > 0) {
      const ctx = this._ensureContext();
      if (ctx && typeof ctx.createClip === 'function') {
        const rate = Number(clip.sampleRate) || ctx.sampleRate || 16000;
        this.clipId = attempt('ctx.createClip', () => ctx.createClip(clip.samples, 1, rate), -1);
      }
    }

    this._emitTime();
    this._emitState();
  }

  play() {
    if (this.duration <= 0) return false;
    if (this.playing) return true;

    if (this.currentTime >= this.duration - 0.01) {
      this.currentTime = 0;
    }

    const ctx = this._ensureContext();
    if (ctx && this.clipId >= 0) {
      if (this.playbackId >= 0 && typeof ctx.setPlaybackPlaying === 'function') {
        attempt('ctx.seekPlayback', () => ctx.seekPlayback(this.playbackId, this.currentTime));
        attempt('ctx.setPlaybackRate', () => ctx.setPlaybackRate(this.playbackId, this.playbackRate));
        attempt('ctx.setPlaybackPlaying', () => ctx.setPlaybackPlaying(this.playbackId, true));
      } else if (typeof ctx.playClip === 'function') {
        this.playbackId = attempt('ctx.playClip', () => ctx.playClip(this.clipId, 1.0, false), -1);
        if (this.playbackId >= 0) {
          if (typeof ctx.setPlaybackRate === 'function') {
            attempt('ctx.setPlaybackRate', () => ctx.setPlaybackRate(this.playbackId, this.playbackRate));
          }
          if (this.currentTime > 0 && typeof ctx.seekPlayback === 'function') {
            attempt('ctx.seekPlayback', () => ctx.seekPlayback(this.playbackId, this.currentTime));
          }
        }
      }
    }

    this.playing = true;
    this._lastTickMs = performance.now();
    this._scheduleTick();
    this._emitState();
    return true;
  }

  pause() {
    if (!this.playing) return false;
    this.playing = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    if (this.ctx && this.playbackId >= 0 && typeof this.ctx.setPlaybackPlaying === 'function') {
      attempt('ctx.setPlaybackPlaying', () => this.ctx.setPlaybackPlaying(this.playbackId, false));
    }
    this._emitState();
    return true;
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    const wasPlaying = this.playing;
    this.playing = false;
    if (this.ctx && this.playbackId >= 0 && typeof this.ctx.stopPlayback === 'function') {
      attempt('ctx.stopPlayback', () => this.ctx.stopPlayback(this.playbackId));
    }
    this.playbackId = -1;
    this.currentTime = 0;
    this._emitTime();
    if (wasPlaying) this._emitState();
  }

  /**
   * Seek playhead to `timeSec` in `[0, duration]`.
   * @param {number} timeSec
   */
  seek(timeSec) {
    this.currentTime = clamp(Number(timeSec) || 0, 0, this.duration || 0);
    this._lastTickMs = performance.now();
    if (this.ctx && this.playbackId >= 0 && typeof this.ctx.seekPlayback === 'function') {
      attempt('ctx.seekPlayback', () => this.ctx.seekPlayback(this.playbackId, this.currentTime));
    }
    this._emitTime();
  }

  /**
   * Skip relative to current playhead (`-5` or `+5` seconds).
   * @param {number} deltaSec
   */
  skip(deltaSec) {
    this.seek(this.currentTime + Number(deltaSec || 0));
  }

  /**
   * Set playback speed multiplier (`0.5`..`2.0`).
   * @param {number} rate
   */
  setSpeed(rate) {
    const r = clamp(Number(rate) || 1.0, 0.25, 4.0);
    this.playbackRate = r;
    if (this.ctx && this.playbackId >= 0 && typeof this.ctx.setPlaybackRate === 'function') {
      attempt('ctx.setPlaybackRate', () => this.ctx.setPlaybackRate(this.playbackId, r));
    }
    this._emitState();
  }

  _scheduleTick() {
    if (this._raf || !this.playing) return;
    const tick = () => {
      this._raf = 0;
      if (!this.playing) return;
      const now = performance.now();
      const dtSec = Math.max(0, (now - this._lastTickMs) / 1000);
      this._lastTickMs = now;

      this.currentTime = Math.min(this.duration, this.currentTime + dtSec * this.playbackRate);
      this._emitTime();

      if (this.currentTime >= this.duration) {
        this.playing = false;
        if (this.ctx && this.playbackId >= 0 && typeof this.ctx.stopPlayback === 'function') {
          attempt('ctx.stopPlayback', () => this.ctx.stopPlayback(this.playbackId));
        }
        this.playbackId = -1;
        this._emitState();
        return;
      }

      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _releaseClip() {
    if (this.ctx && this.clipId >= 0 && typeof this.ctx.deleteClip === 'function') {
      attempt('ctx.deleteClip', () => this.ctx.deleteClip(this.clipId));
    }
    this.clipId = -1;
    this.playbackId = -1;
  }

  _emitTime() {
    if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime, this.duration);
  }

  _emitState() {
    if (this.onStateChange) {
      this.onStateChange({
        playing: this.playing,
        currentTime: this.currentTime,
        duration: this.duration,
        playbackRate: this.playbackRate,
      });
    }
  }
}
