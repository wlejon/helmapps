/**
 * Microphone capture engine built on `bro.mic` (`api('mic')`).
 * Supports both live hardware capture and deterministic synthetic feed mode
 * (`live: false` + `bro.mic.feed(...)`) for headless testing and environments
 * without an audio input device.
 */

import { api, attempt } from '/lib/dom.js';
import { computePeaks } from './wav.js';

const DEFAULT_RATE = 16000;
const DEFAULT_CHUNK_FRAMES = 320; // 20 ms at 16 kHz (50 chunks/sec)
const MAX_ROLLING_PEAKS = 180;

export class CaptureEngine {
  constructor({ onUpdate, headless = false } = {}) {
    this.onUpdate = onUpdate || null;
    this.headless = !!headless;
    this.useSyntheticMic = !!headless;

    this.active = false;
    this.paused = false;
    this.sampleRate = DEFAULT_RATE;
    this.chunkFrames = DEFAULT_CHUNK_FRAMES;
    this.agc = false;

    this.chunks = [];
    this.totalSamples = 0;
    this.duration = 0;
    this.peak = 0;
    this.rms = 0;
    this.rollingPeaks = [];
    this.markers = [];

    this._raf = 0;
    this._synthPhase = 0;
    this._usingBroMic = false;
  }

  /** Whether `bro.mic` is available in this build. */
  isAvailable() {
    return !!api('mic');
  }

  /**
   * Start capturing audio from `bro.mic`.
   * @param {{ sampleRate?: number, chunkFrames?: number, agc?: boolean, live?: boolean, autoFeed?: boolean }} [opts]
   * @returns {boolean}
   */
  start(opts = {}) {
    if (this.active) this.cancel();

    const mic = api('mic');
    this.sampleRate = opts.sampleRate || DEFAULT_RATE;
    this.chunkFrames = opts.chunkFrames || Math.max(160, Math.round(this.sampleRate * 0.02));
    this.agc = opts.agc != null ? !!opts.agc : false;
    const wantLive = opts.live != null ? !!opts.live : !this.useSyntheticMic;
    this.autoFeed = opts.autoFeed != null ? !!opts.autoFeed : !wantLive;

    this.chunks = [];
    this.totalSamples = 0;
    this.duration = 0;
    this.peak = 0;
    this.rms = 0;
    this.rollingPeaks = [];
    this.markers = [];
    this.active = true;
    this.paused = false;
    this._synthPhase = 0;
    this._usingBroMic = false;

    if (mic && typeof mic.start === 'function') {
      const started = attempt('mic.start', () => {
        mic.start({
          chunkFrames: this.chunkFrames,
          targetRate: this.sampleRate,
          samples: true,
          agc: this.agc,
          live: wantLive,
          onChunk: (c) => this._onChunk(c),
        });
        return true;
      }, false);

      if (started) {
        this._usingBroMic = true;
      } else if (wantLive) {
        // Fallback to offline/synthetic tap on `bro.mic` if opening live device failed
        const fallbackStarted = attempt('mic.start(offline)', () => {
          mic.start({
            chunkFrames: this.chunkFrames,
            targetRate: this.sampleRate,
            samples: true,
            agc: this.agc,
            live: false,
            onChunk: (c) => this._onChunk(c),
          });
          return true;
        }, false);
        this._usingBroMic = !!fallbackStarted;
        this.autoFeed = true;
      }
    }

    this._schedulePump();
    if (this.onUpdate) this.onUpdate(this.snapshot());
    return true;
  }

  /** Drain any pending chunks from `bro.mic` immediately. */
  drain() {
    const mic = api('mic');
    if (this._usingBroMic && mic && typeof mic.drain === 'function') {
      attempt('mic.drain', () => mic.drain());
    }
  }

  /**
   * Feed synthetic Float32Array samples into `bro.mic` (at engine rate) or directly
   * into the chunk accumulator if `bro.mic` is unavailable.
   * @param {Float32Array} samples
   * @param {number} [rate]
   */
  feed(samples, rate) {
    if (!this.active || this.paused || !samples || !samples.length) return;
    const mic = api('mic');
    if (this._usingBroMic && mic && typeof mic.feed === 'function') {
      const engRate = rate || (typeof mic.engineRate === 'function' ? mic.engineRate() : 48000) || 48000;
      mic.feed(samples, engRate);
      this.drain();
      return;
    }
    this._ingestSamples(samples);
  }

  /** Pause recording without closing the mic stream. */
  pause() {
    if (!this.active || this.paused) return false;
    this.drain();
    this.paused = true;
    this.peak = 0;
    this.rms = 0;
    if (this.onUpdate) this.onUpdate(this.snapshot());
    return true;
  }

  /** Resume a paused recording. */
  resume() {
    if (!this.active || !this.paused) return false;
    this.paused = false;
    this._schedulePump();
    if (this.onUpdate) this.onUpdate(this.snapshot());
    return true;
  }

  /**
   * Add a timestamped marker at the current recording position.
   * @param {string} [label]
   * @returns {{ timeSec: number, label: string }|null}
   */
  addMarker(label) {
    if (!this.active) return null;
    this.drain();
    const timeSec = Math.round(this.duration * 100) / 100;
    const text = (label && String(label).trim()) || `Marker ${this.markers.length + 1}`;
    const marker = { timeSec, label: text };
    this.markers.push(marker);
    if (this.onUpdate) this.onUpdate(this.snapshot());
    return marker;
  }

