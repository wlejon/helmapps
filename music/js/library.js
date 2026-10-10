/**
 * The music library on the page's side: the songs the scan worker found
 * (js/library-worker.js does every file read), and the views of them the
 * window shows, built when asked for and kept until the songs change.
 *
 *   const lib = new Library({ cacheDir, onChange, onProgress, onScanned });
 *   lib.start();                    // load the saved index (instant on later starts)
 *   lib.scan(roots);                // walk the folders; only changed files are read
 *   lib.watch(roots);               // and again when files change (bro.vfs.watch)
 *   lib.songs()  lib.albums()  lib.album(key)  lib.artists()  lib.artist(key)  lib.folder(dir)
 */

import { api, debounce } from '/lib/dom.js';
import { UNKNOWN_ARTIST, UNKNOWN_ALBUM, sortKey, PLAYABLE, UNPLAYABLE } from './records.js';

const path = require('path');

/** A burst of file events settles this long before the folders are scanned again. */
const WATCH_SETTLE_MS = 1000;

const byNumber = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Album order: disc, track, then title. */
export function trackOrder(a, b) {
  return byNumber(a.disc || 0, b.disc || 0) || byNumber(a.track || 0, b.track || 0) || byNumber(a.tKey, b.tKey) || byNumber(a.path, b.path);
}

/** Library order: artist, album, then track order. */
export function libraryOrder(a, b) {
  return byNumber(a.aKey, b.aKey) || byNumber(a.lKey, b.lKey) || trackOrder(a, b);
}

export class Library {
  constructor({ cacheDir, onChange, onProgress, onScanned } = {}) {
    this.cacheDir = cacheDir;
    this.onChange = onChange || (() => {});
    this.onProgress = onProgress || (() => {});
    this.onScanned = onScanned || (() => {});
    this.byPath = new Map();
    this.version = 0;
    this.loaded = false;
    this.worker = null;
    this.scanSeq = 0;
    this.scanning = 0;             // the id of the scan running, 0 when none
    this.progress = null;          // { folders, files, parsed } while scanning
    this.lastScan = null;          // { files, parsed, removed, skipped, errors, ms }
    this.roots = [];
    this.watchers = [];
    this.pendingScan = null;
    this.cache = new Map();        // derived views, for this.version
    this.cacheVersion = -1;
    this.stopping = false;          // Stop was asked; the worker stops at its next yield
    this.pendingWrites = new Map(); // file → { text, what }, until the worker exists
    this.rescan = debounce(() => this.scan(this.roots), WATCH_SETTLE_MS);
  }

