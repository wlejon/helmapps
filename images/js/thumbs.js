/**
 * Small previews for the strip and the folder grid, asked for only for the
 * cells on screen and a few at a time.
 *
 *   const thumbs = new Thumbs({ onReady: (path, url) => paintCell(path, url) });
 *   thumbs.url(path)        a ready preview's URL, or null (and asks for one)
 *
 * bro.thumb makes them on its own threads and keeps them in the system's
 * thumbnail cache (shared with Files). Without bro.thumb, or for a file it
 * cannot do, the decoder thread shrinks the image itself (js/decode-worker.js).
 * An SVG is its own preview: bro draws it sharp at any size. A file nothing
 * can decode answers 'failed', and its cell shows a file icon; so does a
 * format this machine cannot decode at all (HEIC without a system decoder),
 * without trying.
 */

import { api } from '/lib/dom.js';
import { formatOf } from './formats.js';

/**
 * Previews asked for at once. bro.thumb spreads them over the machine's
 * cores, and a camera JPEG's decode is serial within a file, so a screenful
 * comes fast only with many in flight (a 24 MP card: 6 at once took 5 s for
 * a screen of 56, 24 at once 0.5 s). The rest of the queue stays here, where
 * scrolling away drops it.
 */
const PARALLEL = 24;
/**
 * Previews fill the folder grid's square tiles (about 240 px, cropped to
 * fill), so a 3:2 photo needs the 512 px tier for its short side to cover
 * one. The long side of one the decoder thread makes matches.
 */
const THUMB_SIZE = 'x-large';
const WORKER_SIZE = 512;

export const FAILED = 'failed';

export class Thumbs {
  constructor({ onReady } = {}) {
    this.onReady = onReady;
    this.ready = new Map();      // path -> url | FAILED
    this.wanted = [];            // paths asked for, newest last
    this.running = 0;
    this.thumb = api('thumb');
    this.worker = null;
    this.seq = 0;
    this.jobs = new Map();       // worker id -> { resolve, reject }
    this.urls = [];              // blob URLs we made
  }

  /** The preview URL if it is ready ('failed' when there is none); else null, and it is made. */
  url(path) {
    const r = this.ready.get(path);
    if (r) return r;
    const f = formatOf(path);
    if (f && f.decode === 'vector') {
      this.ready.set(path, path);
      return path;
    }
    if (f && f.decode === 'unsupported') {       // a HEIC this machine cannot decode: a placeholder tile
      this.ready.set(path, FAILED);
      return FAILED;
    }
    if (!this.wanted.includes(path)) this.wanted.push(path);
    this.pump();
    return null;
  }

  /** Forget a file's preview (it changed or went away). */
  forget(path) {
    this.ready.delete(path);
    if (this.thumb) {
      try { this.thumb.invalidate(path); } catch (_) { /* not cached */ }
    }
  }

  /** Drop requests for paths no longer on screen. */
  keepOnly(paths) {
    const keep = new Set(paths);
    this.wanted = this.wanted.filter((p) => keep.has(p));
  }

  pump() {
    while (this.running < PARALLEL && this.wanted.length) {
      // Newest first: what was just scrolled to is what the user looks at.
      const path = this.wanted.pop();
      if (this.ready.has(path)) continue;
      this.running++;
      this.make(path).then((url) => this.done(path, url), () => this.done(path, FAILED));
    }
  }

  done(path, url) {
    this.running--;
    this.ready.set(path, url);
    if (this.onReady) this.onReady(path, url);
    this.pump();
  }

  async make(path) {
    if (this.thumb) {
      try {
        const r = await this.thumb.get(path, { size: THUMB_SIZE, priority: 'high' });
        if (r && r.path) return r.path;
      } catch (_) { /* fall through to our own decoder */ }
    }
    return this.fromWorker(path);
  }

  fromWorker(path) {
    if (!this.worker) {
      this.worker = new Worker('js/decode-worker.js');
      this.worker.onmessage = (e) => {
        const job = this.jobs.get(e.data.id);
        if (!job) return;
        this.jobs.delete(e.data.id);
        if (e.data.error) job.reject(new Error(e.data.error));
        else {
          const url = URL.createObjectURL(new Blob([e.data.png], { type: 'image/png' }));
          this.urls.push(url);
          job.resolve(url);
        }
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ id, op: 'thumb', path, size: WORKER_SIZE });
    });
  }
}
