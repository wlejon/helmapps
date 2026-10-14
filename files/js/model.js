/**
 * Directory model, navigation history, per-folder sorting, live filtering,
 * and filesystem watching (with fs.promises fallback when bro.vfs is missing
 * or disabled).
 */

import { api, debounce } from '/lib/dom.js';
import { kindOf, isHidden } from '/lib/files.js';

const fs = require('fs');
const path = require('path');

export const TRASH_URI = 'trash://';
const MAX_SORT_FOLDERS = 500;

const KIND_LABELS = {
  folder: 'Folder',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  archive: 'Archive',
  code: 'Source Code',
  text: 'Text Document',
  document: 'Document',
  font: 'Font',
  model: '3D Model',
  file: 'File',
};

export function kindLabelOf(name, isDir) {
  return KIND_LABELS[kindOf(name, isDir)] || 'File';
}

export function normalizePath(p) {
  if (!p) return '';
  if (p === TRASH_URI || p.startsWith('trash:')) return TRASH_URI;
  return path.resolve(p);
}

export class DirectoryModel {
  constructor({ state, settings, trash, onChange, onError }) {
    this.state = state;
    this.settings = settings;
    this.trash = trash;
    this.onChange = onChange;
    this.onError = onError;

    this.rawEntries = [];
    this.entries = [];
    this.watcher = null;
    this.loadSeq = 0;
    this.openSeq = 0;

    this.debouncedReload = debounce(() => {
      if (this.state.currentPath && this.state.currentPath !== TRASH_URI && !this.state.searchRecursive) {
        this.reload({ preserveSelection: true });
      }
    }, 60);
  }

  get vfs() {
    if (this.state.disableVfs) return null;
    return this.state.customVfs || api('vfs');
  }

  canBack() {
    return this.state.backStack.length > 0;
  }

  canForward() {
    return this.state.forwardStack.length > 0;
  }

  canUp() {
    const p = this.state.currentPath;
    if (!p || p === TRASH_URI) return false;
    const parent = path.dirname(p);
    return parent && parent !== p;
  }

  async back() {
    if (!this.canBack()) return false;
    const prev = this.state.backStack.pop();
    if (this.state.currentPath) this.state.forwardStack.push(this.state.currentPath);
    await this.openPath(prev, { push: false });
    return true;
  }

  async forward() {
    if (!this.canForward()) return false;
    const next = this.state.forwardStack.pop();
    if (this.state.currentPath) this.state.backStack.push(this.state.currentPath);
    await this.openPath(next, { push: false });
    return true;
  }

  async up() {
    if (!this.canUp()) return false;
    const parent = path.dirname(this.state.currentPath);
    await this.openPath(parent, { push: true });
    return true;
  }

  /** Restore per-folder sort (and optional view) from settings. */
  restoreFolderPrefs(dirPath) {
    if (dirPath === TRASH_URI) {
      this.state.sort = { id: 'mtime', dir: -1 };
      return;
    }
    const map = this.settings.get('sortByFolder') || {};
    const saved = map[dirPath];
    if (saved && saved.id) {
      this.state.sort = { id: saved.id, dir: saved.dir === -1 ? -1 : 1 };
    } else {
      this.state.sort = { id: 'name', dir: 1 };
    }
  }

  /** Save sort order for the current folder (capped at 500 folders). */
  saveFolderSort(id, dir) {
    this.state.sort = { id, dir };
    const dirPath = this.state.currentPath;
    if (dirPath && dirPath !== TRASH_URI) {
      const oldMap = this.settings.get('sortByFolder') || {};
      const keys = Object.keys(oldMap).filter((k) => k !== dirPath);
      while (keys.length >= MAX_SORT_FOLDERS) keys.shift();
      const nextMap = {};
      for (const k of keys) nextMap[k] = oldMap[k];
      nextMap[dirPath] = { id, dir };
      this.settings.set('sortByFolder', nextMap);
    }
    this.applyFilterAndSort();
    if (this.onChange) this.onChange({ sorted: true });
  }

