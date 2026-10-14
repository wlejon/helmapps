/**
 * Sidebar with Places, Drives (with free space meter & tooltip), and Bookmarks.
 * Supports context menus on bookmarks and drop targets for moving/copying items
 * or adding folder bookmarks.
 */

import { api } from '/lib/dom.js';
import { Sidebar } from '/lib/layout.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { formatBytes } from '/lib/format.js';
import { userDirs } from '/lib/files.js';
import { TRASH_URI, normalizePath } from './model.js';

const fs = require('fs');
const path = require('path');

async function isDirAsync(p) {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch (_) {
    return false;
  }
}

export class FilesSidebar {
  constructor({ state, settings, onSelect, onDropItems }) {
    this.state = state;
    this.settings = settings;
    this.onSelect = onSelect;
    this.onDropItems = onDropItems;

    this.places = [];
    this.drives = [];

    this.sidebar = new Sidebar({
      onSelect: (item) => {
        if (this.onSelect) this.onSelect(item.id);
      },
      onContextMenu: (e, item) => this.showContextMenu(e, item),
    });

    this.el = this.sidebar.el;
    this.draw();
  }

  get vfs() {
    if (this.state.disableVfs) return null;
    return this.state.customVfs || api('vfs');
  }

  bookmarks() {
    const list = this.settings.get('bookmarks');
    return Array.isArray(list) ? list : [];
  }

  isBookmarked(p) {
    if (!p || p === TRASH_URI) return false;
    const norm = normalizePath(p);
    return this.bookmarks().some((b) => normalizePath(b.path) === norm);
  }

  toggleBookmark(p, label) {
    if (!p || p === TRASH_URI) return;
    const norm = normalizePath(p);
    const list = this.bookmarks().slice();
    const idx = list.findIndex((b) => normalizePath(b.path) === norm);
    if (idx >= 0) {
      const removed = list.splice(idx, 1)[0];
      this.settings.set('bookmarks', list);
      this.draw();
      toast(`Removed bookmark “${removed.label || path.basename(norm)}”`);
    } else {
      const name = label || path.basename(norm) || norm;
      list.push({ path: norm, label: name });
      this.settings.set('bookmarks', list);
      this.draw();
      toast(`Bookmarked “${name}”`, { icon: 'star' });
    }
  }

  removeBookmark(p) {
    const norm = normalizePath(p);
    const list = this.bookmarks().filter((b) => normalizePath(b.path) !== norm);
    this.settings.set('bookmarks', list);
    this.draw();
  }

  showContextMenu(e, item) {
    const items = [
      { label: 'Open', icon: 'folder-open', action: () => this.onSelect && this.onSelect(item.id) },
    ];
    if (item.data && item.data.isBookmark) {
      items.push(
        { separator: true },
        { label: 'Remove Bookmark', icon: 'trash', danger: true, action: () => this.removeBookmark(item.id) },
      );
    }
    menu.show(items, e.clientX, e.clientY);
  }

  draw() {
    const sections = [];
    if (this.places.length) {
      sections.push({ title: 'Places', items: this.places });
    } else {
      sections.push({
        title: 'Places',
        items: [{ id: TRASH_URI, label: 'Trash', icon: 'trash' }],
      });
    }

    if (this.drives.length) {
      sections.push({ title: 'Drives', items: this.drives });
    }

    const bms = this.bookmarks();
    if (bms.length) {
      sections.push({
        title: 'Bookmarks',
        items: bms.map((b) => ({
          id: b.path,
          label: b.label || path.basename(b.path) || b.path,
          icon: 'star',
          title: b.path,
          data: { isBookmark: true },
        })),
      });
    }

    this.sidebar.setSections(sections);
    for (const [id, row] of this.sidebar.rows) {
      row.dataset.dropPath = id;
    }
    if (this.state.currentPath) {
      this.sidebar.select(this.state.currentPath);
    }
  }

  select(id) {
    this.sidebar.select(id);
  }

  async fillPlaces() {
    const d = userDirs();
    const candidates = [
      { id: d.home, label: 'Home', icon: 'home' },
      { id: d.desktop, label: 'Desktop', icon: 'monitor' },
      { id: d.documents, label: 'Documents', icon: 'file-text' },
      { id: d.downloads, label: 'Downloads', icon: 'download' },
      { id: d.pictures, label: 'Pictures', icon: 'image' },
      { id: d.music, label: 'Music', icon: 'music' },
      { id: d.videos, label: 'Videos', icon: 'video' },
    ];
    const checks = await Promise.all(candidates.map((c) => isDirAsync(c.id)));
    this.places = candidates.filter((_, i) => checks[i]).map((c) => ({
      ...c,
      id: normalizePath(c.id),
      title: c.id,
    }));
    this.places.push({
      id: TRASH_URI,
      label: 'Trash',
      icon: 'trash',
      title: 'Trash',
    });
    this.draw();
  }

  async fillDrives() {
    const vfs = this.vfs;
    if (!vfs || typeof vfs.volumes !== 'function') return;
    let volumes = [];
    try {
      volumes = await vfs.volumes();
    } catch (_) {
      return;
    }
    this.state.volumes = (volumes || []).filter((v) => v.mountPoint && v.totalBytes > 0 &&
      !/^\/(proc|sys|dev|run|snap)(\/|$)/.test(v.mountPoint));
    this.drives = this.state.volumes.map((v) => {
      const mount = normalizePath(v.mountPoint);
      const label = v.volumeLabel
        ? `${v.volumeLabel} (${v.mountPoint.replace(/[\\/]$/, '')})`
        : v.mountPoint;
      const freeText = `${formatBytes(v.availableBytes)} free of ${formatBytes(v.totalBytes)}`;
      const usedFraction = v.totalBytes > 0 ? 1 - v.availableBytes / v.totalBytes : 0;
      return {
        id: mount,
        label,
        icon: v.isRemovable ? 'usb' : 'hard-drive',
        sub: freeText,
        meter: usedFraction,
        title: `${label} — ${freeText}`,
      };
    });
    this.draw();
  }
}
