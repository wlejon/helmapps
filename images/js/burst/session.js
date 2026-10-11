/**
 * A burst being stabilized: its frames, the subject in each, and the work
 * that finds it, run on the tracking worker (js/burst/track-worker.js).
 *
 *   const s = new BurstSession({ onChange: () => view.refresh() });
 *   await s.useModel(findModelSpec());          // or { kind: 'key', color } (tests)
 *   await s.load(paths, refPath);               // times and sizes, no decode
 *   await s.seed(s.ref, points, labels);        // the subject in the reference, from clicks
 *   await s.track();                            // carried to every other frame
 *   s.frames[k] = { path, name, width, height, time, included, hold, track, status }
 *   status: 'pending' | 'tracking' | 'seed' | 'ok' | 'low' | 'lost'
 *
 * Tracking goes out from the reference both ways, each frame from the one
 * next to it (nearer the reference), starting each step from the step
 * before's motion: the steps compose, where aligning every frame to the
 * first would lose the subject once the camera pans. A step across a gap
 * between bursts starts from nothing and searches wider. A frame the user
 * clicks to correct (a re-seed) is carried on from, to the next frame the
 * user set or the end.
 */

import { WorkerClient } from './rpc.js';
import { MODEL_NAMES, DOWNLOAD_MODEL } from './model.js';
import { exifSeconds, fillTimes, gapThreshold } from './timing.js';

const path = require('path');

/** Below this a tracked frame is marked for a look. */
export const LOW_CONFIDENCE = 0.45;

/**
 * The best segmentation model this machine has (bro.models), as the
 * tracking worker's init takes it, or null with `searched` saying where it looked.
 */
export function findModelSpec() {
  const models = typeof bro !== 'undefined' && bro.models ? bro.models : null;
  if (!models || typeof bro.vision === 'undefined' || bro.vision.available === false) return null;
  for (const m of MODEL_NAMES) {
    if (m.kind === 'sam2' && typeof bro.vision.loadSam2 !== 'function') continue;
    const dir = models.find(m.name);
    if (dir) return { kind: m.kind, dir, name: m.name };
  }
  return null;
}

/**
 * The model Select Subject can download when findModelSpec() has none (this
 * bro can fetch models and run SAM 2.1), or null.
 */
export function downloadableModel() {
  if (typeof bro === 'undefined' || !bro.models || typeof bro.models.fetch !== 'function') return null;
  if (typeof bro.vision === 'undefined' || bro.vision.available === false || typeof bro.vision.loadSam2 !== 'function') return null;
  return DOWNLOAD_MODEL;
}

export function statusOf(track) {
  if (!track) return 'pending';
  if (!(track.area > 0)) return 'lost';
  if (track.seed) return 'seed';
  return track.confidence < LOW_CONFIDENCE ? 'low' : 'ok';
}

export class BurstSession {
  constructor({ onChange = null, trackWorker = null } = {}) {
    this.onChange = onChange;
    this.worker = trackWorker || new WorkerClient('js/burst/track-worker.js');
    this.model = null;          // { kind, dir?, name } once loaded
    this.modelInfo = null;      // what the worker loaded: { name, device }
    this.frames = [];
    this.ref = -1;
    this.generation = 0;        // a newer run makes an older one stop
    this.busy = false;
    this.error = '';
    this.timings = { segment: [], step: [] };
  }

  changed() { if (this.onChange) this.onChange(); }

  async useModel(spec) {
    if (!spec) throw new Error('no segmentation model');
    if (this.model && JSON.stringify(this.model) === JSON.stringify(spec)) return this.modelInfo;
    this.modelInfo = await this.worker.call({ op: 'init', model: spec });
    this.model = spec;
    return this.modelInfo;
  }

  /** The frames: these photos in this order, `refPath` the reference. Reads only their headers. */
  async load(paths, refPath) {
    this.generation++;
    const info = await this.info(paths);
    const times = fillTimes(info.map((i) => i.time));
    this.frames = paths.map((p, k) => ({
      path: p, name: path.basename(p), width: info[k].width || 0, height: info[k].height || 0,
      error: info[k].error || '', time: times[k], dated: !!info[k].dateTaken,
      included: !info[k].error, hold: null, track: null, status: 'pending',
    }));
    this.ref = Math.max(0, paths.indexOf(refPath));
    this.changed();
    return this.frames;
  }

  /** Whether the step between neighbours a and b is a gap between bursts. */
  isGap(a, b) {
    const times = this.frames.map((f) => f.time);
    const steps = times.slice(1).map((t, i) => t - times[i]);
    const limit = gapThreshold(steps);
    const d = Math.abs(times[b] - times[a]);
    return d > limit;
  }

  /** The subject of frame k from clicks (full coordinates; labels 1 add, 0 remove). */
  segment(k, points, labels, rect = null) {
    return this.segmentPath(this.frames[k].path, points, labels, rect);
  }

