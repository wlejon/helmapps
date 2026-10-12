/**
 * Her answers: what Jennie says is in a photo. The identifier
 * (bro.vision.wildlife, analysis.js) is a first pass; she is the answer
 * sheet, and once she has said what a photo holds (named, corrected, added,
 * removed, "no animal", or confirmed the identifier's names), her answer is
 * what every view shows from then on (feature.js answerOf).
 *
 * Kept apart from the analysis records, which may be thrown away at any
 * time: one JSON file in the app's data dir, `<dataDir>/wildlife/answers.json`,
 * written whole through a temporary file and a rename (answers-worker.js):
 *
 *   { "format": "helm.images.answers", "version": 1,
 *     "answers": [ { key, name, answer, confirmed?, by, at, scope }, ... ] }
 *
 *   key       the file's identity: "<size>:<32 hex>", its size and the
 *             SHA-256 of its first and last 64 KiB (answers-worker.js), so
 *             an answer follows the photo through a move, a rename, a copy
 *             to another folder and any new analysis or model
 *   name      the file name it was last seen under
 *   answer    { animals: [{ name, scientific?, rank?, count?, boxes? }],
 *             notAnimal? } or { animals: [], none: true } ("no animal").
 *             `name` is what she calls it (a list's common name, or her own
 *             words for one on no list); `scientific` and `rank` when it is a
 *             name of the lists; `boxes` the detector boxes ([x, y, w, h] in
 *             the record's pixels) it is on, when known; `notAnimal` boxes
 *             she said are not an animal
 *   confirmed true when she confirmed the identifier's names as they were
 *   by        'user'
 *   at        when (ISO 8601)
 *   scope     'photo' or 'burst' (made on one frame for the burst: each
 *             frame got the same change to its own animals, a box matched
 *             across frames by overlap, crops.js)
 *
 * Finding a photo's key reads both ends of the file once; a path index in
 * the cache dir (`<cacheDir>/wildlife/file-keys.json`, path -> size, mtime,
 * key) answers again without reading while the file's size and mtime stay.
 *
 *   const answers = new Answers({ dataDir, cacheDir, onChange });
 *   await answers.load();
 *   answers.setFolder(paths);            // keys for the folder's photos, in the background
 *   answers.of(path)                     // her record, or null
 *   const undo = await answers.put(paths, { animals: [...] }, { scope });
 *   await answers.restore(undo);         // as they were
 */

import { WorkerClient } from '../burst/rpc.js';
import { pathKey } from './records.js';
import { animalKey } from './mine.js';
import { sameBox } from './crops.js';

const path = require('path');

export const ANSWERS_FORMAT = 'helm.images.answers';

/** The answers file under a data dir. */
export function answersFile(dataDir) {
  return path.join(dataDir, 'wildlife', 'answers.json');
}

export class Answers {
  constructor({ dataDir, cacheDir, onChange = null } = {}) {
    this.file = answersFile(dataDir);
    this.indexFile = path.join(cacheDir, 'wildlife', 'file-keys.json');
    this.onChange = onChange;
    this.worker = new WorkerClient('js/wildlife/answers-worker.js');
    this.byKey = new Map();     // key -> record
    this.keys = new Map();      // pathKey(path) -> key
    this.version = 0;
    this.error = '';
    this.loaded = null;         // load()'s promise
    this.folderSeq = 0;
  }

  changed() { this.version++; if (this.onChange) this.onChange(this); }

  /** Read the answers file (once; later calls wait on the first). */
  load() {
    if (!this.loaded) {
      this.loaded = this.worker.call({ op: 'load', file: this.file }).then((r) => {
        for (const rec of r.records) this.byKey.set(rec.key, rec);
        if (r.error) { this.error = r.error; console.warn(`answers: ${r.error}`); }
        this.changed();
      }, (err) => {
        this.error = err.message;
        console.warn(`answers: ${err.message}`);
      });
    }
    return this.loaded;
  }

  /** Find the keys of a folder's photos (in the background); her answers show as they come. */
  async setFolder(paths) {
    const seq = ++this.folderSeq;
    await this.load();
    const todo = paths.filter((p) => !this.keys.has(pathKey(p)));
    // A slice at a time: the first photos answer while the rest are read.
    for (let i = 0; i < todo.length && seq === this.folderSeq; i += 64) {
      await this.keysFor(todo.slice(i, i + 64));
      if (seq === this.folderSeq) this.changed();
    }
  }

