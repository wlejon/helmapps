/**
 * Find Animals for one folder at a time: which photos have an animal, its
 * species, and the bursts they were shot in. No DOM; feature.js shows it.
 *
 *   const a = new Analysis({ cacheDir, onChange });
 *   a.setFolder(dir, paths, opts);   // opts: the analyzer's (models.js paths, or a test stub)
 *   a.results   Map pathKey -> record (records.js; a.record(path) finds one)
 *   a.burstOf(path)   bro.vision.wildlife.groupBursts' burst holding it, or null
 *   a.taxa            the species lists' common names of genera and up (labels()' taxa)
 *   a.names           every name of the lists (bro.vision.wildlife.nameEntries)
 *   a.progress()      { state, done, total, error }
 *   a.pause(); a.resume(); a.stop();
 *
 * The work is off the page thread: a store worker reads the folder's cached
 * records and stats its photos (store-worker.js), two decode workers decode
 * and measure sharpness (decode-worker.js), one model worker runs
 * bro.vision.wildlife (analyze-worker.js; the models load once). The page
 * only relays a decoded image from a decoder to the models (a transfer) and
 * keeps the answers. A photo whose path, size, mtime and settings match its
 * cached record is not analysed again, so a folder opened again is answered
 * at once and a changed one only for what changed. Bursts are regrouped from
 * all the folder's records at most every GROUP_MS while answers arrive.
 */

import { WorkerClient } from '../burst/rpc.js';
import { DETECT_SIZE, SHARP_SIZE, cacheFile, makeRecord, errorRecord, pathKey } from './records.js';
import { formatOf } from '../formats.js';

/** Photos between the decoders and the models at once. */
const IN_FLIGHT = 4;
const DECODERS = 2;
/** Records are written to the cache at most this often. */
const SAVE_MS = 1000;
/** Bursts and the grid follow new answers at most this often. */
const GROUP_MS = 250;
/** The models are freed after this long with nothing to do. */
const IDLE_MS = 120000;

/** Whether a photo is analysed: the raster formats bro.image decodes. */
export function analysable(p) {
  const f = formatOf(p);
  return !!f && f.decode === 'worker';
}

export class Analysis {
  constructor({ cacheDir, onChange = null } = {}) {
    this.cacheDir = cacheDir;
    this.onChange = onChange;
    this.store = new WorkerClient('js/wildlife/store-worker.js');
    this.models = new WorkerClient('js/wildlife/analyze-worker.js');
    this.decoders = [];
    this.state = 'idle';     // 'idle' | 'loading' | 'running' | 'paused' | 'done' | 'error'
    this.error = '';
    this.dir = '';
    this.file = '';
    this.gen = 0;            // a newer folder (or settings) makes older answers stale
    this.opts = null;
    this.optsKey = '';
    this.hash = '';
    this.taxa = {};          // the species lists' names of genera and up (labels())
    this.names = [];         // every name of the lists (nameEntries), for her corrections
    this.opened = '';        // the opts key the models were loaded with
    this.results = new Map();
    this.bursts = [];
    this.byPath = new Map(); // path -> burst
    this.total = 0;
    this.todo = [];
    this.inflight = new Map();
    this.seq = 0;
    this.analysed = 0;       // photos sent to the models, ever (tests count what a re-open redoes)
    this.saves = [];
    this.saveTimer = null;
    this.groupTimer = null;
    this.idleTimer = null;
    this.version = 0;
  }

  changed() { this.version++; if (this.onChange) this.onChange(this); }

  progress() {
    return { state: this.state, done: this.results.size, total: this.total, error: this.error };
  }

  /** A photo's record, or null; `p` in any form of its path (records.js pathKey). */
  record(p) { return this.results.get(pathKey(p)) || null; }

  burstOf(p) { return this.byPath.get(pathKey(p)) || null; }

  /**
   * Analyse the photos of `dir` (`paths`, the folder's listing) with the
   * analyzer `opts`. Called again for the same folder (a file came, went or
   * changed), only what changed is analysed.
   */
  async setFolder(dir, paths, opts) {
    const key = JSON.stringify(opts);
    if (dir !== this.dir || key !== this.optsKey) {
      this.gen++;
      this.dir = dir;
      this.file = cacheFile(this.cacheDir, dir);
      this.results = new Map();
      this.bursts = [];
      this.byPath = new Map();
      this.todo = [];
      this.total = 0;
      if (key !== this.optsKey) {
        this.hash = ''; this.opts = opts; this.optsKey = key;
        if (this.state === 'error') { this.state = 'idle'; this.error = ''; }
      }
      if (this.state === 'running' || this.state === 'done') this.state = 'idle';
      this.changed();
    }
    const gen = this.gen;
    try {
      if (!this.hash) {
        const c = await this.models.call({ op: 'config', opts });
        if (gen !== this.gen) return;
        this.hash = c.hash;
        this.taxa = c.taxa || {};
        this.names = c.names || [];
      }
      if (gen !== this.gen) return;
      // Records not written yet go first: the store worker takes requests in order.
      if (this.saves.length) this.flush();
      const { entries } = await this.store.call({ op: 'scan', file: this.file, paths: paths.filter(analysable), config: this.hash });
      if (gen !== this.gen) return;
      this.apply(entries);
    } catch (err) {
      if (gen !== this.gen) return;
      this.fail(err);
    }
  }

