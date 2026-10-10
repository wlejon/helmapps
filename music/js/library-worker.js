/**
 * The library's scan thread. It owns the saved index (JSON in
 * bro.app.cacheDir) and everything that touches the music files: walking
 * the library folders, comparing each file's size and mtime with the index,
 * reading the tags of the files that changed (js/tags/), and making a small
 * JPEG of each cover. The page only receives finished records.
 *
 * Messages in:
 *   { op: 'init', indexPath, coversDir }
 *   { op: 'scan', id, roots: [folder, ...] }        a newer scan stops an older one
 *   { op: 'stop' }                                   stop the running scan (it saves what it read)
 *   { op: 'write', path, text, what }                save a file whole (the queue), off the page
 * Messages out:
 *   { op: 'index', songs }                           the saved index, once, after init
 *   { op: 'progress', id, folders, files, parsed }
 *   { op: 'batch', id, songs }                       new and changed records
 *   { op: 'done', id, removed, files, parsed, skipped, errors, ms }
 *   { op: 'stopped', id, files, parsed }             a stopped (or replaced) scan, its records sent
 */

import { readTags, fileReader } from './tags/index.js';
import { makeRecord, hashString, hashBytes, PLAYABLE, UNPLAYABLE } from './records.js';

const fs = require('fs');
const pathMod = require('path');
const SEP = pathMod.sep;

/** A folder's own picture, by the names players look for. */
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart'];
const COVER_EXTS = ['jpg', 'jpeg', 'png'];
/** Covers are stored at most this many px on their long side. */
const COVER_PX = 320;
const BATCH = 200;
const PROGRESS_MS = 200;
const SLICE_MS = 1000;           // work between yields to the worker's message loop

let indexPath = '';
let coversDir = '';
let index = new Map();          // path -> record
let haveCovers = new Set();     // cover file names already made
let scanId = 0;

const join = (dir, name) => (dir.endsWith(SEP) || dir.endsWith('/') ? dir + name : dir + SEP + name);
const extOf = (name) => { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); };
const tick = () => new Promise((r) => setTimeout(r, 0));

function init(msg) {
  indexPath = msg.indexPath;
  coversDir = msg.coversDir;
  try { fs.mkdirSync(coversDir, { recursive: true }); } catch (_) { /* reported when a cover is written */ }
  try { haveCovers = new Set(fs.readdirSync(coversDir)); } catch (_) { haveCovers = new Set(); }
  let songs = [];
  try {
    const saved = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (saved && saved.version === 1 && Array.isArray(saved.songs)) songs = saved.songs;
  } catch (_) { /* first run, or an unreadable index: start empty */ }
  index = new Map(songs.map((s) => [s.path, s]));
  self.postMessage({ op: 'index', songs });
}

/** Write `text` to `file` whole or not at all (a temporary file, then a rename). */
function writeAtomic(file, text, what) {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(pathMod.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn(`music: could not save ${what}: ${err.message}`);
  }
}

function save() {
  writeAtomic(indexPath, JSON.stringify({ version: 1, songs: Array.from(index.values()) }), 'the library index');
}

/** A small JPEG of a picture, named by `key`; '' when it cannot be decoded. */
function makeCover(key, bytes) {
  const name = `${key}.jpg`;
  const file = join(coversDir, name);
  if (haveCovers.has(name)) return file;
  try {
    const img = bro.image.decodeOriented(bytes);
    if (!img || img.width < 2 || img.height < 2) return '';
    const scale = Math.min(1, COVER_PX / Math.max(img.width, img.height));
    let out = img;
    if (scale < 1) {
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const px = new Uint8Array(w * h * 4);
      bro.image.resizeU8(px, img.pixels, { srcW: img.width, srcH: img.height, dstW: w, dstH: h, channels: 4, filter: 'area' });
      out = { width: w, height: h, pixels: px };
    }
    const jpg = bro.image.encodeJpeg(out.pixels, out.width, out.height, 4, 85);
    if (!jpg) return '';
    fs.writeFileSync(file, jpg);
    haveCovers.add(name);
    return file;
  } catch (_) {
    return '';
  }
}

/** The folder picture's cover, made once per picture and mtime. */
function folderCover(src) {
  if (!src) return '';
  try {
    const st = fs.statSync(src);
    const key = `f-${hashString(`${src}\n${st.mtimeMs}`)}`;
    if (haveCovers.has(`${key}.jpg`)) return join(coversDir, `${key}.jpg`);
    return makeCover(key, new Uint8Array(fs.readFileSync(src)));
  } catch (_) {
    return '';
  }
}