  /** Open a directory path (or trash://). If given a file path, opens its parent and selects the file. */
  async openPath(target, { push = true, select = null, quiet = false } = {}) {
    if (!target) return false;
    const myOpen = ++this.openSeq;
    const norm = normalizePath(target);

    if (norm !== TRASH_URI) {
      try {
        const st = await fs.promises.stat(norm);
        if (myOpen !== this.openSeq) return false;
        if (!st.isDirectory()) {
          const parent = path.dirname(norm);
          return this.openPath(parent, { push, select: norm, quiet });
        }
      } catch (err) {
        if (myOpen !== this.openSeq) return false;
        if (!quiet && this.onError) this.onError(`Folder not found: ${norm}`);
        return false;
      }
    }

    const prevPath = this.state.currentPath;
    if (push && prevPath && prevPath !== norm) {
      this.state.backStack.push(prevPath);
      this.state.forwardStack = [];
    }

    this.state.currentPath = norm;
    this.state.done = false;
    this.state.filterQuery = '';
    this.state.searchRecursive = false;
    if (norm !== TRASH_URI) {
      this.settings.set('lastFolder', norm);
    }

    this.restoreFolderPrefs(norm);
    this.setupWatch(norm);

    const ok = await this.reload({ select });
    return ok;
  }

  setupWatch(dirPath) {
    this.stopWatch();
    if (!dirPath || dirPath === TRASH_URI) return;
    const vfs = this.vfs;
    if (!vfs || typeof vfs.watch !== 'function') return;
    try {
      this.watcher = vfs.watch(dirPath, (events) => {
        if (!Array.isArray(events)) {
          this.debouncedReload();
          return;
        }
        // Ignore temporary internal vfs copy files until renamed
        const meaningful = events.some((ev) => {
          const p = ev && ev.path ? path.basename(ev.path) : '';
          return !p.startsWith('.brovfs-');
        });
        if (meaningful) this.debouncedReload();
      }, { recursive: false });
    } catch (_) {
      this.watcher = null;
    }
  }

  stopWatch() {
    this.debouncedReload.cancel();
    if (this.watcher) {
      try {
        if (typeof this.watcher.unwatch === 'function') this.watcher.unwatch();
        else if (typeof this.watcher.close === 'function') this.watcher.close();
      } catch (_) { /* ignore */ }
      this.watcher = null;
    }
  }

  /** Reload the current directory from disk or trash. */
  async reload({ select = null, preserveSelection = false } = {}) {
    const seq = ++this.loadSeq;
    const dirPath = this.state.currentPath;
    if (!dirPath) return false;

    this.state.loading = true;
    this.state.done = false;

    try {
      let raw = [];
      if (dirPath === TRASH_URI) {
        raw = await this.trash.loadEntries();
      } else {
        raw = await this.scanDirectory(dirPath);
      }
      if (seq !== this.loadSeq) return false;
      this.rawEntries = raw;
      this.applyFilterAndSort();
      this.state.loading = false;
      this.state.done = true;
      if (this.onChange) this.onChange({ select, preserveSelection, reloaded: true });
      return true;
    } catch (err) {
      if (seq !== this.loadSeq) return false;
      this.rawEntries = [];
      this.entries = [];
      this.state.loading = false;
      this.state.done = true;
      if (this.onError) this.onError(err.message || String(err));
      if (this.onChange) this.onChange({ reloaded: true });
      return false;
    }
  }

