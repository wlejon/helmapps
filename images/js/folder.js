/**
 * The folder an image lives in: its images in name order, kept current while
 * files come and go (bro.vfs.watch, where bro.vfs exists).
 *
 *   const folder = new Folder({ onChange: (folder) => redraw() });
 *   await folder.load('/home/j/Pictures');
 *   folder.items                  [{ name, path }] in name order
 *   folder.indexOf(path)          -1 when it is not (or no longer) there
 *
 * Listing is one fs.promises.readdir: it runs on brokit's I/O threads, so a
 * folder of thousands of photos never stalls a frame. Only names are held.
 */

import { api, debounce } from '/lib/dom.js';
import { isImage, nameKey } from './formats.js';

const fs = require('fs');
const path = require('path');

/** How long a burst of file events settles before the folder is re-read. */
const SETTLE_MS = 150;
const MAX_DEPTH = 8;

function sortItems(collected) {
  const keyed = collected.map((it) => ({ it, k: nameKey(it.rel) }));
  keyed.sort((x, y) => (x.k !== y.k ? (x.k < y.k ? -1 : 1) : (x.it.rel < y.it.rel ? -1 : x.it.rel > y.it.rel ? 1 : 0)));
  return keyed.map((x) => x.it);
}

export class Folder {
  constructor({ onChange, onWatch } = {}) {
    this.onChange = onChange;
    this.onWatch = onWatch;     // after a file event's re-read, changed list or not (a file rewritten in place)
    this.dir = '';
    this.recursive = false;
    this.items = [];
    this.index = new Map();      // path -> position
    this.loading = null;
    this.error = '';
    this.watcher = null;
    this.version = 0;
    this.relist = debounce(() => this.reload().then(() => { if (this.onWatch) this.onWatch(this); }), SETTLE_MS);
  }

  /** Read `dir` (and watch it). Resolves when the list is in. */
  async load(dir, { recursive = false } = {}) {
    const rec = !!recursive;
    if (dir === this.dir && rec === this.recursive && this.loading) return this.loading;
    if (dir !== this.dir || rec !== this.recursive) {
      this.unwatch();
      this.dir = dir;
      this.recursive = rec;
      this.items = [];
      this.index.clear();
      this.watch();
    }
    this.loading = this.read(dir, rec);
    return this.loading;
  }

  /** Read the folder again (after a rename, a trash, a file event). */
  reload() {
    if (!this.dir) return Promise.resolve();
    this.loading = this.read(this.dir, this.recursive);
    return this.loading;
  }

  async read(dir, recursive = false) {
    const collected = [];
    const walk = async (curDir, relDir, depth) => {
      let entries;
      try {
        entries = await fs.promises.readdir(curDir, { withFileTypes: true });
      } catch (err) {
        if (depth === 0) this.error = err.message;
        return;
      }
      if (dir !== this.dir || recursive !== this.recursive) return;
      if (depth === 0) this.error = '';
      const subdirs = [];
      for (const e of entries) {
        if (e.isDirectory()) {
          if (recursive && depth < MAX_DEPTH && !e.name.startsWith('.')) {
            subdirs.push({
              dir: path.join(curDir, e.name),
              rel: relDir ? `${relDir}/${e.name}` : e.name,
            });
          }
        } else if (isImage(e.name)) {
          collected.push({
            name: e.name,
            rel: relDir ? `${relDir}/${e.name}` : e.name,
            path: path.join(curDir, e.name),
          });
        }
      }
      for (const sub of subdirs) {
        if (dir !== this.dir || recursive !== this.recursive) return;
        await walk(sub.dir, sub.rel, depth + 1);
      }
    };
    await walk(dir, '', 0);
    if (dir !== this.dir || recursive !== this.recursive) return; // another folder took over meanwhile
    const items = sortItems(collected);
    const same = items.length === this.items.length && items.every((it, i) => it.path === this.items[i].path);
    this.loading = null;
    if (same) return;
    this.items = items;
    this.index = new Map(items.map((it, i) => [it.path, i]));
    this.version++;
    if (this.onChange) this.onChange(this);
  }

  indexOf(p) {
    const i = this.index.get(p);
    return i == null ? -1 : i;
  }

  get watching() {
    return !!this.watcher;
  }

  watch() {
    const vfs = api('vfs');
    if (!vfs || typeof vfs.watch !== 'function' || !this.dir) return;
    try {
      this.watcher = vfs.watch(this.dir, () => this.relist(), { recursive: this.recursive });
    } catch (err) {
      console.warn(`watch ${this.dir}: ${err.message}`);
      this.watcher = null;
    }
  }

  unwatch() {
    this.relist.cancel();
    if (this.watcher && typeof this.watcher.unwatch === 'function') this.watcher.unwatch();
    this.watcher = null;
  }
}
