/**
 * Decoded pictures, made off the page's thread and kept for the images next
 * to the one on screen, so Next and Previous show at once.
 *
 *   const decoder = new Decoder({ inUse: (pic) => pic === viewer.pic, onFull: (pic) => redraw() });
 *   const pic = await decoder.get(path);            // the one to show: jumps the queue
 *   decoder.prefetch([next, prev]);                 // the neighbours, when idle
 *   decoder.wantFull(pic);                          // full resolution, for a deep zoom
 *   pic = { path, kind: 'bitmap' | 'animated' | 'img' | 'vector', source, partial, full, width, height, orientation, exif, ms }
 *
 * 'bitmap' pictures come from the decoder thread (js/decode-worker.js) as an
 * ImageBitmap, upright (EXIF applied), at most screen-sized: `partial` says
 * the bitmap holds fewer pixels than the picture. That keeps the neighbours
 * held for Next and Previous small. Zoomed in past it, the view asks for the
 * whole picture at full resolution (`full`), which a second decoder thread
 * sends from the decode it keeps: a transferred ImageBitmap moves to the page
 * as a handle and bro uploads it to the GPU before it is drawn.
 *
 * An animated GIF or WebP ('animated') and an SVG ('vector', drawn at the
 * size it is shown) are an <img> on the page, which bro decodes off the page
 * thread and plays; 'img' is the fallback for a file bro.image refuses.
 */

import { formatOf } from './formats.js';

/** Pictures kept decoded: the current one and its neighbours. */
const KEEP = 3;

/** A decoder thread and its queue of jobs: one at a time, urgent ones first. */
class Channel {
  constructor() {
    this.worker = null;
    this.seq = 0;
    this.queue = [];
    this.busy = null;
  }

  send(msg, urgent = true) {
    return new Promise((resolve, reject) => {
      const job = { msg: { ...msg, id: ++this.seq }, resolve, reject };
      if (urgent) this.queue.unshift(job); else this.queue.push(job);
      this.pump();
    });
  }

  /**
   * Drop the queued jobs (not the one running) for paths outside `keep`:
   * holding Next queues a decode per keypress, and only the photo the user
   * stops on is worth decoding. Each dropped job rejects as `superseded`.
   */
  dropExcept(keep) {
    this.queue = this.queue.filter((job) => {
      if (keep.has(job.msg.path)) return true;
      const err = new Error('superseded');
      err.superseded = true;
      job.reject(err);
      return false;
    });
  }

  /** Move a queued job for `path` to the front. */
  hurry(path) {
    const i = this.queue.findIndex((j) => j.msg.path === path);
    if (i > 0) this.queue.unshift(this.queue.splice(i, 1)[0]);
  }

  pump() {
    if (this.busy || !this.queue.length) return;
    this.busy = this.queue.shift();
    this.ensure().postMessage(this.busy.msg);
  }

  ensure() {
    if (this.worker) return this.worker;
    this.worker = new Worker('js/decode-worker.js');
    this.worker.onmessage = (e) => this.done(e.data);
    this.worker.onerror = (e) => this.done({ error: (e && e.message) || 'the decoder stopped' }, true);
    return this.worker;
  }

  async done(m, crashed = false) {
    const job = this.busy;
    this.busy = null;
    this.pump();
    if (!job || (!crashed && job.msg.id !== m.id)) return;
    if (m.error) { job.reject(new Error(m.error)); return; }
    if (!m.bitmap && m.pixels) {
      m.bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(m.pixels), m.pixelWidth, m.pixelHeight));
    }
    job.resolve(m);
  }
}

export class Decoder {
  /**
   * inUse(pic): whether a picture is on screen (it is never closed then).
   * onFull(pic): the full-resolution bitmap of pic arrived.
   */
  constructor({ inUse, onFull } = {}) {
    this.inUse = inUse;
    this.onFull = onFull;
    this.pictures = new Channel();   // previews: the current image and its neighbours
    this.detail = new Channel();     // the image on screen at full resolution, and copies (keeps its full decode)
    this.cache = new Map();          // path -> picture (insertion order = age)
    this.inflight = new Map();       // path -> promise
    this.maxSide = previewSide();
  }

  /** The picture for `path`, decoded now (ahead of any prefetch, which it cancels). */
  get(path) {
    this.pictures.dropExcept(new Set([path]));
    const hit = this.cache.get(path);
    if (hit) {
      this.cache.delete(path);
      this.cache.set(path, hit);
      return Promise.resolve(hit);
    }
    if (this.inflight.has(path)) {
      this.pictures.hurry(path);
      return this.inflight.get(path);
    }
    return this.start(path, true);
  }

