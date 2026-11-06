/**
 * The nav bar over a photo: large buttons for the mouse, close together at
 * the bottom centre: back to the grid, Previous, where she is ("12 / 340"),
 * Next, and Leave Full Screen while the window is full screen. Each button
 * runs a command by id, so the keys and the bar do the same thing.
 *
 *   const nav = new NavBar(commands);
 *   viewArea.append(nav.el);
 *   nav.update({ pos: '12 / 340', fullscreen: false });
 *
 * It fades while the pointer is away from it and still, and comes back as
 * soon as the pointer moves over the photo.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';

const IDLE_MS = 2500;

export class NavBar {
  constructor(commands) {
    this.commands = commands;
    const button = (id, name, label, cls = '') => h(`button.iv-nav-btn${cls}`, {
      'data-command': id, 'aria-label': label, title: label,
      onclick: (e) => { e.stopPropagation(); this.commands.run(id); },
    }, icon(name));
    this.gridBtn = button('show-folder', 'grid', 'All photos (Escape)', '.iv-nav-grid');
    this.prevBtn = button('prev', 'chevron-left', 'Previous photo (Left arrow)', '.iv-nav-step');
    this.nextBtn = button('next', 'chevron-right', 'Next photo (Right arrow)', '.iv-nav-step');
    this.exitBtn = button('exit-fullscreen', 'fullscreen-exit', 'Leave full screen (Escape)', '.iv-nav-grid');
    this.pos = h('span.iv-nav-pos.num');
    this.el = h('div.iv-nav', this.gridBtn, this.prevBtn, this.pos, this.nextBtn, this.exitBtn);
    // The pointer on the bar: it stays.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('dblclick', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => e.stopPropagation());
    this.idleTimer = null;
    this.over = false;
    this.el.addEventListener('pointerenter', () => { this.over = true; this.wake(); });
    this.el.addEventListener('pointerleave', () => { this.over = false; this.wake(); });
  }

  /** Show the bar now; it fades again once the pointer has been still, off it, for a while. */
  wake() {
    this.el.classList.remove('idle');
    clearTimeout(this.idleTimer);
    if (!this.over) this.idleTimer = setTimeout(() => this.el.classList.add('idle'), IDLE_MS);
  }

  /** pos: "12 / 340" ('' hides it); fullscreen: offer to leave it. Buttons follow their commands' enabled(). */
  update({ pos = '', fullscreen = false } = {}) {
    this.pos.textContent = pos;
    this.pos.classList.toggle('hidden', !pos);
    this.exitBtn.classList.toggle('hidden', !fullscreen);
    for (const b of [this.gridBtn, this.prevBtn, this.nextBtn, this.exitBtn]) {
      b.disabled = !this.commands.isEnabled(b.dataset.command);
    }
  }
}
