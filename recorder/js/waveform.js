/**
 * Canvas waveform visualizer & interactive scrubber for Sound Recorder.
 * Supports two modes:
 *  1. 'live': real-time scrolling waveform bars + live peak/RMS meter + marker flags.
 *  2. 'playback': full clip peak envelope with played/unplayed coloring, playhead,
 *     pointer scrubbing, and clickable marker flags.
 *
 * Uses only CSS tokens from `/lib/css/tokens.css` read via `getComputedStyle`.
 */

import { h, clamp } from '/lib/dom.js';
import { formatDuration } from '/lib/format.js';

export class WaveformView {
  /**
   * @param {{ onScrub?: (timeSec: number) => void, onMarkerClick?: (marker: {timeSec: number, label: string}, index: number) => void }} [opts]
   */
  constructor({ onScrub, onMarkerClick } = {}) {
    this.onScrub = onScrub || null;
    this.onMarkerClick = onMarkerClick || null;

    this.mode = 'playback'; // 'live' | 'playback'
    this.peaks = [];
    this.duration = 0;
    this.currentTime = 0;
    this.livePeak = 0;
    this.liveRms = 0;
    this.markers = [];
    this.scrubbing = false;

    this.canvas = h('canvas.rec-waveform-canvas', { width: 640, height: 180 });
    this.flagBar = h('div.rec-waveform-flags');
    this.el = h('div.rec-waveform-box', { tabindex: '0', role: 'slider', 'aria-label': 'Audio waveform timeline' },
      this.canvas,
      this.flagBar
    );

    this._width = 640;
    this._height = 180;
    this._dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._themeKey = '';
    this._colors = null;
    this._markerSig = '';

    this._bindEvents();
  }

  /**
   * Update state for Live Recording Mode and redraw.
   * @param {{ rollingPeaks: Array<number>, duration: number, peak: number, rms: number, markers: Array<{timeSec: number, label: string}> }} state
   */
  setLiveState(state) {
    this.mode = 'live';
    this.peaks = state.rollingPeaks || [];
    this.duration = state.duration || 0;
    this.currentTime = this.duration;
    this.livePeak = state.peak || 0;
    this.liveRms = state.rms || 0;
    this.markers = state.markers || [];
    this._syncMarkerFlags();
    this.draw();
  }

  /**
   * Update state for Playback / Inspector Mode and redraw.
   * @param {{ peaks: Array<number>|Float32Array, duration: number, currentTime: number, markers: Array<{timeSec: number, label: string}> }} state
   */
  setPlaybackState(state) {
    this.mode = 'playback';
    if (state.peaks !== undefined) this.peaks = state.peaks || [];
    if (state.duration !== undefined) this.duration = Math.max(0, Number(state.duration) || 0);
    if (state.currentTime !== undefined) this.currentTime = clamp(Number(state.currentTime) || 0, 0, this.duration || 0);
    if (state.markers !== undefined) {
      this.markers = state.markers || [];
      this._syncMarkerFlags();
    }
    this.el.setAttribute('aria-valuenow', this.currentTime.toFixed(2));
    this.el.setAttribute('aria-valuemax', this.duration.toFixed(2));
    this.draw();
  }

  /** Update only the playhead time in playback mode without rebuilding marker flags. */
  setCurrentTime(timeSec) {
    this.currentTime = clamp(Number(timeSec) || 0, 0, this.duration || 0);
    this.el.setAttribute('aria-valuenow', this.currentTime.toFixed(2));
    this.draw();
  }