  /** The subject of any photo from clicks: the subject tool's, before there are frames. */
  async segmentPath(p, points, labels, rect = null) {
    const t0 = Date.now();
    const { frame } = await this.worker.call({ op: 'segment', path: p, points, labels, rect });
    this.timings.segment.push(Date.now() - t0);
    return frame;
  }

  /** Width, height and EXIF time of photos, from their headers. */
  async info(paths) {
    const { info } = await this.worker.call({ op: 'info', paths });
    return info.map((i) => ({ ...i, time: exifSeconds(i.dateTaken) }));
  }

  /**
   * Set frame k's subject from clicks, keeping how it was reached (its step
   * from the frame before, if any), and mark it as the user's.
   */
  async seed(k, points, labels) {
    const prevRect = this.frames[k].track && this.frames[k].track.mask && this.frames[k].clicks ? this.frames[k].track.mask.rect : null;
    const t = await this.segment(k, points, labels, prevRect && points.length > 1 ? prevRect : null);
    this.place(k, t, { clicks: { points, labels } });
    return t;
  }

  /** Put a segment result (from the subject tool or a click here) on frame k as a seed. */
  place(k, t, { clicks = null } = {}) {
    const f = this.frames[k];
    const old = f.track;
    f.track = { ...t, seed: true, from: old ? old.from : -1, gap: old ? old.gap : false,
      subject: old ? old.subject : null, scene: old ? old.scene : null,
      subjectNcc: old ? old.subjectNcc : null, sceneNcc: old ? old.sceneNcc : null };
    if (k === this.ref) f.track.from = -1;
    f.clicks = clicks;
    f.status = statusOf(f.track);
    this.changed();
  }

  /**
   * Carry the subject out from the seeds: from the reference both ways, or
   * from `from` away from the reference only. Stops at a frame the user set.
   */
  async track({ from = null } = {}) {
    const gen = ++this.generation;
    this.busy = true;
    this.error = '';
    this.changed();
    try {
      const starts = from == null ? [[this.ref, 1], [this.ref, -1]] : [[from, from >= this.ref ? 1 : -1]];
      if (from != null && from === this.ref) starts.push([from, -1]);
      for (const [start, dir] of starts) {
        for (let k = start + dir; k >= 0 && k < this.frames.length; k += dir) {
          if (gen !== this.generation) return false;
          const f = this.frames[k];
          if (f.track && f.track.seed && f.clicks) break;              // the user's own: stop there
          const n = k - dir;
          const prev = this.frames[n].track;
          if (!prev || !(prev.area > 0) || this.frames[n].error || f.error) {
            for (let j = k; j >= 0 && j < this.frames.length; j += dir) {
              if (this.frames[j].track && this.frames[j].clicks) break;
              this.frames[j].track = null;
              this.frames[j].status = 'lost';
            }
            break;
          }
          const gap = this.isGap(n, k);
          const carried = !this.frames[n].track.gap && this.frames[n].track.from === n - dir;
          f.status = 'tracking';
          this.changed();
          const t0 = Date.now();
          const { frame } = await this.worker.call({
            op: 'step', from: this.frames[n].path, to: f.path, prev, gap, begin: k === start + dir,
            lastSubject: carried ? prev.subject : null, lastScene: carried ? prev.scene : null,
          });
          if (gen !== this.generation) return false;
          this.timings.step.push(Date.now() - t0);
          f.track = { ...frame, from: n, gap };
          f.clicks = null;
          f.status = statusOf(f.track);
          this.changed();
        }
      }
      return true;
    } catch (err) {
      if (gen === this.generation) this.error = err.message;
      return false;
    } finally {
      if (gen === this.generation) { this.busy = false; this.changed(); }
    }
  }

  /** Stop a run in progress (its current step finishes and is dropped). */
  stop() {
    this.generation++;
    this.busy = false;
    for (const f of this.frames) if (f.status === 'tracking') f.status = statusOf(f.track);
    this.changed();
  }

  /** The tracked frames in the shape js/burst/stabilize.js reads (a frame with no subject is none). */
  tracked() {
    return this.frames.map((f) => (f.track && f.track.area > 0 ? {
      width: f.width, height: f.height, centroid: f.track.centroid, area: f.track.area, bbox: f.track.bbox,
      confidence: f.track.confidence, from: f.track.from, subject: f.track.subject, scene: f.track.scene,
      subjectNcc: f.track.subjectNcc, gap: f.track.gap,
    } : null));
  }

  /** Every frame has a subject (none pending, none lost) and nothing is running. */
  ready() {
    return !this.busy && this.frames.length > 1 && this.frames.every((f) => !f.included || (f.track && f.track.area > 0));
  }

  dispose() {
    this.generation++;
    this.worker.terminate();
  }
}
