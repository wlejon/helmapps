/**
 * The timeline: the stream's 10 s chunks as cards, oldest left, so what the
 * radio is doing and why the music changed is on screen.
 *
 * Each card says what the chunk was made as (mood and genre), where it is
 * in the pipeline, and, once played, what CLAP heard:
 *   planned    a style asked for, waiting for its chunk ("in 14 s")
 *   writing    YuE2 is sampling its tokens (the score of the music)
 *   rendering  its tokens exist; the renderer is turning them into latents
 *   ready      rendered; decoded to audio just before it plays
 *   now        playing (a bar shows how far in)
 *   played     heard; "sounds like ..." is CLAP's genre and mood for it
 * A card that starts a new style says so, and how the change was made.
 *
 * chunks: [{ index, style, how, change, state, sample, heard }], see main.js.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { styleLabel } from './styles.js';

const RATE = 48000;
const CHUNK_SECONDS = 10;
const PAST = 4;           // played cards kept on screen

const STATE_TEXT = {
  planned: 'planned', writing: 'writing', rendering: 'rendering', ready: 'ready', now: 'now', played: 'played',
};
const HOW_TEXT = { drop: 'clean change', bridge: 'bridged on the beat', fresh: 'fresh start', plain: 'new style' };

export class TimelineView {
  constructor() {
    this.el = h('div.timeline');
    this.key = '';
    this.bar = null;
    this.nowCard = null;
  }

  /** Redraws when the cards changed; moves the playing bar every call. */
  update(chunks, playhead) {
    const now = chunks.find((c) => c.state === 'now');
    const firstShown = Math.max(0, chunks.findIndex((c) => c.state !== 'played') - PAST);
    const shown = chunks.slice(firstShown < 0 ? Math.max(0, chunks.length - PAST) : firstShown);
    const key = shown.map((c) => `${c.index}:${c.state}:${styleLabel(c.style)}/${c.style.instruments}:${c.how}:${c.change}:${c.heard ? c.heard.genre + c.heard.mood : ''}:${c.eta || ''}`).join('|');
    if (key !== this.key) {
      this.key = key;
      this.bar = null;
      this.el.replaceChildren(...shown.map((c) => this.card(c)));
    }
    if (now && this.bar) {
      const f = Math.max(0, Math.min(1, (playhead - now.sample) / (CHUNK_SECONDS * RATE)));
      this.bar.style.width = `${(f * 100).toFixed(1)}%`;
    }
  }

  card(c) {
    const s = c.style;
    const heard = c.heard
      ? h('div.tl-heard.micro', { title: `CLAP: ${c.heard.genre} ${(c.heard.genreP * 100).toFixed(0)}%, ${c.heard.mood} ${(c.heard.moodP * 100).toFixed(0)}%` },
        c.heard.genre === s.genre ? icon('check') : null,
        `sounds like ${c.heard.mood} ${c.heard.genre}`)
      : null;
    const stateText = c.state === 'planned' && c.eta != null ? `planned · in ${c.eta} s` : STATE_TEXT[c.state];
    const el = h(`div.tl-card.${c.state}`, { 'data-index': String(c.index) },
      c.change ? h('div.tl-change.micro', icon('arrow-right'), HOW_TEXT[c.how] || 'new style') : null,
      h('div.tl-style', styleLabel(s)),
      h('div.tl-ins.micro.dim', s.instruments.join(', ')),
      h('div.tl-state.micro', c.state === 'writing' || c.state === 'rendering' ? h('span.spinner.tiny') : null, stateText),
      heard,
      c.state === 'now' ? h('div.tl-bar', (this.bar = h('div.tl-bar-fill'))) : null);
    if (c.change) el.classList.add('change');
    return el;
  }
}
