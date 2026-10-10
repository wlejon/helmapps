/**
 * Decoded pictures, made off the page's thread and kept for the images next
 * to the one on screen, so Next and Previous show at once.
 *
 *   const decoder = new Decoder({ inUse: (pic) => pic === viewer.pic, onTile: (pic) => redraw() });
 *   const pic = await decoder.get(path);            // the one to show: jumps the queue
 *   decoder.prefetch([next, prev]);                 // the neighbours, when idle
 *   decoder.wantTiles(pic, ['0,0', '1,0']);         // full-resolution tiles a deep zoom shows
 *   pic = { path, kind: 'bitmap' | 'img' | 'vector', source, partial, tiles, width, height, orientation, ms }
 *
 * 'bitmap' pictures come from the decoder thread (js/decode-worker.js) as an
 * ImageBitmap, upright (EXIF applied), at most screen-sized: `partial` says
 * the bitmap holds fewer pixels than the picture. Zoomed in past that, the
 * view asks for the tiles (TILE px squares) it shows, which a second decoder
 * thread cuts from the full decode one at a time, so each lands in a frame of
 * its own. Neither the page nor the GPU ever takes 96 MB at once.
 *
 * WebP and SVG are not read by bro.image; they load as an <img> on the page
 * ('img' decodes there, which stalls a frame for a big file; 'vector' is
 * drawn at the size it is shown). GAPS.md.
 */

import { formatOf } from './formats.js';

/** Pictures kept decoded: the current one and its neighbours. */
const KEEP = 3;
/** The side of a full-resolution tile, in image pixels. */
export const TILE = 1024;

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
   * onTile(pic): a full-resolution tile of pic arrived.
   */
  constructor({ inUse, onTile } = {}) {
    this.inUse = inUse;
    this.onTile = onTile;
    this.pictures = new Channel();   // previews: the current image and its neighbours
    this.detail = new Channel();     // tiles of the image on screen (keeps its full decode)
    this.cache = new Map();          // path -> picture (insertion order = age)
    this.inflight = new Map();       // path -> promise
    this.tileFor = null;             // the picture whose tiles are wanted
    this.tileQueue = [];             // tile keys to fetch, in order
    this.tileBusy = false;
    this.maxSide = previewSide();
  }

  /** The picture for `path`, decoded now (ahead of any prefetch). */
  get(path) {
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

  /** Decode these in the background, if nothing more urgent is waiting. */
  prefetch(paths) {
    for (const p of paths) {
      if (!p || this.cache.has(p) || this.inflight.has(p)) continue;
      const f = formatOf(p);
      if (!f || f.decode !== 'worker') continue;   // page-side decodes would stall a frame
      this.start(p, false).catch(() => {});
    }
  }

  /** Fetch these full-resolution tiles of `pic` ('tx,ty' keys), nearest first; others are dropped. */
  wantTiles(pic, keys) {
    if (!pic || !pic.partial) return;
    if (this.tileFor !== pic) this.tileQueue = [];
    this.tileFor = pic;
    this.tileQueue = keys.filter((k) => !pic.tiles.has(k));
    this.pumpTiles();
  }

  pumpTiles() {
    if (this.tileBusy || !this.tileQueue.length || !this.tileFor) return;
    const pic = this.tileFor;
    const key = this.tileQueue.shift();
    const [tx, ty] = key.split(',').map(Number);
    this.tileBusy = true;
    this.detail.send({ op: 'tile', path: pic.path, tx, ty, tile: TILE }).then((m) => {
      if (pic.released) m.bitmap.close();
      else {
        pic.tiles.set(key, { bitmap: m.bitmap, x: m.x, y: m.y });
        if (this.onTile) this.onTile(pic);
      }
    }, () => {}).finally(() => {
      this.tileBusy = false;
      this.pumpTiles();
    });
  }

  /** Let go of a picture's tiles (the view moved on). */
  release(pic) {
    if (!pic || !pic.tiles || !pic.tiles.size) return;
    const tiles = Array.from(pic.tiles.values());
    pic.tiles.clear();
    if (this.tileFor === pic) { this.tileFor = null; this.tileQueue = []; }
    setTimeout(() => { for (const t of tiles) t.bitmap.close(); }, 250);
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
    if (f && f.decode !== 'worker') promise = loadOnPage(path, f.decode);
    else {
      const t0 = now();
      promise = this.pictures.send({ op: 'picture', path, maxSide: this.maxSide }, urgent).then((m) => ({
        path, kind: 'bitmap', source: m.bitmap, partial: m.bitmap.width < m.width, tiles: new Map(),
        width: m.width, height: m.height, orientation: m.orientation || 1, ms: now() - t0,
      }), () => loadOnPage(path, 'img'));          // bro.image refused it: try the page's decoder
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
      path, kind: kind === 'vector' ? 'vector' : 'img', source: img, partial: false, tiles: new Map(),
      width: img.naturalWidth, height: img.naturalHeight, orientation: 1, ms: now() - t0,
    });
  });
}

function now() {
  return typeof globalThis.perf !== 'undefined' && globalThis.perf.now ? globalThis.perf.now() : Date.now();
}
