/**
 * Her examples: the crops she has named, kept across folders, so "looks
 * like your Blue Jay from May 1" finds an animal she named in any folder,
 * not only the one open (a folder's crop embeddings live in its cache,
 * records.js embeddingsFile).
 *
 * For each animal of her answers (a name she gave, or the identifier's she
 * confirmed) on a box the identifier found, its crop's image embedding, its
 * name and when: `<dataDir>/wildlife/examples.json` (the index) and the
 * embeddings end to end in a float32 file it names (answers-worker.js
 * exLoad / exSave):
 *
 *   { "format": "helm.images.examples", "version": 1, "rows": "examples-<t>.f32",
 *     "entries": [ { key, box, name, scientific?, rank?, model, dim, off, at, time, file } ] }
 *
 *   key    the photo's file key (answers.js); box [x, y, w, h] in its record's pixels
 *   model  the classifier the embedding came from (embeddings of two models
 *          are never compared); dim its length; off where it starts in the rows
 *   at     when she answered; time when the photo was taken; file its name
 *
 * The store follows her answers: whenever a photo of the open folder is
 * analysed (its embeddings known) the store's entries for that photo are
 * made again from her answer (sync), so a correction, a removal, a revert
 * or an undo changes them; a photo she has not answered keeps none. A
 * photo of a folder not open keeps what it had. At most PER_NAME of one
 * name (the latest she gave) and MAX in all.
 *
 *   const ex = new Examples({ dataDir, worker });
 *   await ex.load();
 *   ex.sync([{ key, model, entries: [{ box, name, ..., emb }] | null }, ...]);  // null: no answer
 *   ex.like(model, dim)    // [{ entry, emb }] to compare against
 */

const path = require('path');

export const PER_NAME = 8;
export const MAX = 4000;

/** The examples index under a data dir. */
export function examplesFile(dataDir) {
  return path.join(dataDir, 'wildlife', 'examples.json');
}

const nameKey = (e) => `${e.model}|${e.rank ? `${e.rank}:${e.scientific}` : `name:${String(e.name).toLowerCase()}`}`;

const sameEntry = (a, b) => a.key === b.key && a.model === b.model && a.name === b.name && a.at === b.at &&
  (a.scientific || '') === (b.scientific || '') && (a.rank || '') === (b.rank || '') &&
  a.box.length === b.box.length && a.box.every((v, i) => v === b.box[i]);

export class Examples {
  constructor({ dataDir, worker }) {
    this.file = examplesFile(dataDir);
    this.worker = worker;
    this.entries = [];      // [{ key, box, name, scientific?, rank?, model, at, time, file, emb }]
    this.version = 0;
    this.loaded = null;
    this.saving = Promise.resolve();
  }

  /** Read the store (once; later calls wait on the first). */
  load() {
    if (!this.loaded) {
      this.loaded = this.worker.call({ op: 'exLoad', file: this.file }).then((r) => {
        this.entries = r.entries.map(({ off, dim, ...e }) => ({ ...e, emb: r.rows.slice(off, off + dim) }));
        this.version++;
      }, (err) => console.warn(`examples: ${err.message}`));
    }
    return this.loaded;
  }

  /**
   * The photos' entries as her answers make them now: [{ key, model, entries }]
   * (entries null when she has not answered it). Saved when anything changed.
   */
  sync(photos) {
    const byKey = new Map(photos.map((p) => [`${p.key}|${p.model}`, p]));
    const kept = this.entries.filter((e) => !byKey.has(`${e.key}|${e.model}`));
    const made = [];
    for (const p of photos) for (const e of p.entries || []) made.push({ ...e, key: p.key, model: p.model });
    const next = cap([...kept, ...made]);
    if (next.length === this.entries.length && next.every((e, i) => sameEntry(e, this.entries[i]))) return false;
    this.entries = next;
    this.version++;
    this.save();
    return true;
  }

  /** Her examples from one model, its embeddings `dim` long. */
  like(model, dim) {
    return this.entries.filter((e) => e.model === model && e.emb.length === dim);
  }

  save() {
    let off = 0;
    const entries = this.entries.map(({ emb, ...e }) => { const x = { ...e, dim: emb.length, off }; off += emb.length; return x; });
    const rows = new Float32Array(off);
    for (let i = 0; i < this.entries.length; i++) rows.set(this.entries[i].emb, entries[i].off);
    const doc = { op: 'exSave', file: this.file, entries, rows };
    this.saving = this.saving.then(() => this.worker.call(doc)).catch((err) => console.warn(`examples: could not save: ${err.message}`));
    return this.saving;
  }
}

/** The PER_NAME latest of each name and model, MAX latest in all; in a stable order (oldest first). */
function cap(entries) {
  const sorted = entries.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 :
    a.box[0] - b.box[0] || a.box[1] - b.box[1]));
  const per = new Map();
  const out = [];
  for (const e of sorted) {
    const k = nameKey(e);
    const n = per.get(k) || 0;
    if (n >= PER_NAME) continue;
    per.set(k, n + 1);
    out.push(e);
    if (out.length >= MAX) break;
  }
  return out.reverse();
}
