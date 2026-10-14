/**
 * Canvas 2D time-series chart components for the Performance page.
 *
 * Follows helm rules:
 *  - Token colours are read from getComputedStyle(document.documentElement).
 *  - Redraws only once per sample tick (never a 60 fps loop).
 *  - Batch-reads layout boxes before mutating canvas sizes to avoid forced layouts.
 */

import { RING_SIZE } from './sys-sampler.js';

export function readChartTheme() {
  const style = getComputedStyle(document.documentElement);
  const token = (name) => (style.getPropertyValue(name) || '').trim();
  return {
    accent: token('--accent'),
    accentSoft: token('--accent-soft'),
    accentFaint: token('--accent-faint'),
    ok: token('--ok'),
    warn: token('--warn'),
    danger: token('--danger'),
    t3: token('--t3'),
    t4: token('--t4'),
    hairline: token('--hairline'),
  };
}

export class LineChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number} [opts.max=100]      Fixed maximum (null/0 for auto-scale)
   * @param {number} [opts.minMax=1024]  Minimum ceiling when auto-scaling
   * @param {number} [opts.points=RING_SIZE]
   */
  constructor(canvas, { max = 100, minMax = 1024, points = RING_SIZE } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fixedMax = max;
    this.minMax = minMax;
    this.points = points;
    this.drawCount = 0;
    this.lastMax = max || minMax;
    this.lastSeries = [];
  }

  /**
   * Measure canvas CSS box before any DOM/canvas attribute writes.
   */
  measure() {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 100;
    return { w, h };
  }

  /**
   * Draw 1 or 2 series onto the canvas.
   * @param {Array<{ data: number[], stroke: string, fill?: string }>} seriesList
   * @param {object} [metrics]  Pre-measured { w, h, dpr, theme }
   */
  draw(seriesList, metrics = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const theme = (metrics && metrics.theme) || readChartTheme();
    const w = (metrics && metrics.w) || this.canvas.clientWidth || 300;
    const h = (metrics && metrics.h) || this.canvas.clientHeight || 100;
    const dpr = (metrics && metrics.dpr) || window.devicePixelRatio || 1;

    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Subtle horizontal grid lines (25%, 50%, 75%)
    ctx.strokeStyle = theme.hairline;
    ctx.lineWidth = 1;
    for (const frac of [0.25, 0.5, 0.75]) {
      const y = Math.round(h * frac) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Determine ceiling
    let ceiling = this.fixedMax;
    if (!ceiling || ceiling <= 0) {
      let peak = this.minMax;
      for (const s of seriesList) {
        const arr = s.data || [];
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] > peak) peak = arr[i];
        }
      }
      ceiling = peak * 1.15;
    }
    this.lastMax = ceiling;
    this.lastSeries = seriesList;

    const maxPts = this.points;
    const stepX = maxPts > 1 ? w / (maxPts - 1) : w;
    const padTop = 3;
    const padBot = 2;
    const plotH = Math.max(1, h - padTop - padBot);

    for (const s of seriesList) {
      const data = s.data || [];
      if (!data.length) continue;
      const offset = Math.max(0, maxPts - data.length);

      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (offset + i) * stepX;
        const norm = Math.min(1, Math.max(0, (data[i] || 0) / ceiling));
        const y = padTop + plotH * (1 - norm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      if (s.fill) {
        ctx.save();
        const lastX = (offset + data.length - 1) * stepX;
        const firstX = offset * stepX;
        ctx.lineTo(lastX, h);
        ctx.lineTo(firstX, h);
        ctx.closePath();
        ctx.fillStyle = s.fill;
        ctx.fill();
        ctx.restore();

        // Re-trace top path for stroke
        ctx.beginPath();
        for (let i = 0; i < data.length; i++) {
          const x = (offset + i) * stepX;
          const norm = Math.min(1, Math.max(0, (data[i] || 0) / ceiling));
          const y = padTop + plotH * (1 - norm);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = s.stroke || theme.accent;
      ctx.lineWidth = 1.75;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    ctx.restore();
    this.drawCount++;
  }
}