/** Read one file's tags (and embedded picture) into a record. */
function parse(file, rel, dirCover) {
  let tags = null;
  let fd = -1;
  try {
    fd = fs.openSync(file.path, 'r');
    tags = readTags(fileReader(fs, fd, file.size), file.ext);
  } catch (_) {
    tags = null;
  } finally {
    if (fd >= 0) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
  const rec = makeRecord(file, rel, tags);
  if (tags && tags.picture && tags.picture.data.length > 16) {
    const cover = makeCover(`p-${hashBytes(tags.picture.data)}`, tags.picture.data);
    if (cover) { rec.cover = cover; rec.embedded = true; }
  }
  if (!rec.embedded && dirCover) {
    rec.coverSrc = dirCover;
    rec.cover = folderCover(dirCover);
  }
  return rec;
}

/**
 * Walk the roots; reparse what changed. Yields now and then so a newer scan
 * (a folder added, a burst of file events) takes over without waiting.
 */
/** A scan that was stopped keeps what it read: the records went out, the index is saved. */
function stopped(id, stats) {
  save();
  self.postMessage({ op: 'stopped', id, ...stats });
}

async function scan({ id, roots }) {
  scanId = id;
  const t0 = Date.now();
  const stats = { folders: 0, files: 0, parsed: 0, errors: 0, parseMs: 0, waitMs: 0 };
  // Yield (so a newer scan's message can arrive) once per slice of work, not
  // per N files: a setTimeout(0) in a worker takes ~500 ms to come back
  // (GAPS.md), and a yield every 32 files made a 1500-song scan 28 s long.
  // (No line here starts with `await`: bro's worker loader takes such a line
  // for a top-level await and wraps the module in a function, GAPS.md.)
  let sliceAt = Date.now();
  const due = () => { flush(false); return Date.now() - sliceAt >= SLICE_MS; };
  const pause = () => {
    const w = Date.now();
    return tick().then(() => { stats.waitMs += Date.now() - w; sliceAt = Date.now(); });
  };
  const skipped = {};
  const seen = new Set();
  let batch = [];
  let lastPost = Date.now();
  // Records go out every BATCH songs or with each progress message (every
  // PROGRESS_MS), so a slow scan still fills the window as it goes.
  const flush = (force) => {
    const due = force || Date.now() - lastPost >= PROGRESS_MS;
    if (batch.length && (due || batch.length >= BATCH)) { self.postMessage({ op: 'batch', id, songs: batch }); batch = []; }
    if (due) {
      lastPost = Date.now();
      self.postMessage({ op: 'progress', id, ...stats });
    }
  };

  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      if (scanId !== id) { flush(true); stopped(id, stats); return; } // stopped, or a newer scan took over
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { stats.errors++; continue; }
      stats.folders++;
      const files = [];
      let dirCover = '';
      let coverRank = 99;
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        if (e.isDirectory()) { stack.push(join(dir, e.name)); continue; }
        const ext = extOf(e.name);
        if (PLAYABLE.has(ext)) files.push(e.name);
        else if (UNPLAYABLE.has(ext)) skipped[ext] = (skipped[ext] || 0) + 1;
        else if (COVER_EXTS.includes(ext)) {
          const rank = COVER_NAMES.indexOf(e.name.slice(0, e.name.length - ext.length - 1).toLowerCase());
          if (rank >= 0 && rank < coverRank) { coverRank = rank; dirCover = join(dir, e.name); }
        }
      }
      for (const name of files) {
        const p = join(dir, name);
        let st;
        try { st = fs.statSync(p); } catch (_) { stats.errors++; continue; }
        stats.files++;
        seen.add(p);
        const old = index.get(p);
        if (old && old.size === st.size && old.mtime === st.mtimeMs) {
          // Unchanged audio; a folder picture may still have come or gone.
          if (!old.embedded && old.coverSrc !== dirCover) {
            old.coverSrc = dirCover;
            old.cover = folderCover(dirCover);
            batch.push(old);
          }
          continue;
        }
        const rel = p.slice(root.length).replace(/^[\\/]+/, '');
        const tp = Date.now();
        const rec = parse({ path: p, size: st.size, mtime: st.mtimeMs, ext: extOf(name) }, rel, dirCover);
        stats.parseMs += Date.now() - tp;
        stats.parsed++;
        if (rec.format === 'opus') {
          // An .ogg holding Opus: bro cannot play it either.
          skipped.opus = (skipped.opus || 0) + 1;
          seen.delete(p);
          stats.files--;
          continue;
        }
        index.set(p, rec);
        batch.push(rec);
        if (due()) await pause();
      }
      if (due()) await pause();
    }
  }
  if (scanId !== id) { flush(true); stopped(id, stats); return; }
  const removed = [];
  for (const p of index.keys()) if (!seen.has(p)) removed.push(p);
  for (const p of removed) index.delete(p);
  flush(true);
  save();
  self.postMessage({ op: 'done', id, removed, ...stats, skipped, ms: Date.now() - t0 });
}

self.onmessage = (e) => {
  const msg = e.data || {};
  try {
    if (msg.op === 'init') init(msg);
    else if (msg.op === 'stop') scanId = -1;                         // the running scan sees it at its next yield
    else if (msg.op === 'write')writeAtomic(msg.path, msg.text, msg.what || msg.path);
    else if (msg.op === 'scan') scan(msg).catch((err) => self.postMessage({ op: 'failed', id: msg.id, error: err.message }));
  } catch (err) {
    self.postMessage({ op: 'failed', id: msg.id || 0, error: (err && err.message) || String(err) });
  }
};