  /** The folder's photos as they are now: cached answers in, the rest queued. */
  apply(entries) {
    const present = new Set(entries.map((e) => pathKey(e.path)));
    for (const k of [...this.results.keys()]) if (!present.has(k)) this.results.delete(k);
    const todo = [];
    for (const e of entries) {
      const k = pathKey(e.path);
      const have = this.results.get(k);
      if (e.rec) this.results.set(k, e.rec);
      else if (have && have.key === e.key) continue;
      else {
        this.results.delete(k);
        const busy = this.inflight.get(e.path);
        if (!busy || busy.key !== e.key) todo.push({ path: e.path, key: e.key, mtimeMs: e.mtimeMs });
      }
    }
    this.todo = todo;
    this.total = entries.length;
    this.regroup();
    this.pump();
  }

  fail(err) {
    this.state = 'error';
    this.error = String((err && err.message) || err);
    this.changed();
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'loading') return;
    this.state = 'paused';
    this.changed();
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'error') return;
    this.state = 'idle';
    this.error = '';
    this.pump();
    this.changed();
  }

  /** Nothing to analyse any more (the feature turned off). Answers still in flight are saved. */
  stop() {
    this.gen++;
    this.dir = '';
    this.file = '';
    this.optsKey = '';
    this.todo = [];
    this.results = new Map();
    this.bursts = [];
    this.byPath = new Map();
    this.total = 0;
    this.state = 'idle';
    this.error = '';
    this.changed();
  }

  /** Keep the decoders and the models busy. */
  async pump() {
    if (this.state === 'paused' || this.state === 'error' || this.state === 'loading') return;
    if (!this.todo.length) {
      if (!this.inflight.size && this.state !== 'done' && this.total) {
        this.state = 'done';
        if (this.saves.length) this.flush();   // the last answers on disk now, not a second later
        this.idleLater();
        this.changed();
      }
      return;
    }
    clearTimeout(this.idleTimer);
    if (this.opened !== this.optsKey) {
      const key = this.optsKey;
      this.state = 'loading';
      this.changed();
      try {
        await this.models.call({ op: 'open', opts: { ...this.opts, cacheDir: `${this.cacheDir}/wildlife` } });
      } catch (err) {
        if (key === this.optsKey) this.fail(err);
        else { this.state = 'idle'; this.pump(); }
        return;
      }
      this.opened = key;
      if (this.state !== 'loading') return;          // paused while loading
      this.state = 'idle';
      if (key !== this.optsKey) { this.pump(); return; }
    }
    if (this.state !== 'running') { this.state = 'running'; this.changed(); }
    while (this.inflight.size < IN_FLIGHT && this.todo.length) this.run(this.todo.shift());
  }

  async run(job) {
    if (this.decoders.length < DECODERS) this.decoders.push(new WorkerClient('js/wildlife/decode-worker.js'));
    const dec = this.decoders[this.seq % this.decoders.length];
    const ctx = { file: this.file, hash: this.hash, seq: ++this.seq };
    this.inflight.set(job.path, job);
    let rec;
    let decoded = null;
    try {
      decoded = await dec.call({ op: 'decode', job: ctx.seq, path: job.path, detectSize: DETECT_SIZE, sharpSize: SHARP_SIZE });
    } catch (err) {
      rec = errorRecord(job, ctx.hash, `decode: ${err.message}`);
    }
    if (decoded) {
      this.analysed++;
      try {
        const { result } = await this.models.call({ op: 'analyze', image: decoded.image, source: decoded.source },
          { transfer: [decoded.image.pixels.buffer] });
        let subject = null;
        if (result.animal && result.detections.length) {
          try {
            ({ subject } = await dec.call({ op: 'subject', job: ctx.seq, box: result.detections[0].box,
              sourceWidth: decoded.source.width, sourceHeight: decoded.source.height }));
          } catch (_) { subject = null; }
        } else dec.post({ op: 'drop', job: ctx.seq });
        rec = makeRecord(job, ctx.hash, decoded, result, subject);
      } catch (err) {
        dec.post({ op: 'drop', job: ctx.seq });
        rec = errorRecord(job, ctx.hash, `analyze: ${err.message}`);
      }
    }
    if (this.inflight.get(job.path) === job) this.inflight.delete(job.path);
    this.save(ctx.file, rec);
    // Still the folder and the settings on screen (left and opened again counts).
    if (ctx.file === this.file && ctx.hash === this.hash) {
      this.results.set(pathKey(job.path), rec);
      this.regroupSoon();
    }
    this.pump();
  }

  save(file, rec) {
    this.saves.push({ file, rec });
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_MS);
  }

  /** Write the records that finished since the last write. */
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const byFile = new Map();
    for (const { file, rec } of this.saves) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(rec);
    }
    this.saves = [];
    const writes = [...byFile].map(([file, recs]) => this.store.call({ op: 'append', file, recs })
      .catch((err) => console.warn(`wildlife: saving records: ${err.message}`)));
    return Promise.all(writes);
  }

  regroupSoon() {
    if (this.groupTimer) return;
    this.groupTimer = setTimeout(() => { this.groupTimer = null; this.regroup(); }, GROUP_MS);
  }

  /** Bursts from every record of the folder (bro.vision.wildlife.groupBursts, 1.0 s gaps). */
  regroup() {
    clearTimeout(this.groupTimer);
    this.groupTimer = null;
    this.bursts = this.results.size ? bro.vision.wildlife.groupBursts([...this.results.values()]) : [];
    this.byPath = new Map();
    for (const b of this.bursts) for (const p of b.photos) this.byPath.set(pathKey(p), b);
    this.changed();
  }

  /** Free the models after a while with nothing to do; the next photo loads them again. */
  idleLater() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.todo.length || this.inflight.size || !this.opened) return;
      this.opened = '';
      this.models.call({ op: 'dispose' }).catch(() => {});
    }, IDLE_MS);
  }
}