  async scanDirectory(dirPath) {
    const vfs = this.vfs;
    const prefix = dirPath.endsWith(path.sep) ? dirPath : dirPath + path.sep;
    if (vfs && typeof vfs.scan === 'function') {
      const items = await vfs.scan(dirPath, { recursive: false, includeHidden: true });
      if (items && items.length > 500) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      const out = [];
      for (const it of items || []) {
        if (!it || !it.name || it.name.startsWith('.brovfs-')) continue;
        const fullPath = prefix + it.name;
        const isDir = !!it.isDirectory;
        const uKind = kindOf(it.name, isDir);
        out.push({
          path: fullPath,
          name: it.name,
          nameLower: it.name.toLowerCase(),
          isDirectory: isDir,
          isRegular: !isDir && !it.isLink,
          isLink: !!it.isLink,
          isHidden: !!(it.isHidden || isHidden(it.name)),
          size: isDir ? 0 : (Number(it.size) || 0),
          mtime: Number(it.mtime) || 0,
          birthtime: Number(it.birthtime) || 0,
          kind: uKind,
          kindLabel: KIND_LABELS[uKind] || 'File',
        });
      }
      return out;
    }

    // Fallback: fs.promises.readdir + stat
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const out = await Promise.all(dirents.map(async (d) => {
      if (!d || !d.name || d.name.startsWith('.brovfs-')) return null;
      const fullPath = path.join(dirPath, d.name);
      let isDir = d.isDirectory();
      let isLink = d.isSymbolicLink();
      let size = 0;
      let mtime = 0;
      let birthtime = 0;
      try {
        const st = await fs.promises.stat(fullPath);
        isDir = st.isDirectory();
        size = isDir ? 0 : (st.size || 0);
        mtime = st.mtimeMs || 0;
        birthtime = st.birthtimeMs || 0;
      } catch (_) { /* broken symlink or permission denied */ }
      const uKind = kindOf(d.name, isDir);
      return {
        path: fullPath,
        name: d.name,
        nameLower: d.name.toLowerCase(),
        isDirectory: isDir,
        isRegular: !isDir && !isLink,
        isLink,
        isHidden: isHidden(d.name),
        size,
        mtime,
        birthtime,
        kind: uKind,
        kindLabel: KIND_LABELS[uKind] || 'File',
      };
    }));
    return out.filter(Boolean);
  }

  applyFilterAndSort() {
    const showHidden = this.settings.get('showHidden');
    const isTrash = this.state.currentPath === TRASH_URI;

    let visible = isTrash
      ? this.rawEntries.slice()
      : this.rawEntries.filter((e) => showHidden || !e.isHidden);

    const q = (this.state.filterQuery || '').trim();
    if (q) {
      const searchApi = api('search');
      if (searchApi && typeof searchApi.fuzzy === 'function') {
        const matches = searchApi.fuzzy(q, visible, { key: (e) => e.name });
        visible = matches.map((m) => m.item);
      } else {
        const lower = q.toLowerCase();
        visible = visible.filter((e) => (e.nameLower || e.name.toLowerCase()).includes(lower));
      }
    }

    this.entries = this.sortList(visible);
  }

  sortList(list) {
    const { id, dir } = this.state.sort || { id: 'name', dir: 1 };
    const copy = list.slice();
    const cmpName = (a, b) => {
      const na = a.nameLower || a.name.toLowerCase();
      const nb = b.nameLower || b.name.toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    };
    copy.sort((a, b) => {
      // Folders always sort before files!
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      let cmp = 0;
      if (id === 'size') {
        cmp = (a.size || 0) - (b.size || 0);
      } else if (id === 'mtime') {
        cmp = (a.mtime || 0) - (b.mtime || 0);
      } else if (id === 'kind') {
        const ka = a.kindLabel || '';
        const kb = b.kindLabel || '';
        cmp = ka < kb ? -1 : (ka > kb ? 1 : 0);
      } else if (id === 'originalPath') {
        const oa = a.originalPath || '';
        const ob = b.originalPath || '';
        cmp = oa < ob ? -1 : (oa > ob ? 1 : 0);
      } else if (id === 'deletionTime') {
        cmp = (a.deletionTime || 0) - (b.deletionTime || 0);
      } else {
        cmp = cmpName(a, b);
      }
      if (cmp !== 0) return cmp * dir;
      return cmpName(a, b);
    });
    return copy;
  }
}
