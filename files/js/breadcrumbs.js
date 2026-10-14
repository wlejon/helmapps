/**
 * Breadcrumbs bar with toggleable path-entry field (Mod+L).
 * Handles both POSIX (/home/...) and Windows (C:\...) paths as well as trash://.
 */

import { h } from '/lib/dom.js';
import { Breadcrumbs } from '/lib/layout.js';
import { homeDir } from '/lib/files.js';
import { TRASH_URI } from './model.js';

const path = require('path');

export class LocationBar {
  constructor({ onNavigate }) {
    this.onNavigate = onNavigate;
    this.currentPath = '';
    this.editing = false;

    this.crumbs = new Breadcrumbs({
      onNavigate: (target) => {
        if (this.onNavigate) this.onNavigate(target);
      },
    });

    this.input = h('input.field.files-path-input.hidden', {
      type: 'text',
      placeholder: 'Enter folder path…',
       'aria-label': 'Folder path',
    });

    this.el = h('div.files-crumbs-wrap', {
      onclick: (e) => {
        if (e.target === this.el || e.target === this.crumbs.el) {
          this.startEdit();
        }
      },
    }, this.crumbs.el, this.input);

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const val = this.input.value.trim();
        this.stopEdit();
        if (val && this.onNavigate) this.onNavigate(val);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.stopEdit();
      }
    });

    this.input.addEventListener('blur', () => {
      if (this.editing) this.stopEdit();
    });
  }

  startEdit() {
    this.editing = true;
    this.el.classList.add('editing');
    this.crumbs.el.classList.add('hidden');
    this.input.classList.remove('hidden');
    this.input.value = this.currentPath || '';
    this.input.focus();
    if (this.input.select) this.input.select();
  }

  stopEdit() {
    if (!this.editing) return;
    this.editing = false;
    this.el.classList.remove('editing');
    this.input.classList.add('hidden');
    this.crumbs.el.classList.remove('hidden');
  }

  setPath(p) {
    this.currentPath = p || '';
    if (this.editing) {
      this.input.value = this.currentPath;
    }
    if (this.lastRenderedPath === this.currentPath) return;
    this.lastRenderedPath = this.currentPath;
    const segments = this.buildSegments(p);
    this.crumbs.set(segments);
  }

  buildSegments(p) {
    if (!p) return [];
    if (p === TRASH_URI) {
      return [{ label: 'Trash', value: TRASH_URI, icon: 'trash' }];
    }

    const home = homeDir();
    // Check if path is home or inside home (and not a temp fixture outside normal user browsing unless under home)
    const relToHome = home ? path.relative(home, p) : '';
    if (home && (p === home || (relToHome && !relToHome.startsWith('..') && !path.isAbsolute(relToHome)))) {
      const chain = [{ label: 'Home', value: home, icon: 'home' }];
      if (relToHome) {
        let cur = home;
        for (const part of relToHome.split(/[\\/]/).filter(Boolean)) {
          cur = path.join(cur, part);
          chain.push({ label: part, value: cur });
        }
      }
      return chain;
    }

    // Parse root and parts (works on Linux / and Windows C:\)
    const parsed = path.parse(p);
    const root = parsed.root || '/';
    const rootLabel = root.replace(/[\\/]+$/, '') || '/';
    const chain = [{ label: rootLabel, value: root, icon: 'hard-drive' }];

    const rest = p.slice(root.length);
    let cur = root;
    for (const part of rest.split(/[\\/]/).filter(Boolean)) {
      cur = path.join(cur, part);
      chain.push({ label: part, value: cur });
    }
    return chain;
  }
}
