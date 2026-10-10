/**
 * The now-playing bar along the bottom of the window: the cover, title and
 * artist; shuffle, previous, play/pause, next and repeat; the seek bar with
 * elapsed and remaining time; mute and volume. Every button runs a command.
 *
 *   const bar = new NowPlaying({ player, commands, onSeek, onVolume, onOpenSong });
 *   frame.appendChild(bar.el);
 *   bar.update()        the song, the state, the buttons (on every player change)
 *   bar.tick()          the position (once a frame while playing; cheap)
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Toolbar } from '/lib/layout.js';
import { Slider } from '/lib/controls.js';
import { formatDuration } from '/lib/format.js';
import { artBox, setArt } from './covers.js';

export class NowPlaying {
  constructor({ player, commands, onSeek, onVolume, onOpenAlbum, onOpenArtist }) {
    this.player = player;
    this.commands = commands;
    this.onSeek = onSeek;
    this.shown = { path: null, state: null, repeat: null };

    this.art = artBox('', 'np');
    this.title = h('button.mu-np-title.ellipsis', { onclick: () => onOpenAlbum() });
    this.artist = h('button.mu-np-artist.ellipsis', { onclick: () => onOpenArtist() });
    const song = h('div.mu-np-song', this.art, h('div.mu-np-text', this.title, this.artist));

    const controls = h('div.mu-np-controls');
    this.buttons = new Toolbar(controls, commands);
    this.buttons.button('shuffle');
    this.buttons.button('prev');
    this.playBtn = this.buttons.button('play-pause');
    this.playBtn.classList.add('mu-np-play');
    this.buttons.button('next');
    this.repeatBtn = this.buttons.button('repeat');

    this.elapsed = h('span.num.mu-time');
    this.remaining = h('span.num.mu-time.right');
    this.seek = new Slider({
      min: 0, max: 1, value: 0,
      onInput: (v) => this.showTimes(v),
      onChange: (v) => onSeek(v),
    });
    this.seek.el.classList.add('mu-seek');
    this.seek.el.setAttribute('aria-label', 'Position');
    const seekRow = h('div.mu-np-seek', this.elapsed, this.seek.el, this.remaining);
    const center = h('div.mu-np-center', controls, seekRow);

    const right = h('div.mu-np-right');
    this.volButtons = new Toolbar(right, commands);
    this.muteBtn = this.volButtons.button('mute');
    this.volume = new Slider({ min: 0, max: 1, step: 0.01, value: player.volume,
      onInput: (v) => onVolume(v, false), onChange: (v) => onVolume(v, true) });
    this.volume.el.classList.add('mu-volume');
    this.volume.el.setAttribute('aria-label', 'Volume');
    right.appendChild(this.volume.el);
    this.volButtons.button('show-queue');

    this.el = h('footer.mu-np', song, center, right);
    this.update();
  }

  /** Everything but the position: the song, play/pause, shuffle/repeat, volume. */
  update() {
    const p = this.player;
    const s = p.current;
    const path = s ? s.path : '';
    if (path !== this.shown.path) {
      this.shown.path = path;
      this.title.textContent = s ? s.title : 'Nothing playing';
      this.artist.textContent = s ? s.artist || 'Unknown Artist' : '';
      this.title.disabled = !s;
      this.artist.disabled = !s;
      setArt(this.art, s ? s.cover : '', { own: true });
      this.seek.max = Math.max(1, p.duration);
    }
    if (p.state !== this.shown.state) {
      this.shown.state = p.state;
      const playing = p.state === 'playing';
      this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
      this.playBtn.dataset.tip = playing ? 'Pause' : 'Play';
      this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
    const rep = p.queue.repeat;
    if (rep !== this.shown.repeat) {
      this.shown.repeat = rep;
      this.repeatBtn.replaceChildren(icon(rep === 'one' ? 'repeat-one' : 'repeat'));
      this.repeatBtn.dataset.tip = rep === 'one' ? 'Repeat: one song' : rep === 'all' ? 'Repeat: the queue' : 'Repeat: off';
    }
    this.muteBtn.replaceChildren(icon(p.muted || p.volume === 0 ? 'volume-x' : p.volume < 0.34 ? 'volume-0' : p.volume < 0.67 ? 'volume-1' : 'volume-2'));
    if (!this.volume.dragging) this.volume.set(p.volume);
    this.volume.el.classList.toggle('muted', p.muted);
    this.buttons.refresh();
    this.volButtons.refresh();
    this.seek.setDisabled(!s || !p.duration);
    this.tick();
  }

  /** The position: the seek bar and both times (not while the user drags it). */
  tick() {
    if (this.seek.dragging) return;
    const p = this.player;
    const d = p.duration;
    const t = Math.min(p.position, d || p.position);
    if (Math.abs(this.seek.max - Math.max(1, d)) > 1e-6) this.seek.max = Math.max(1, d);
    this.seek.set(t);
    this.showTimes(t);
  }

  showTimes(t) {
    const d = this.player.duration;
    const s = this.player.current;
    const el = s ? formatDuration(t) : '';
    const rem = s && d ? `-${formatDuration(Math.max(0, d - t))}` : '';
    if (this.elapsed.textContent !== el) this.elapsed.textContent = el;
    if (this.remaining.textContent !== rem) this.remaining.textContent = rem;
  }
}
