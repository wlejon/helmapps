/**
 * The program: what the stream has made and will make, chunk by chunk, built
 * from its events. The timeline, the now strip and the plane all read it.
 *
 *   const prog = new Program();
 *   prog.event(e, { pos })      // every stream event; pos: where the listener stood when it was sent
 *   prog.heard(index, info)     // CLAP's verdict on a played chunk
 *   prog.cards(playhead, ctx)   // [{ index, style, how, change, state, sample, heard, eta, pos }]
 *   prog.playing(playhead)      // the chunk at the playhead, or null
 *
 * States: planned (a style asked for, its chunk not begun), writing (tokens
 * being sampled: the chunk after the newest sampled one), rendering (tokens
 * done), ready (rendered), now, played.
 */

import { tagStyle } from './styles.js';

const RATE = 48000;
const CHUNK = 10 * RATE;
const KEEP = 40;          // chunks remembered

export class Program {
  constructor() { this.reset(); }

  reset() {
    this.chunks = new Map();   // index -> chunk
    this.planned = null;       // { chunk, sample, style, tag }
    this.newestSampled = -1;
  }

  chunk(i) {
    let c = this.chunks.get(i);
    if (!c) { c = { index: i, style: null, tag: '', how: '', change: false, sampled: false, built: false, sample: -1, heard: null, pos: null }; this.chunks.set(i, c); }
    return c;
  }

  event(e, ctx = {}) {
    if (e.branch) return;                       // only the main line
    if (e.kind === 'sampled' && e.row) {
      const c = this.chunk(e.row.index);
      c.style = tagStyle(e.row.tag) || c.style;
      c.tag = e.row.tag; c.how = e.row.how || ''; c.change = !!e.row.change;
      c.sampled = true; c.built = false;
      c.pos = ctx.pos || c.pos;
      this.newestSampled = Math.max(this.newestSampled, e.row.index);
      if (this.planned && this.planned.chunk <= e.row.index && c.tag === this.planned.tag) this.planned = null;
    } else if (e.kind === 'built' && e.row) {
      this.chunk(e.row.index).built = true;
    } else if (e.kind === 'chunkStart') {
      this.chunk(e.chunk).sample = e.sample;
    } else if (e.kind === 'planned') {
      this.planned = { chunk: e.chunk, sample: e.sample, tag: e.tag, style: tagStyle(e.tag) };
    }
    // Forget old chunks.
    if (this.chunks.size > KEEP) {
      const keys = [...this.chunks.keys()].sort((a, b) => a - b);
      for (const k of keys.slice(0, this.chunks.size - KEEP)) this.chunks.delete(k);
    }
  }

  heard(index, info) {
    const c = this.chunks.get(index);
    if (c) c.heard = info;
  }

  playing(playhead) {
    let best = null;
    for (const c of this.chunks.values()) if (c.sample >= 0 && c.sample <= playhead && (!best || c.sample > best.sample)) best = c;
    return best;
  }

  /**
   * The cards in order. ctx: { running, target (the style the next chunk is
   * written under), pos }.
   */
  cards(playhead, ctx = {}) {
    const now = this.playing(playhead);
    const out = [];
    for (const c of [...this.chunks.values()].sort((a, b) => a.index - b.index)) {
      if (!c.sampled || !c.style) continue;
      let state;
      if (now && c.index < now.index) state = 'played';
      else if (now && c.index === now.index) state = 'now';
      else state = c.built ? 'ready' : 'rendering';
      out.push(Object.assign({}, c, { state }));
    }
    if (ctx.running) {
      const w = this.newestSampled + 1;
      const p = this.planned;
      const writingStyle = p && p.chunk <= w ? p.style : ctx.target;
      if (writingStyle) out.push({ index: w, style: writingStyle, tag: '', how: '', change: !!(p && p.chunk === w), state: 'writing', sample: -1, heard: null });
      if (p && p.chunk > w && p.style) {
        out.push({ index: p.chunk, style: p.style, tag: p.tag, how: '', change: true, state: 'planned', sample: p.sample, heard: null,
          eta: Math.max(0, Math.round((p.sample - playhead) / RATE)) });
      }
    }
    return out;
  }

  /** Where the played chunks were made, oldest first (the plane's trail). */
  trail(playhead, n = 12) {
    const now = this.playing(playhead);
    return [...this.chunks.values()]
      .filter((c) => c.pos && c.sample >= 0 && now && c.index <= now.index)
      .sort((a, b) => a.index - b.index).slice(-n).map((c) => c.pos);
  }
}

export const CHUNK_SAMPLES = CHUNK;