  /** The keys of `paths` ({ path: key | null }), reading the files the index cannot answer for. */
  async keysFor(paths) {
    const out = {};
    const ask = [];
    for (const p of paths) {
      const k = this.keys.get(pathKey(p));
      if (k) out[p] = k; else ask.push(p);
    }
    if (ask.length) {
      const { ids } = await this.worker.call({ op: 'ids', paths: ask, index: this.indexFile });
      for (const p of ask) {
        out[p] = ids[p] || null;
        if (ids[p]) this.keys.set(pathKey(p), ids[p]);
      }
    }
    return out;
  }

  /** A file changed or went: its key is read again when next asked for. */
  forget(p) { this.keys.delete(pathKey(p)); }

  /** Her record for a photo, or null (none, or its key not read yet). */
  of(p) {
    const k = this.keys.get(pathKey(p));
    return (k && this.byKey.get(k)) || null;
  }

  /** Whether any photo has her answer (the file has records). */
  get size() { return this.byKey.size; }

  /**
   * Give `paths` her answer ({ animals, none? }); `confirmed` when it is the
   * identifier's names as they were. Answers what to restore() for an undo.
   */
  async put(paths, answer, { scope = 'photo', confirmed = false } = {}) {
    return this.putEach(paths.map((p) => ({ path: p, answer, confirmed })), { scope });
  }

  /**
   * Give each photo its own answer: [{ path, answer, confirmed? }] (a burst's
   * frames, each with what the change made of its names). Answers what to
   * restore() for an undo.
   */
  async putEach(puts, { scope = 'photo' } = {}) {
    const keys = await this.keysFor(puts.map((x) => x.path));
    const at = new Date().toISOString();
    const undo = [];
    for (const { path: p, answer, confirmed } of puts) {
      const key = keys[p];
      if (!key) continue;
      undo.push({ key, rec: this.byKey.get(key) || null });
      const rec = { key, name: path.basename(p), answer: cleanAnswer(answer), by: 'user', at, scope };
      if (confirmed) rec.confirmed = true;
      this.byKey.set(key, rec);
    }
    if (!undo.length) throw new Error('the photo could not be read');
    this.changed();
    await this.save();
    return undo;
  }

  /** Take her answers off `paths`: the identifier's names show again. Answers what to restore(). */
  async revert(paths) {
    const keys = await this.keysFor(paths);
    const undo = [];
    for (const p of paths) {
      const key = keys[p];
      if (!key || !this.byKey.has(key)) continue;
      undo.push({ key, rec: this.byKey.get(key) });
      this.byKey.delete(key);
    }
    if (!undo.length) return undo;
    this.changed();
    await this.save();
    return undo;
  }

  /** Put records back as put() or revert() found them. */
  async restore(undo) {
    for (const { key, rec } of undo) {
      if (rec) this.byKey.set(key, rec); else this.byKey.delete(key);
    }
    this.changed();
    await this.save();
  }

  /** The whole file, as it is written (and exported). */
  document() {
    const answers = [...this.byKey.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1));
    return { format: ANSWERS_FORMAT, version: 1, answers };
  }

  save() {
    this.saving = this.worker.call({ op: 'save', file: this.file, doc: this.document() }).catch((err) => {
      this.error = `could not save her answers: ${err.message}`;
      console.warn(`answers: ${this.error}`);
      throw err;
    });
    return this.saving;
  }
}

/** An answer as it is kept: names trimmed, a count only when more than one; no animals is "no animal". */
export function cleanAnswer(a) {
  const animals = [];
  const at = new Map();     // one entry a name: the same name twice is one animal on both boxes
  for (const x of a && !a.none && Array.isArray(a.animals) ? a.animals : []) {
    if (!x || !String(x.name || '').trim()) continue;
    const out = { name: String(x.name).trim() };
    if (x.scientific) out.scientific = x.scientific;
    if (x.rank) out.rank = x.rank;
    if (x.count > 1) out.count = Math.round(x.count);
    const boxes = cleanBoxes(x.boxes);
    if (boxes.length) out.boxes = boxes;
    const k = animalKey(out);
    const prev = at.get(k);
    if (!prev) { at.set(k, out); animals.push(out); continue; }
    if (out.count > (prev.count || 0)) prev.count = out.count;
    if (boxes.length) prev.boxes = [...(prev.boxes || []), ...boxes.filter((b) => !(prev.boxes || []).some((p) => sameBox(p, b)))];
  }
  const res = animals.length ? { animals } : { animals: [], none: true };
  const notAnimal = cleanBoxes(a && a.notAnimal);
  if (notAnimal.length) res.notAnimal = notAnimal;
  return res;
}

/** Boxes as kept: [x, y, w, h] in the record's pixels, to 0.1 px. */
function cleanBoxes(boxes) {
  if (!Array.isArray(boxes)) return [];
  return boxes.filter((b) => Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(v)))
    .map((b) => b.map((v) => Math.round(v * 10) / 10));
}
