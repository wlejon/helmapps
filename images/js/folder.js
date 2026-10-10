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
import { isImage, sortNames } from './formats.js';

const fs = require('fs');
const path = require('path');

/** How long a burst of file events settles before the folder is re-read. */
const SETTLE_MS = 150;

export class Folder {
  constructor({ onChange } = {}) {
    this.onChange = onChange;
    this.dir = '';
    this.items = [];
    this.index = new Map();      // path -> position
    this.loading = null;
    this.error = '';
    this.watcher = null;
    this.version = 0;
    this.relist = debounce(() => this.reload(), SETTLE_MS);
  }

  /** Read `dir` (and watch it). Resolves when the list is in. */
  async load(dir) {
    if (dir === this.dir && this.loading) return this.loading;
    if (dir !== this.dir) {
      this.unwatch();
      this.dir = dir;
      this.items = [];
      this.index.clear();
      this.watch();
    }
    this.loading = this.read(dir);
    return this.loading;
  }

  /** Read the folder again (after a rename, a trash, a file event). */
  reload() {
    if (!this.dir) return Promise.resolve();
    this.loading = this.read(this.dir);
    return this.loading;
  }

  async read(dir) {
    let names = [];
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      names = entries.filter((e) => !e.isDirectory() && isImage(e.name)).map((e) => e.name);
      this.error = '';
    } catch (err) {
      this.error = err.message;
    }
    if (dir !== this.dir) return;               // another folder took over meanwhile
    names = sortNames(names);
    // dir is already resolved, so a plain join gives what path.join would
    // (which costs ~15 µs a name, 6 ms for a folder of 400).
    const base = dir.endsWith(path.sep) || dir.endsWith('/') ? dir : dir + path.sep;
    const items = names.map((name) => ({ name, path: base + name }));
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
      this.watcher = vfs.watch(this.dir, () => this.relist(), { recursive: false });
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