  /**
   * The picture as a PNG Blob at full resolution, upright: encoded on the
   * decoder thread (which keeps the full decode of the picture on screen);
   * a picture decoded on the page is drawn to a canvas at its own size.
   */
  async png(pic) {
    if (pic.kind === 'bitmap' || pic.kind === 'animated') {   // an animation copies its first frame
      const m = await this.detail.send({ op: 'png', path: pic.path });
      return new Blob([m.png], { type: 'image/png' });
    }
    const canvas = document.createElement('canvas');
    canvas.width = pic.width;
    canvas.height = pic.height;
    canvas.getContext('2d').drawImage(pic.source, 0, 0, pic.width, pic.height);
    return new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('could not encode the image'))), 'image/png'));
  }

  /** The decoded picture for `path` if it is already here, else null (nothing is started). */
  peek(path) {
    return this.cache.get(path) || null;
  }

  /** Decode these in the background, if nothing more urgent is waiting. */
  prefetch(paths) {
    for (const p of paths) {
      if (!p || this.cache.has(p) || this.inflight.has(p)) continue;
      const f = formatOf(p);
      if (!f || f.decode !== 'worker') continue;   // page-side decodes would stall a frame
      this.start(p, false).catch(() => {});
    }
  }

  /** Fetch the full-resolution bitmap of a partial `pic` (once; onFull says when it is in). */
  wantFull(pic) {
    if (!pic || !pic.partial || pic.full || pic.fullPending) return;
    pic.fullPending = true;
    this.detail.send({ op: 'picture', path: pic.path, maxSide: 0 }).then((m) => {
      if (pic.released) { m.bitmap.close(); return; }
      pic.full = m.bitmap;
      if (this.onFull) this.onFull(pic);
    }, () => {}).finally(() => { pic.fullPending = false; });
  }

  /** Let go of a picture's full-resolution bitmap (the view moved on). */
  release(pic) {
    if (!pic || !pic.full) return;
    const full = pic.full;
    pic.full = null;
    setTimeout(() => full.close(), 250);
  }

  /** The file was renamed: keep its picture under the new name. */
  rename(from, to) {
    const pic = this.cache.get(from);
    if (!pic) return;
    this.cache.delete(from);
    pic.path = to;
    this.cache.set(to, pic);
  }

  /** Forget a file (renamed, trashed, rewritten). */
  drop(path) {
    const pic = this.cache.get(path);
    this.cache.delete(path);
    // Freeing a bitmap is not free: not in the frame that shows the next one,
    // and never the one on screen.
    if (pic && pic.kind === 'bitmap') {
      setTimeout(() => {
        if (this.inUse && this.inUse(pic)) return;
        this.release(pic);
        pic.released = true;
        if (pic.source) pic.source.close();
      }, 250);
    }
  }

  start(path, urgent) {
    const f = formatOf(path);
    let promise;
    if (f && f.decode === 'unsupported') promise = Promise.reject(new Error(f.reason));
    else if (f && f.decode !== 'worker') promise = loadOnPage(path, f.decode);
    else {
      const t0 = now();
      promise = this.pictures.send({ op: 'picture', path, maxSide: this.maxSide }, urgent).then((m) => m.animated
        ? loadOnPage(path, 'animated').then((pic) => ({ ...pic, exif: m.exif || null, ms: now() - t0 }))
        : {
        path, kind: 'bitmap', source: m.bitmap, partial: m.bitmap.width < m.width, full: null,
        width: m.width, height: m.height, orientation: m.orientation || 1, exif: m.exif || null, ms: now() - t0,
      }, (err) => (err.superseded ? Promise.reject(err)                  // nobody wants it any more
        : loadOnPage(path, 'img').catch(() => { throw err; })));          // bro.image refused it: try the page's
                                                                          // decoder, else say why bro.image could not
    }
    promise = promise.then((pic) => {
      this.inflight.delete(path);
      this.keep(pic);
      return pic;
    }, (err) => {
      this.inflight.delete(path);
      throw err;
    });
    this.inflight.set(path, promise);
    return promise;
  }

  keep(pic) {
    this.cache.set(pic.path, pic);
    while (this.cache.size > KEEP) {
      const [oldest] = this.cache.keys();
      this.drop(oldest);
    }
  }
}

/**
 * The long side of the bitmap a picture first arrives as: enough for the
 * whole screen at its pixel density, so a fitted view never needs more.
 */
function previewSide() {
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const sw = typeof screen !== 'undefined' && screen ? Math.max(screen.width || 0, screen.height || 0) : 0;
  return Math.max(2048, Math.ceil(sw * dpr));
}

/** An <img> decode on the page (WebP, SVG, anything bro.image refuses). */
function loadOnPage(path, kind) {
  return new Promise((resolve, reject) => {
    const t0 = now();
    const img = new Image();
    try {
      img.src = path;
    } catch (err) {
      reject(err);
      return;
    }
    if (!img.naturalWidth || !img.naturalHeight) {
      reject(new Error('bro cannot decode this file'));
      return;
    }
    resolve({
      path, kind: kind === 'vector' || kind === 'animated' ? kind : 'img', source: img, partial: false, full: null,
      width: img.naturalWidth, height: img.naturalHeight, orientation: 1, ms: now() - t0,
    });
  });
}

function now() {
  return typeof globalThis.perf !== 'undefined' && globalThis.perf.now ? globalThis.perf.now() : Date.now();
}
