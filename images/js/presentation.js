/**
 * Full screen (bro.window) and the slideshow. The slideshow goes full screen,
 * moves on every `slideshowSeconds` (a setting), and any key or click stops
 * it, without that key doing anything else.
 *
 *   const p = new Presentation({ settings, next, canRun, onChange });
 *   p.setFullscreen(true); p.startSlideshow(); p.stopSlideshow();
 */

import { toast } from '/lib/toast.js';

export class Presentation {
  constructor({ settings, next, canRun, onChange }) {
    this.settings = settings;
    this.next = next;
    this.canRunFn = canRun;
    this.onChange = onChange;
    this.fullscreen = false;
    this.timer = null;
    this.wasFullscreen = false;
    this.stopOnInput = (e) => {
      if (!this.timer) return;
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      this.stopSlideshow();
    };
    // The window manager can take the window out of full screen too.
    window.addEventListener('resize', () => this.sync());
  }

  get win() {
    return typeof bro !== 'undefined' && bro.window ? bro.window : null;
  }

  get running() {
    return !!this.timer;
  }

  canRun() {
    return !!this.canRunFn();
  }

  setFullscreen(on) {
    const w = this.win;
    if (!w) return;
    if (typeof w.setFullscreen === 'function') w.setFullscreen(!!on);
    else if (!!w.fullscreen !== !!on) w.toggleFullscreen();
    this.fullscreen = !!on;
    if (!on && this.timer) this.stopSlideshow();
    this.onChange();
  }

  sync() {
    const w = this.win;
    if (!w || typeof w.fullscreen !== 'boolean' || w.fullscreen === this.fullscreen) return;
    this.fullscreen = w.fullscreen;
    if (!this.fullscreen && this.timer) this.stopSlideshow();
    this.onChange();
  }

  startSlideshow() {
    if (this.timer || !this.canRun()) return;
    this.wasFullscreen = this.fullscreen;
    if (!this.fullscreen) this.setFullscreen(true);
    const ms = Math.max(1, this.settings.get('slideshowSeconds')) * 1000;
    this.timer = setInterval(() => this.next(), ms);
    window.addEventListener('keydown', this.stopOnInput, true);
    window.addEventListener('pointerdown', this.stopOnInput, true);
    toast('Slideshow: press any key to stop', { icon: 'play', ms: 2500 });
    this.onChange();
  }

  stopSlideshow() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('keydown', this.stopOnInput, true);
    window.removeEventListener('pointerdown', this.stopOnInput, true);
    if (!this.wasFullscreen && this.fullscreen) this.setFullscreen(false);
    this.onChange();
  }
}
