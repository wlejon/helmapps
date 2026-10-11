/**
 * Which models Find Animals needs, where they are, and fetching the missing
 * ones. bro.vision.wildlife runs OWLv2 (the animal) and BioCLIP 2 (its
 * species, from a species list); bro.models finds their folders (BRO_MODELS,
 * the models.dirs setting, the per-user models folder) and bro.models.fetch
 * installs a missing one from the bro model datasets on Hugging Face.
 *
 *   wildlifeSupported()       this bro can run it at all (else the feature is hidden)
 *   locateModels(model, list) { paths, missing: ['owlv2', ...] } by folder name
 *                             (bro.vision.wildlife.locate's `fetch`: 'species', or
 *                             'species/upper-midwest-herps' for a species folder
 *                             from before the herps)
 *   const d = new ModelDownload(['owlv2', 'species'], { onChange });
 *   d.start(); d.cancel();    d.state 'running' | 'failed' | 'done' | 'cancelled', d.done, d.total, d.error
 *
 * The download itself is bro's (verified, resumable, renamed into place);
 * nothing is remembered beyond the installed folders, which find() answers.
 */

const path = require('path');

/** The folders, as the dataset lists them (bytes from its listing, for the offer). */
export const FOLDERS = {
  owlv2: { name: 'owlv2', label: 'OWLv2', bytes: 621519089 },
  'bioclip-2': { name: 'bioclip-2', label: 'BioCLIP 2', bytes: 1711929390 },
  bioclip: { name: 'bioclip', label: 'BioCLIP', bytes: 599921912 },
  species: { name: 'species', label: 'species lists', bytes: 534767 },
  'species/upper-midwest-herps': { name: 'species/upper-midwest-herps', label: 'reptiles and amphibians', bytes: 84654 },
};

/**
 * Whether this bro can find animals: bro.vision with OWLv2 and the wildlife
 * module, bro.lm with CLIP, and a GPU (on the CPU a photo takes seconds,
 * too slow to run on every folder opened).
 */
export function wildlifeSupported() {
  if (typeof bro === 'undefined' || !bro) return false;
  const v = bro.vision, lm = bro.lm;
  if (!v || v.available === false || !v.wildlife || typeof v.wildlife.open !== 'function' || typeof v.loadOwlv2 !== 'function') return false;
  if (!lm || lm.available === false || typeof lm.loadClip !== 'function') return false;
  if (!bro.models || typeof bro.models.find !== 'function') return false;
  return !!(bro.gpu && bro.gpu.available);
}

/** Whether missing folders can be fetched (this bro has bro.models.fetch). */
export function canFetch() {
  return typeof bro !== 'undefined' && !!bro.models && typeof bro.models.fetch === 'function';
}

/**
 * Where the models are: `paths` for the analyzer ({ detector, classifier,
 * species, model }), and `missing`, the folder names to fetch. `listFile`
 * is a species list inside the species folder, or '' for
 * bro.vision.wildlife's default lists (the birds and mammals, and the
 * reptiles and amphibians in a folder of their own); `listMissing` says a
 * list is not there and a fetch would not bring it (the folder is there
 * without that file).
 */
export function locateModels(model, listFile) {
  const speciesDir = bro.models.find('species');
  const opts = { model };
  if (listFile && speciesDir) opts.species = path.join(speciesDir, listFile);
  const loc = bro.vision.wildlife.locate(opts);
  const missing = loc.fetch.slice();
  const isList = (n) => n === 'species' || n.startsWith('species/');
  const listMissing = loc.missing.includes('species') && !missing.some(isList);
  return {
    paths: { detector: loc.detector, classifier: loc.classifier, species: loc.species, model },
    missing, listMissing, speciesDir,
  };
}

/** The bytes a set of folders downloads. */
export function bytesOf(names) {
  return names.reduce((n, k) => n + (FOLDERS[k] ? FOLDERS[k].bytes : 0), 0);
}

/** One download of several model folders, one after another. */
export class ModelDownload {
  constructor(names, { onChange = null } = {}) {
    this.names = names.slice();
    this.onChange = onChange;
    this.state = 'idle';
    this.total = bytesOf(names);
    this.done = 0;
    this.error = '';
    this.ac = null;
  }

  changed() { if (this.onChange) this.onChange(this); }

  async start() {
    if (this.state === 'running') return;
    this.state = 'running';
    this.error = '';
    this.ac = new AbortController();
    const ac = this.ac;
    this.changed();
    let before = 0;
    try {
      for (const name of this.names) {
        // The listing's size wins over the planned one once it is known.
        let size = FOLDERS[name] ? FOLDERS[name].bytes : 0;
        await bro.models.fetch(name, {
          signal: ac.signal,
          onProgress: ({ done, total }) => {
            if (total > 0 && total !== size) { this.total += total - size; size = total; }
            this.done = before + done;
            this.changed();
          },
        });
        before += size;
        this.done = before;
      }
      this.state = 'done';
    } catch (err) {
      if (this.ac !== ac) return;
      if (err && err.name === 'AbortError') this.state = 'cancelled';
      else {
        this.state = 'failed';
        this.error = err && err.code === 'network'
          ? 'no connection to the model server (offline?)'
          : String((err && err.message) || err).replace(/^bro\.models\.fetch: /, '');
      }
    }
    this.changed();
  }

  cancel() {
    if (this.state === 'running' && this.ac) this.ac.abort();
  }
}