  /** Discard active recording and stop microphone tap. */
  cancel() {
    this._stopTap();
    this.active = false;
    this.paused = false;
    this.chunks = [];
    this.totalSamples = 0;
    this.duration = 0;
    this.peak = 0;
    this.rms = 0;
    this.rollingPeaks = [];
    this.markers = [];
    if (this.onUpdate) this.onUpdate(this.snapshot());
  }

  /**
   * Stop recording and return the assembled PCM clip, waveform peaks, and markers.
   * @returns {{ samples: Float32Array, sampleRate: number, duration: number, peaks: Float32Array, markers: Array<{ timeSec: number, label: string }> }|null}
   */
  stop() {
    if (!this.active) return null;
    this.drain();
    this._stopTap();

    const samples = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const sampleRate = this.sampleRate;
    const duration = sampleRate > 0 ? samples.length / sampleRate : 0;
    const peaks = computePeaks(samples, 256, 1);
    const markers = this.markers.map((m) => ({ ...m }));

    this.active = false;
    this.paused = false;
    this.chunks = [];
    this.totalSamples = 0;
    this.peak = 0;
    this.rms = 0;

    if (this.onUpdate) this.onUpdate(this.snapshot());
    return { samples, sampleRate, duration, peaks, markers };
  }

  snapshot() {
    return {
      active: this.active,
      paused: this.paused,
      duration: this.duration,
      sampleRate: this.sampleRate,
      peak: this.peak,
      rms: this.rms,
      rollingPeaks: this.rollingPeaks,
      markers: this.markers,
      totalSamples: this.totalSamples,
    };
  }

  _stopTap() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    const mic = api('mic');
    if (this._usingBroMic && mic && typeof mic.stop === 'function') {
      attempt('mic.stop', () => mic.stop());
    }
    this._usingBroMic = false;
  }

  _schedulePump() {
    if (this._raf || !this.active) return;
    const tick = () => {
      this._raf = 0;
      if (!this.active) return;
      if (!this.paused && this.autoFeed) {
        this._pumpSynthetic();
      }
      if (this.onUpdate) this.onUpdate(this.snapshot());
      if (this.active) {
        this._raf = requestAnimationFrame(tick);
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  _pumpSynthetic() {
    const mic = api('mic');
    const engRate = (this._usingBroMic && mic && typeof mic.engineRate === 'function')
      ? (mic.engineRate() || 48000)
      : this.sampleRate;
    // Generate ~20 ms of natural voice-like harmonic + envelope waveform per frame
    const frames = Math.max(128, Math.round(engRate * 0.02));
    const buf = new Float32Array(frames);
    let phase = this._synthPhase;
    const step = 1 / engRate;
    for (let i = 0; i < frames; i++) {
      const t = phase + i * step;
      const env = 0.35 + 0.25 * Math.sin(2 * Math.PI * 2.3 * t) + 0.15 * Math.cos(2 * Math.PI * 5.1 * t);
      const carrier = 0.65 * Math.sin(2 * Math.PI * 220 * t) +
                      0.25 * Math.sin(2 * Math.PI * 440 * t) +
                      0.10 * Math.sin(2 * Math.PI * 660 * t);
      buf[i] = carrier * env;
    }
    this._synthPhase = phase + frames * step;

    if (this._usingBroMic && mic && typeof mic.feed === 'function') {
      attempt('mic.feed', () => mic.feed(buf, engRate));
    } else {
      this._ingestSamples(buf);
    }
  }

  _onChunk(chunk) {
    if (!this.active || this.paused || !chunk) return;
    if (chunk.samples && chunk.samples.length) {
      const copy = new Float32Array(chunk.samples);
      this.chunks.push(copy);
      this.totalSamples += copy.length;
      this.duration = this.totalSamples / this.sampleRate;
    }
    const pk = typeof chunk.peak === 'number' ? chunk.peak : 0;
    const rm = typeof chunk.rms === 'number' ? chunk.rms : pk * 0.7;
    this.peak = Math.min(1, Math.max(0, pk));
    this.rms = Math.min(1, Math.max(0, rm));
    this.rollingPeaks.push(this.peak);
    if (this.rollingPeaks.length > MAX_ROLLING_PEAKS) {
      this.rollingPeaks.shift();
    }
  }

  _ingestSamples(samples) {
    const copy = new Float32Array(samples);
    this.chunks.push(copy);
    this.totalSamples += copy.length;
    this.duration = this.totalSamples / this.sampleRate;

    let max = 0;
    let sumSq = 0;
    for (let i = 0; i < copy.length; i++) {
      const v = Math.abs(copy[i]);
      if (v > max) max = v;
      sumSq += v * v;
    }
    this.peak = Math.min(1, max);
    this.rms = Math.min(1, Math.sqrt(sumSq / Math.max(1, copy.length)));
    this.rollingPeaks.push(this.peak);
    if (this.rollingPeaks.length > MAX_ROLLING_PEAKS) {
      this.rollingPeaks.shift();
    }
  }
}
