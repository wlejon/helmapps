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
 *   a.embeddingOf(path, i)   animal i's crop embedding (kept beside the records, records.js embeddingsFile)
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
import { DETECT_SIZE, SHARP_SIZE, cacheFile, embeddingsFile, makeRecord, errorRecord, pathKey } from './records.js';
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
/** A shot joins the burst of the one before when at most this many seconds later (groupBursts' gapS). */
const GAP_S = 1.0;
/** changed()'s paths when only the state or the progress changed. */
const NONE = new Set();

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
    this.embeddings = new Map();   // pathKey -> { dim, rows }: each crop's embedding (animal i's at i * dim)
    this.embFile = '';
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
    this.landed = new Set(); // pathKeys whose records came since the last regroup (null: all may have)
  }

  /**
   * Tell the feature: onChange(this, paths), `paths` the pathKeys whose
   * record, burst or embeddings changed (empty: only the state or the
   * progress did), or null when anything may have (a folder, a scan).
   */
  changed(paths = null) { this.version++; if (this.onChange) this.onChange(this, paths); }

  progress() {
    return { state: this.state, done: this.results.size, total: this.total, error: this.error };
  }

  /** A photo's record, or null; `p` in any form of its path (records.js pathKey). */
  record(p) { return this.results.get(pathKey(p)) || null; }

  burstOf(p) { return this.byPath.get(pathKey(p)) || null; }

  /** Animal i's crop embedding in photo p (a unit Float32Array), or null. */
  embeddingOf(p, i) {
    const e = this.embeddings.get(pathKey(p));
    if (!e || !e.dim || (i + 1) * e.dim > e.rows.length) return null;
    const row = e.rows.subarray(i * e.dim, (i + 1) * e.dim);
    return row.some((x) => x !== 0) ? row : null;
  }

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
      this.embFile = embeddingsFile(this.file);
      this.results = new Map();
      this.embeddings = new Map();
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
      // The cached records' crop embeddings, behind them (the names show first).
      const want = entries.filter((e) => e.rec && !this.embeddings.has(pathKey(e.path))).map((e) => ({ path: e.path, key: e.key }));
      if (want.length) {
        const r = await this.store.call({ op: 'embLoad', file: this.embFile, want, config: this.hash });
        if (gen !== this.gen) return;
        for (const e of r.entries) if (!this.embeddings.has(pathKey(e.path))) this.embeddings.set(pathKey(e.path), { dim: e.dim, rows: e.rows });
        if (r.entries.length) this.changed(new Set(r.entries.map((e) => pathKey(e.path))));
      }
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
    this.landed = null;      // the folder's records as a whole: every photo may have changed
    this.regroup();
    this.pump();
  }

  fail(err) {
    this.state = 'error';
    this.error = String((err && err.message) || err);
    this.changed(NONE);
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'loading') return;
    this.state = 'paused';
    this.changed(NONE);
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'error') return;
    this.state = 'idle';
    this.error = '';
    this.pump();
    this.changed(NONE);
  }

  /** Nothing to analyse any more (the feature turned off). Answers still in flight are saved. */
  stop() {
    this.gen++;
    this.dir = '';
    this.file = '';
    this.optsKey = '';
    this.todo = [];
    this.results = new Map();
    this.embeddings = new Map();
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
        this.changed(NONE);
      }
      return;
    }
    clearTimeout(this.idleTimer);
    if (this.opened !== this.optsKey) {
      const key = this.optsKey;
      this.state = 'loading';
      this.changed(NONE);
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
    if (this.state !== 'running') { this.state = 'running'; this.changed(NONE); }
    while (this.inflight.size < IN_FLIGHT && this.todo.length) this.run(this.todo.shift());
  }

  async run(job) {
    if (this.decoders.length < DECODERS) this.decoders.push(new WorkerClient('js/wildlife/decode-worker.js'));
    const dec = this.decoders[this.seq % this.decoders.length];
    const ctx = { file: this.file, embFile: this.embFile, hash: this.hash, seq: ++this.seq };
    this.inflight.set(job.path, job);
    let rec;
    let emb = null;
    let decoded = null;
    try {
      decoded = await dec.call({ op: 'decode', job: ctx.seq, path: job.path, detectSize: DETECT_SIZE, sharpSize: SHARP_SIZE });
    } catch (err) {
      rec = errorRecord(job, ctx.hash, `decode: ${err.message}`);
    }
    if (decoded) {
      this.analysed++;
      try {
        const { result, embeddings } = await this.models.call({ op: 'analyze', image: decoded.image, source: decoded.source },
          { transfer: [decoded.image.pixels.buffer] });
        emb = embeddings || null;
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
    if (emb) this.saves.push({ embFile: ctx.embFile, entry: { path: job.path, key: job.key, config: ctx.hash, dim: emb.dim, rows: emb.rows } });
    // Still the folder and the settings on screen (left and opened again counts).
    if (ctx.file === this.file && ctx.hash === this.hash) {
      if (emb) this.embeddings.set(pathKey(job.path), emb);
      else this.embeddings.delete(pathKey(job.path));
      this.results.set(pathKey(job.path), rec);
      if (this.landed) this.landed.add(pathKey(job.path));
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
    const byFile = new Map(), byEmb = new Map();
    for (const s of this.saves) {
      const [map, k, v] = s.embFile ? [byEmb, s.embFile, s.entry] : [byFile, s.file, s.rec];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(v);
    }
    this.saves = [];
    const writes = [...byFile].map(([file, recs]) => this.store.call({ op: 'append', file, recs })
      .catch((err) => console.warn(`wildlife: saving records: ${err.message}`)));
    for (const [file, entries] of byEmb) {
      writes.push(this.store.call({ op: 'embAppend', file, entries })
        .catch((err) => console.warn(`wildlife: saving embeddings: ${err.message}`)));
    }
    return Promise.all(writes);
  }

  regroupSoon() {
    if (this.groupTimer) return;
    this.groupTimer = setTimeout(() => { this.groupTimer = null; this.regroup(); }, GROUP_MS);
  }

  /**
   * Bursts from every record of the folder, as bro.vision.wildlife.groupBursts
   * makes them (sorted by time, a shot joins the one before at most GAP_S
   * later), but summarised again only where a record landed: a burst none
   * joined is the same object as before, so a card of thousands costs a
   * result its own burst, not every burst again. Tells the feature the photos
   * that landed and every photo of a burst made again, as it is and as it was.
   */
  regroup() {
    clearTimeout(this.groupTimer);
    this.groupTimer = null;
    const wl = bro.vision.wildlife;
    const was = this.byPath;
    const landed = this.landed;      // null: every record may be new
    this.landed = new Set();
    const shots = [...this.results.values()].filter((r) => !r.error).sort((a, b) =>
      (a.time == null) - (b.time == null) || (a.time || 0) - (b.time || 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const groups = [];
    let cur = null, prev = null;
    for (const r of shots) {
      if (cur && prev.time != null && r.time != null && r.time - prev.time <= GAP_S * 1000) cur.push(r);
      else groups.push((cur = [r]));
      prev = r;
    }
    const touched = landed ? new Set(landed) : null;
    this.bursts = [];
    this.byPath = new Map();
    for (const g of groups) {
      const old = landed ? was.get(pathKey(g[0].path)) : null;
      const same = !!old && old.photos.length === g.length &&
        g.every((r) => !landed.has(pathKey(r.path)) && was.get(pathKey(r.path)) === old);
      const b = same ? old : wl.groupBursts(g, { gapS: GAP_S })[0];
      if (!same && touched) {
        for (const r of g) {
          touched.add(pathKey(r.path));
          const o = was.get(pathKey(r.path));
          if (o) for (const p of o.photos) touched.add(pathKey(p));
        }
      }
      this.bursts.push(b);
      for (const p of b.photos) this.byPath.set(pathKey(p), b);
    }
    // A photo in a burst before and in none now (its record went, or failed).
    if (touched) for (const k of was.keys()) if (!this.byPath.has(k)) touched.add(k);
    this.changed(touched);
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