  start() {
    if (this.worker) return;
    this.worker = new Worker(new URL('./library-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.message(e.data || {});
    this.worker.onerror = (e) => console.warn(`music: library worker: ${e && e.message}`);
    this.worker.postMessage({
      op: 'init',
      indexPath: path.join(this.cacheDir, 'library.json'),
      coversDir: path.join(this.cacheDir, 'covers'),
    });
    for (const [file, w] of this.pendingWrites) this.worker.postMessage({ op: 'write', path: file, ...w });
    this.pendingWrites.clear();
  }

  /** Save `text` to `file` on the scan thread (atomically, in order), so the page never waits on the disk. */
  writeFile(file, text, what = '') {
    if (!this.worker) { this.pendingWrites.set(file, { text, what }); return; }
    this.worker.postMessage({ op: 'write', path: file, text, what });
  }

  message(m) {
    switch (m.op) {
      case 'index':
        for (const s of m.songs) this.byPath.set(s.path, s);
        this.loaded = true;
        this.changed();
        if (this.pendingScan) { const r = this.pendingScan; this.pendingScan = null; this.scan(r); }
        break;
      case 'progress':
        if (m.id !== this.scanning) return;
        this.progress = { folders: m.folders, files: m.files, parsed: m.parsed };
        this.onProgress(this.progress);
        break;
      case 'batch':
        // From any scan, a stopped or replaced one too: the worker's index
        // already has these, so a later scan will not send them again.
        for (const s of m.songs) this.byPath.set(s.path, s);
        this.changed();
        break;
      case 'done':
        if (m.id !== this.scanning) return;
        for (const p of m.removed) this.byPath.delete(p);
        this.scanning = 0;
        this.progress = null;
        this.stopping = false;            // a Stop that came too late
        this.lastScan = { files: m.files, parsed: m.parsed, removed: m.removed.length, skipped: m.skipped || {},
          errors: m.errors, ms: m.ms, parseMs: m.parseMs, waitMs: m.waitMs };
        if (m.removed.length) this.changed();
        this.onScanned(this.lastScan);
        break;
      case 'stopped':
        if (m.id !== this.scanning) return;
        this.scanning = 0;
        this.progress = null;
        this.stopping = false;
        this.onScanned(null);
        break;
      case 'failed':
        console.warn(`music: scan failed: ${m.error}`);
        if (m.id === this.scanning) { this.scanning = 0; this.progress = null; this.stopping = false; this.onScanned(null); }
        break;
    }
  }

  changed() {
    this.version++;
    this.onChange();
  }

  /**
   * Walk `roots` (an array, or a function answering one when the scan
   * starts) for music; a scan already running gives way to this one. Before
   * the saved index is in, the scan waits for it.
   */
  scan(roots) {
    if (!this.worker) this.start();
    if (!this.loaded) { this.pendingScan = roots; return 0; }
    this.roots = (typeof roots === 'function' ? roots() : roots).slice();
    const id = ++this.scanSeq;
    this.scanning = id;
    this.progress = { folders: 0, files: 0, parsed: 0 };
    this.onProgress(this.progress);
    this.worker.postMessage({ op: 'scan', id, roots: this.roots });
    return id;
  }

  /** Stop the scan that is running; what it read so far stays. */
  stop() {
    if (this.pendingScan) { this.pendingScan = null; this.onScanned(null); }
    if (!this.scanning || this.stopping) return;
    this.stopping = true;
    this.worker.postMessage({ op: 'stop' });
  }

  /** Scan again whenever a music file under `roots` changes (where bro.vfs exists). */
  watch(roots) {
    for (const w of this.watchers) if (w && typeof w.unwatch === 'function') w.unwatch();
    this.watchers = [];
    const vfs = api('vfs');
    if (!vfs || typeof vfs.watch !== 'function') return false;
    for (const root of roots) {
      try {
        this.watchers.push(vfs.watch(root, (events) => {
          if (events.some((ev) => relevant(ev.path))) this.rescan();
        }, { recursive: true }));
      } catch (err) {
        console.warn(`music: cannot watch ${root}: ${err.message}`);
      }
    }
    return this.watchers.length > 0;
  }

  get watching() {
    return this.watchers.length > 0;
  }

  song(p) {
    return this.byPath.get(p) || null;
  }

  get size() {
    return this.byPath.size;
  }

  // ---- views, built once per change -------------------------------------------------

  memo(key, build) {
    if (this.cacheVersion !== this.version) { this.cache.clear(); this.cacheVersion = this.version; }
    if (!this.cache.has(key)) this.cache.set(key, build());
    return this.cache.get(key);
  }

  /** Every song, in library order. */
  songs() {
    return this.memo('songs', () => Array.from(this.byPath.values()).sort(libraryOrder));
  }

  /** Albums: { key, title, artist, year, cover, songs (track order), duration, tKey, aKey, search }. */
  albums() {
    return this.memo('albums', () => {
      const map = new Map();
      for (const s of this.songs()) {
        let a = map.get(s.albumKey);
        if (!a) {
          a = { key: s.albumKey, title: s.album || UNKNOWN_ALBUM, artist: s.albumArtist || s.artist || UNKNOWN_ARTIST,
            year: 0, cover: '', songs: [], duration: 0 };
          map.set(s.albumKey, a);
        }
        a.songs.push(s);
        a.duration += s.duration || 0;
        if (!a.cover && s.cover) a.cover = s.cover;
        if (s.year && (!a.year || s.year < a.year)) a.year = s.year;
      }
      const out = Array.from(map.values());
      for (const a of out) {
        a.songs.sort(trackOrder);
        a.count = a.songs.length;
        a.tKey = sortKey(a.title);
        a.aKey = sortKey(a.artist);
        a.search = `${a.title}\n${a.artist}`.toLowerCase();
      }
      return out.sort((x, y) => byNumber(x.aKey, y.aKey) || byNumber(x.year, y.year) || byNumber(x.tKey, y.tKey));
    });
  }

  album(key) {
    return this.memo('album-index', () => new Map(this.albums().map((a) => [a.key, a]))).get(key) || null;
  }

  /** Artists by the songs' artist tag: { key, name, songs, albums, count, albumCount, cover }. */
  artists() {
    return this.memo('artists', () => {
      const map = new Map();
      for (const a of this.albums()) {
        for (const s of a.songs) {
          const name = s.artist || UNKNOWN_ARTIST;
          const key = name.toLowerCase();
          let ar = map.get(key);
          if (!ar) { ar = { key, name, songs: [], albumSet: new Set(), cover: '' }; map.set(key, ar); }
          ar.songs.push(s);
          ar.albumSet.add(a.key);
          if (!ar.cover && a.cover) ar.cover = a.cover;
        }
      }
      const out = Array.from(map.values()).map((ar) => ({
        key: ar.key, name: ar.name, songs: ar.songs, albums: Array.from(ar.albumSet), count: ar.songs.length,
        albumCount: ar.albumSet.size, cover: ar.cover, aKey: sortKey(ar.name), search: ar.name.toLowerCase(),
      }));
      return out.sort((x, y) => byNumber(x.aKey, y.aKey));
    });
  }

  artist(key) {
    return this.memo('artist-index', () => new Map(this.artists().map((a) => [a.key, a]))).get(key) || null;
  }

  /**
   * One folder of the library: its subfolders (with how many songs each
   * holds, all the way down) and its songs. '' is the top: the library folders.
   */
  folder(dir) {
    return this.memo(`folder:${dir}`, () => {
      if (!dir) {
        return {
          folders: this.roots.map((r) => ({ path: r, name: path.basename(r) || r, count: 0, isFolder: true })).map((f) => {
            f.count = this.countUnder(f.path);
            return f;
          }),
          songs: [],
        };
      }
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      const sub = new Map();
      const songs = [];
      for (const s of this.songs()) {
        if (!s.path.startsWith(prefix)) continue;
        const rest = s.path.slice(prefix.length);
        const cut = rest.search(/[\\/]/);
        if (cut < 0) { songs.push(s); continue; }
        const name = rest.slice(0, cut);
        const f = sub.get(name);
        if (f) f.count++;
        else sub.set(name, { path: prefix + name, name, count: 1, isFolder: true });
      }
      const folders = Array.from(sub.values()).sort((a, b) => byNumber(a.name.toLowerCase(), b.name.toLowerCase()));
      return { folders, songs: songs.sort(trackOrder) };
    });
  }

  countUnder(dir) {
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    let n = 0;
    for (const s of this.byPath.values()) if (s.path.startsWith(prefix)) n++;
    return n;
  }

  /** The library folder a path is in, or ''. */
  rootOf(p) {
    return this.roots.find((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) || '';
  }
}

/** Whether a file event can change the library: music, a folder picture, or a folder. */
function relevant(p) {
  const name = String(p || '').split(/[\\/]/).pop();
  if (!name || name.startsWith('.')) return false;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return true;                                        // a folder (most likely)
  const ext = name.slice(dot + 1).toLowerCase();
  return PLAYABLE.has(ext) || ext === 'jpg' || ext === 'jpeg' || ext === 'png' || UNPLAYABLE.has(ext);
}
