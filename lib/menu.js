/**
 * Menus: context menus and drop-down menus, drawn in the page.
 *
 *   import { menu } from '/lib/menu.js';
 *   el.addEventListener('contextmenu', (e) => {
 *     e.preventDefault();
 *     menu.show([
 *       { heading: 'notes.txt' },
 *       { label: 'Open', icon: 'external-link', keys: 'Enter', action: open },
 *       { label: 'Open With', icon: 'apps', submenu: [ ...items ] },
 *       { separator: true },
 *       { label: 'Show Hidden Files', checked: showHidden, action: toggle },
 *       { label: 'Move to Trash', icon: 'trash', danger: true, action: trash },
 *     ], e.clientX, e.clientY);
 *   });
 *   menu.showBelow(items, buttonEl);         // a drop-down from a toolbar button
 *
 * Items: { label, icon?, count? (a number at the trailing edge, as a filter's
 * "Blue Jay 3"), keys? (display text), checked? (true/false shows a check
 * column), disabled?, danger?, action?, submenu? } | { separator: true }
 * | { heading }. commands.item(id) builds one from a command. Keyboard: arrows
 * move, Enter/Space choose, Right/Left open/close a submenu, Escape closes,
 * a letter jumps to the next item starting with it.
 */

import { h, clamp } from './dom.js';
import { icon } from './icons.js';
import { formatNumber } from './format.js';

class MenuLevel {
  constructor(owner, items, parent) {
    this.owner = owner;
    this.parent = parent;
    this.items = items.filter(Boolean);
    this.rows = [];
    this.active = -1;
    this.child = null;
    const hasCheck = this.items.some((it) => it.checked === true || it.checked === false);
    this.el = h('div.menu', { role: 'menu', tabindex: '-1' });
    this.items.forEach((it) => {
      if (it.separator) { this.el.appendChild(h('div.menu-sep')); return; }
      if (it.heading) { this.el.appendChild(h('div.menu-label', it.heading)); return; }
      const row = h('div.menu-item', { role: 'menuitem' },
        hasCheck ? h('span.menu-check', it.checked ? icon('check') : null) : null,
        it.icon ? icon(it.icon) : null,
        h('span.menu-text', it.label),
        it.count != null ? h('span.menu-count.num', typeof it.count === 'number' ? formatNumber(it.count) : String(it.count)) : null,
        it.keys ? h('span.menu-keys', it.keys) : null,
        it.submenu ? h('span.menu-sub', icon('chevron-right', 'sm')) : null);
      if (it.disabled) row.classList.add('disabled');
      if (it.danger) row.classList.add('danger');
      const index = this.rows.length;
      this.rows.push({ it, row });
      row.addEventListener('pointerenter', () => this.setActive(index, true));
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.choose(index);
      });
      this.el.appendChild(row);
    });
  }

  place(x, y) {
    document.body.appendChild(this.el);
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.round(clamp(x, 6, window.innerWidth - r.width - 6))}px`;
    this.el.style.top = `${Math.round(clamp(y, 6, window.innerHeight - r.height - 6))}px`;
  }

  setActive(i, fromPointer) {
    if (this.active >= 0 && this.rows[this.active]) this.rows[this.active].row.classList.remove('active');
    this.active = i;
    const r = this.rows[i];
    if (!r) return;
    r.row.classList.add('active');
    if (!fromPointer && r.row.scrollIntoView) r.row.scrollIntoView({ block: 'nearest' });
    if (fromPointer) {
      if (r.it.submenu && !r.it.disabled) this.openChild(i);
      else this.closeChild();
    }
  }

  move(delta) {
    const n = this.rows.length;
    if (!n) return;
    let i = this.active;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (!this.rows[i].it.disabled) { this.setActive(i, false); return; }
    }
  }

  jump(letter) {
    const n = this.rows.length;
    for (let step = 1; step <= n; step++) {
      const i = (this.active + step + n) % n;
      const label = String(this.rows[i].it.label || '').trim().toLowerCase();
      if (!this.rows[i].it.disabled && label.startsWith(letter)) { this.setActive(i, false); return; }
    }
  }

  openChild(i) {
    const r = this.rows[i];
    if (!r || !r.it.submenu) return;
    if (this.child && this.child.from === i) return;
    this.closeChild();
    const child = new MenuLevel(this.owner, r.it.submenu, this);
    child.from = i;
    const rr = r.row.getBoundingClientRect();
    child.place(rr.right + 2, rr.top - 5);
    const cr = child.el.getBoundingClientRect();
    if (cr.left < rr.right) child.el.style.left = `${Math.round(Math.max(6, rr.left - cr.width - 2))}px`;
    this.child = child;
  }

  closeChild() {
    if (!this.child) return;
    this.child.closeChild();
    this.child.el.remove();
    this.child = null;
  }

  choose(i) {
    const r = this.rows[i];
    if (!r || r.it.disabled) return;
    if (r.it.submenu) {
      this.openChild(i);
      if (this.child) this.child.move(1);
      return;
    }
    this.owner.close();
    if (r.it.action) r.it.action();
  }

  deepest() {
    let l = this;
    while (l.child) l = l.child;
    return l;
  }
}

export class Menu {
  constructor() {
    this.root = null;
    this.onClose = null;
    this.returnFocus = null;
    document.addEventListener('pointerdown', (e) => {
      if (!this.root) return;
      for (let l = this.root; l; l = l.child) if (l.el.contains(e.target)) return;
      this.close();
    }, true);
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('blur', () => this.close());
  }

  get isOpen() {
    return !!this.root;
  }

  /** Open a menu with its top-left at (x, y), kept inside the window. */
  show(items, x, y, { onClose } = {}) {
    this.close();
    this.returnFocus = document.activeElement;
    this.root = new MenuLevel(this, items, null);
    this.root.place(x, y);
    this.onClose = onClose || null;
    this.root.el.focus();
    return this.root.el;
  }

  /** A drop-down under an anchor element (a toolbar button). */
  showBelow(items, anchor, opts) {
    const r = anchor.getBoundingClientRect();
    return this.show(items, r.left, r.bottom + 4, opts);
  }

  /** A menu at an element's position, for keyboard-opened context menus (Shift+F10). */
  showAt(items, el, opts) {
    const r = el.getBoundingClientRect();
    return this.show(items, r.left + 12, r.top + r.height / 2, opts);
  }

  close() {
    if (!this.root) return;
    this.root.closeChild();
    this.root.el.remove();
    this.root = null;
    const fn = this.onClose;
    this.onClose = null;
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && back.focus && document.contains(back)) back.focus();
    if (fn) fn();
  }

  onKey(e) {
    if (!this.root) return;
    const level = this.root.deepest();
    let handled = true;
    switch (e.key) {
      case 'Escape':
        if (level.parent) level.parent.closeChild(); else this.close();
        break;
      case 'ArrowDown': level.move(1); break;
      case 'ArrowUp': level.move(-1); break;
      case 'Home': level.active = -1; level.move(1); break;
      case 'End': level.active = 0; level.move(-1); break;
      case 'ArrowRight':
        if (level.active >= 0 && level.rows[level.active].it.submenu) level.choose(level.active);
        break;
      case 'ArrowLeft':
        if (level.parent) level.parent.closeChild();
        break;
      case 'Enter':
      case ' ':
        if (level.active >= 0) level.choose(level.active);
        break;
      case 'Tab':
        this.close();
        break;
      default:
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) level.jump(e.key.toLowerCase());
        else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

/** The app's one menu manager. */
export const menu = new Menu();