  /** Read layout dimensions once before drawing when resized. */
  measure() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w > 0 && h > 0) {
      this._width = w;
      this._height = h;
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      this._dpr = dpr;
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas.width = cw;
        this.canvas.height = ch;
      }
    }
  }

  draw() {
    const ctx = this.canvas.getContext && this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this._width || 640;
    const h = this._height || 180;
    const dpr = this._dpr || 1;
    const colors = this._resolveColors();

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const midY = h / 2;

    // Subtle center baseline
    ctx.strokeStyle = colors.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    if (this.mode === 'live') {
      this._drawLive(ctx, w, h, midY, colors);
    } else {
      this._drawPlayback(ctx, w, h, midY, colors);
    }

    ctx.restore();
  }

  _drawLive(ctx, w, h, midY, colors) {
    const meterW = 24;
    const waveW = Math.max(40, w - meterW - 12);
    const barStep = 4;
    const barW = 2.5;
    const maxBars = Math.floor(waveW / barStep);
    const peaks = this.peaks || [];
    const startIdx = Math.max(0, peaks.length - maxBars);
    const count = peaks.length - startIdx;
    const maxAmp = (h * 0.42);

    ctx.fillStyle = colors.danger;
    for (let i = 0; i < count; i++) {
      const p = clamp(Number(peaks[startIdx + i]) || 0.02, 0.02, 1);
      const bh = Math.max(3, p * maxAmp * 2);
      const x = waveW - (count - i) * barStep;
      const y = midY - bh / 2;
      ctx.fillRect(x, y, barW, bh);
    }

    // Draw markers on the live timeline
    if (this.duration > 0 && this.markers.length) {
      ctx.strokeStyle = colors.warn;
      ctx.lineWidth = 1.5;
      for (const m of this.markers) {
        const frac = clamp(m.timeSec / this.duration, 0, 1);
        const mx = Math.round(frac * waveW);
        ctx.beginPath();
        ctx.moveTo(mx, 8);
        ctx.lineTo(mx, h - 8);
        ctx.stroke();
      }
    }

    // Live playhead at right edge of rolling wave
    ctx.strokeStyle = colors.t1;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(waveW, 6);
    ctx.lineTo(waveW, h - 6);
    ctx.stroke();

    // Vertical peak/RMS level meter on the right
    const mx = w - meterW;
    const my = 12;
    const mh = h - 24;
    ctx.fillStyle = colors.well;
    ctx.fillRect(mx, my, 14, mh);

    const peakH = Math.round(clamp(this.livePeak, 0, 1) * mh);
    const rmsH = Math.round(clamp(this.liveRms, 0, 1) * mh);

    ctx.fillStyle = this.livePeak > 0.9 ? colors.danger : this.livePeak > 0.75 ? colors.warn : colors.ok;
    ctx.fillRect(mx, my + mh - peakH, 14, peakH);

    ctx.fillStyle = colors.accent;
    ctx.fillRect(mx + 3, my + mh - rmsH, 8, rmsH);
  }

  _drawPlayback(ctx, w, h, midY, colors) {
    const peaks = this.peaks || [];
    const n = peaks.length;
    const progress = this.duration > 0 ? clamp(this.currentTime / this.duration, 0, 1) : 0;
    const playheadX = progress * w;
    const maxAmp = h * 0.40;

    if (n > 0) {
      const barStep = w / n;
      const barW = Math.max(1.5, barStep * 0.68);
      for (let i = 0; i < n; i++) {
        const p = clamp(Number(peaks[i]) || 0.03, 0.03, 1);
        const bh = Math.max(3, p * maxAmp * 2);
        const x = i * barStep + (barStep - barW) / 2;
        const y = midY - bh / 2;
        ctx.fillStyle = (x + barW * 0.5 <= playheadX) ? colors.accent : colors.unplayed;
        ctx.fillRect(x, y, barW, bh);
      }
    }

    // Marker vertical lines
    if (this.duration > 0 && this.markers && this.markers.length) {
      ctx.strokeStyle = colors.warn;
      ctx.lineWidth = 1.5;
      for (const m of this.markers) {
        const frac = clamp(m.timeSec / this.duration, 0, 1);
        const mx = Math.round(frac * w);
        ctx.beginPath();
        ctx.moveTo(mx, 4);
        ctx.lineTo(mx, h - 4);
        ctx.stroke();
      }
    }

    // Playhead cursor line & knob
    if (this.duration > 0) {
      ctx.strokeStyle = colors.t1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
      ctx.stroke();

      ctx.fillStyle = colors.t1;
      ctx.beginPath();
      ctx.arc(playheadX, 8, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _syncMarkerFlags() {
    const sig = JSON.stringify({ d: Math.round(this.duration * 100), m: this.markers });
    if (sig === this._markerSig) return;
    this._markerSig = sig;

    const dur = Math.max(0.01, this.duration || 1);
    const flags = (this.markers || []).map((m, idx) => {
      const pct = clamp((Number(m.timeSec) || 0) / dur, 0, 1) * 100;
      const btn = h('button.rec-marker-flag', {
        style: { left: `${pct.toFixed(2)}%` },
        title: `${m.label} (${formatDuration(m.timeSec)})`,
        dataset: { markerIndex: String(idx) },
        onclick: (e) => {
          e.stopPropagation();
          if (this.onMarkerClick) this.onMarkerClick(m, idx);
          else if (this.onScrub) this.onScrub(m.timeSec);
        },
      }, h('span.rec-marker-flag-dot'), h('span.rec-marker-flag-label', m.label));
      return btn;
    });
    this.flagBar.replaceChildren(...flags);
  }

  _resolveColors() {
    const cs = getComputedStyle(document.documentElement);
    const hue = (cs.getPropertyValue('--accent-h') || '255').trim();
    if (this._colors && this._themeKey === hue) return this._colors;
    this._themeKey = hue;

    const readToken = (name) => {
      const raw = (cs.getPropertyValue(name) || '').trim();
      return raw.replace(/var\(--accent-h\)/g, hue);
    };

    this._colors = {
      accent: readToken('--accent'),
      unplayed: readToken('--t4'),
      t1: readToken('--t1'),
      warn: readToken('--warn'),
      danger: readToken('--danger'),
      ok: readToken('--ok'),
      hairline: readToken('--hairline'),
      well: readToken('--well-3'),
    };
    return this._colors;
  }

  _bindEvents() {
    const scrubFromPointer = (e) => {
      if (this.mode !== 'playback' || this.duration <= 0) return;
      const r = this.canvas.getBoundingClientRect();
      if (r.width <= 0) return;
      const frac = clamp((e.clientX - r.left) / r.width, 0, 1);
      const t = frac * this.duration;
      this.setCurrentTime(t);
      if (this.onScrub) this.onScrub(t);
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.mode !== 'playback') return;
      this.scrubbing = true;
      if (this.canvas.setPointerCapture) {
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
      scrubFromPointer(e);
      e.preventDefault();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.scrubbing) scrubFromPointer(e);
    });

    const endScrub = (e) => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      if (this.canvas.releasePointerCapture) {
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    this.canvas.addEventListener('pointerup', endScrub);
    this.canvas.addEventListener('pointercancel', endScrub);

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        this.measure();
        this.draw();
      });
      this._ro.observe(this.canvas);
    }
    window.addEventListener('resize', () => {
      this.measure();
      this.draw();
    });
  }
}
