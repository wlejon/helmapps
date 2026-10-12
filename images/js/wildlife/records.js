/**
 * Find Animals' records: one per photo, what bro.vision.wildlife answered
 * for it, kept in the app's cache so a folder opened again shows at once.
 * Shared by the page and the workers.
 *
 * A record is broworkshop ai/birds' (its RECORDS.md) cut to what the viewer
 * shows and groups by. Its path has forward slashes on every platform
 * (recordPath), and paths are matched by pathKey (no case on Windows):
 *   { path, key ("<size>:<mtime ms>"), config (the settings hash), time (ms:
 *     EXIF capture time, else the file's mtime), timeSource, width, height,
 *     exif: { dateTaken } | null, animal, detections (best first, every box
 *     over the threshold), subject, species (top 5; the best box's),
 *     animals (every box classified: { box, score, label, subject, species,
 *     taxa, candidates }), animalsDropped (boxes not classified),
 *     sharpness: { frame, subject } }
 *   or, for a photo that could not be read: { path, key, config, error }
 *
 * The config hash covers everything a record depends on: the record schema,
 * the image sizes, and bro.vision.wildlife.config() (models with their
 * revisions and sizes, threshold, queries, top K, margin, which boxes are
 * kept (nms), the per-crop suggestions (queryTop), species list). A
 * record is reused only when the photo's key and the hash both match.
 */

// 3: each photo's crop embeddings are kept beside its record (embeddingsFile), so older records are made again once.
export const SCHEMA = 3;
/** The detection / classification image, long side (docs/vision-api.js, Wildlife). */
export const DETECT_SIZE = 1280;
/** The sharpness image, long side: focus lives in the finest detail. */
export const SHARP_SIZE = 3000;

const WINDOWS = typeof process !== 'undefined' && process.platform === 'win32';

/** A path as records keep it: forward slashes on every platform (ai/birds' form). */
export function recordPath(p) {
  return WINDOWS ? String(p).replace(/\\/g, '/') : String(p);
}

/** The key two paths of one file share: the record form, without case on Windows. */
export function pathKey(p) {
  if (!WINDOWS) return String(p);
  // Asked for every photo of a folder at each change (items, bursts): a regex
  // and a lower-casing a time cost a card of thousands, so each path's key is kept.
  const s = String(p);
  let k = keyOf.get(s);
  if (k === undefined) {
    if (keyOf.size >= KEYS_KEPT) keyOf.clear();
    k = recordPath(s).toLowerCase();
    keyOf.set(s, k);
  }
  return k;
}
const keyOf = new Map();
const KEYS_KEPT = 200000;

/** FNV-1a of a string, as 8 hex digits. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The hash of a wildlife config (or a test stub's table). */
export function configHash(config) {
  return fnv1a(JSON.stringify({ schema: SCHEMA, detectSize: DETECT_SIZE, sharpSize: SHARP_SIZE, ...config }));
}

/** The cache file of a folder's records, under the app's cache dir. */
export function cacheFile(cacheDir, dir) {
  const path = require('path');
  const name = path.basename(dir).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40) || 'root';
  return path.join(cacheDir, 'wildlife', 'folders', `${name}-${fnv1a(pathKey(dir))}.jsonl`);
}

/**
 * The file of a folder's crop embeddings, beside its records (store-worker.js
 * 'embLoad' / 'embAppend'): what "looks like the one you named" compares.
 */
export function embeddingsFile(recordsFile) {
  return recordsFile.replace(/\.jsonl$/, '') + '.emb';
}

/** The sharpness fields a record keeps. */
function sharp(s) {
  return s ? { tenengrad: s.tenengrad, laplacianVar: s.laplacianVar } : null;
}

/**
 * A photo's record from its job ({ path, key, mtimeMs }), what the decode
 * worker answered, analyze()'s result and the subject's sharpness.
 */
export function makeRecord(job, config, decoded, result, subject) {
  const exifTime = decoded.exif && decoded.exif.dateTaken ? bro.vision.wildlife.parseExifTime(decoded.exif.dateTaken) : null;
  return {
    path: recordPath(job.path), key: job.key, config,
    time: exifTime != null ? exifTime : job.mtimeMs,
    timeSource: exifTime != null ? 'exif' : 'mtime',
    width: decoded.source.width, height: decoded.source.height,
    exif: decoded.exif || null,
    animal: !!result.animal,
    detections: result.detections || [],
    subject: result.subject || null,
    species: result.species || [],
    animals: result.animals || [],
    animalsDropped: result.animalsDropped || 0,
    sharpness: { frame: sharp(decoded.frame), subject: sharp(subject) },
  };
}

export function errorRecord(job, config, error) {
  return { path: recordPath(job.path), key: job.key, config, error: String(error) };
}
