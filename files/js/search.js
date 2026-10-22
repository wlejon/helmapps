/**
 * Search bar (Mod+F):
 *  - Typing filters the current folder immediately by name (using bro.search.fuzzy).
 *  - Pressing Enter searches recursively below the current folder asynchronously
 *    and cancellably, streaming results into the view.
 *  - Pressing Escape clears the search and restores the normal folder listing.
 */

import { h, api } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { kindOf, isHidden } from '/lib/files.js';
import { formatCount } from '/lib/format.js';
import { TRASH_URI, kindLabelOf } from './model.js';

const fs = require('fs');
const path = require('path');

export class SearchController {
  constructor({ state, settings, model, onUpdate, onFocusList }) {
    this.state = state;
    this.settings = settings;
    this.model = model;
    this.onUpdate = onUpdate;
    this.onFocusList = onFocusList;
    this.searchSeq = 0;

    this.input = h('input', {
      type: 'text',
      placeholder: 'Search…',
      'aria-label': 'Search files',
    });

    this.clearBtn = h('button.icon-btn.small.files-search-clear.hidden', {
      'aria-label': 'Clear search',
      'data-tip': 'Clear search',
      onclick: (e) => {
        e.stopPropagation();
        this.clear({ focusList: true });
      },
    }, icon('x', 'sm'));

    this.el = h('div.search-field.files-search',
      icon('search'),
      this.input,
      this.clearBtn,
    );

    this.bannerText = h('span.files-banner-sub.grow', '');
    this.stopBtn = h('button.btn.small', {
      onclick: () => this.clear({ focusList: true }),
    }, 'Clear Search');

    this.bannerEl = h('div.files-banner.hidden',
      icon('search'),
      h('span.files-banner-title', 'Search Results'),
      this.bannerText,
      this.stopBtn,
    );

    this.input.addEventListener('input', () => {
      const q = this.input.value;
      this.clearBtn.classList.toggle('hidden', !q);
      this.onType(q);
    });

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.runRecursiveSearch(this.input.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.clear({ focusList: true });
      }
    });
  }

  focus() {
    this.input.focus();
    if (this.input.select) this.input.select();
  }

  onType(query) {
    // Cancel any ongoing recursive search when typing a new live filter
    this.searchSeq++;
    this.state.searching = false;
    this.state.searchRecursive = false;
    this.model.setRecursiveEntries(null);
    this.bannerEl.classList.add('hidden');
    this.state.filterQuery = query;
    this.model.applyFilterAndSort();
    if (this.onUpdate) this.onUpdate();
  }

  clear({ focusList = false } = {}) {
    this.searchSeq++;
    this.state.searching = false;
    this.state.searchRecursive = false;
    this.model.setRecursiveEntries(null);
    this.state.filterQuery = '';
    this.input.value = '';
    this.clearBtn.classList.add('hidden');
    this.bannerEl.classList.add('hidden');
    this.model.applyFilterAndSort();
    if (this.onUpdate) this.onUpdate();
    if (focusList && this.onFocusList) this.onFocusList();
  }

  /** Run an async, cancellable recursive search below state.currentPath. */
  async runRecursiveSearch(query) {
    const rootDir = this.state.currentPath;
    if (!query || !rootDir || rootDir === TRASH_URI) return;

    const seq = ++this.searchSeq;
    this.state.searchRecursive = true;
    this.state.searching = true;
    this.state.filterQuery = query;
    this.bannerEl.classList.remove('hidden');
    this.bannerText.textContent = `Searching for “${query}” in ${path.basename(rootDir) || rootDir}…`;

    const searchApi = api('search');
    const results = [];

    const matchScore = (name) => {
      if (searchApi && typeof searchApi.fuzzy === 'function') {
        const m = searchApi.fuzzy(query, [name]);
        return m && m.length ? m[0].score : null;
      }
      return name.toLowerCase().includes(query.toLowerCase()) ? 1 : null;
    };

    const flush = () => {
      if (seq !== this.searchSeq) return;
      this.model.setRecursiveEntries(results);
      this.model.applyFilterAndSort();
      const count = this.model.entries.length;
      this.bannerText.textContent = this.state.searching
        ? `Searching for “${query}”… (${formatCount(count, 'match', 'matches')})`
        : `Found ${formatCount(count, 'match', 'matches')} for “${query}”`;
      if (this.onUpdate) this.onUpdate();
    };

    // Walk directory tree asynchronously, streaming matches
    const queue = [{ dir: rootDir, hiddenAncestor: false }];
    let processedSinceFlush = 0;

    while (queue.length > 0 && seq === this.searchSeq) {
      const { dir, hiddenAncestor } = queue.shift();
      let dirents = [];
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      if (seq !== this.searchSeq) return;

      for (const d of dirents) {
        if (!d || !d.name || d.name.startsWith('.brovfs-')) continue;
        const hidden = hiddenAncestor || isHidden(d.name);

        const fullPath = path.join(dir, d.name);
        const isDir = d.isDirectory();
        if (isDir) queue.push({ dir: fullPath, hiddenAncestor: hidden });

        const score = matchScore(d.name);
        if (score !== null) {
          let size = 0;
          let mtime = 0;
          try {
            const st = await fs.promises.stat(fullPath);
            size = isDir ? 0 : (st.size || 0);
            mtime = st.mtimeMs || 0;
          } catch (_) { /* ignore */ }
          if (seq !== this.searchSeq) return;

          const relDir = path.relative(rootDir, dir);
          const uKind = kindOf(d.name, isDir);
          results.push({
            path: fullPath,
            name: d.name,
            nameLower: d.name.toLowerCase(),
            relDir: relDir ? relDir.replace(/\\/g, '/') : '',
            isDirectory: isDir,
            isHidden: hidden,
            size,
            mtime,
            kind: uKind,
            kindLabel: kindLabelOf(d.name, isDir),
            score,
          });
          processedSinceFlush++;
          if (processedSinceFlush >= 25) {
            processedSinceFlush = 0;
            flush();
          }
        }
      }
    }

    if (seq !== this.searchSeq) return;
    this.state.searching = false;
    flush();
  }
}
