/**
 * Grid and List views (VirtualList), lazy thumbnail loader (bro.thumb),
 * view switcher (Segmented), icon size slider (Slider), and item drag-and-drop.
 */

import { h, api, clamp } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { VirtualList, enableItemDrag } from '/lib/list.js';
import { Segmented, Slider } from '/lib/controls.js';
import { formatBytes, formatDate, formatCount } from '/lib/format.js';
import { iconFor } from '/lib/files.js';
import { TRASH_URI } from './model.js';

const PARALLEL_THUMBS = 8;
const THUMB_FAILED = 'failed';

export class ThumbnailCache {
  constructor({ onReady }) {
    this.onReady = onReady;
    this.cache = new Map(); // path -> url | 'failed'
    this.queue = [];
    this.inFlight = 0;
  }

  get thumbApi() {
    return api('thumb');
  }

  get(item) {
    if (!item || item.isDirectory || item.kind !== 'image') return null;
    const p = item.path;
    if (this.cache.has(p)) {
      const v = this.cache.get(p);
      return v === THUMB_FAILED ? null : v;
    }
    if (p.toLowerCase().endsWith('.svg')) {
      this.cache.set(p, p);
      return p;
    }
    const thumb = this.thumbApi;
    if (!thumb || typeof thumb.get !== 'function') {
      return null;
    }
    if (!this.queue.includes(p)) {
      this.queue.push(p);
      this.pump();
    }
    return null;
  }

  invalidate(p) {
    this.cache.delete(p);
    const thumb = this.thumbApi;
    if (thumb && typeof thumb.invalidate === 'function') {
      try { thumb.invalidate(p); } catch (_) { /* ignore */ }
    }
  }

  pump() {
    const thumb = this.thumbApi;
    if (!thumb || typeof thumb.get !== 'function') return;
    while (this.inFlight < PARALLEL_THUMBS && this.queue.length > 0) {
      const p = this.queue.pop();
      if (this.cache.has(p)) continue;
      this.inFlight++;
      thumb.get(p, { size: 'large', priority: 'normal' })
        .then((res) => this.finish(p, this.extractUrl(res)))
        .catch(() => this.finish(p, THUMB_FAILED));
    }
  }

  extractUrl(res) {
    if (!res) return THUMB_FAILED;
    if (res.path) return res.path;
    if (res.pixels && res.width > 0 && res.height > 0) {
      try {
        const c = document.createElement('canvas');
        c.width = res.width;
        c.height = res.height;
        const ctx = c.getContext('2d');
        const imgData = new ImageData(new Uint8ClampedArray(res.pixels.buffer || res.pixels), res.width, res.height);
        ctx.putImageData(imgData, 0, 0);
        return c.toDataURL();
      } catch (_) {
        return THUMB_FAILED;
      }
    }
    return THUMB_FAILED;
  }

  finish(p, url) {
    this.inFlight--;
    this.cache.set(p, url || THUMB_FAILED);
    if (url && url !== THUMB_FAILED && this.onReady) {
      this.onReady(p, url);
    }
    this.pump();
  }
}

export class FilesView {
  constructor({
    state,
    settings,
    onSort,
    onActivate,
    onContextMenu,
    onSelectionChange,
    onViewChange,
    onDropItems,
    onBookmarkFolder,
  }) {
    this.state = state;
    this.settings = settings;
    this.onSort = onSort;
    this.onActivate = onActivate;
    this.onContextMenu = onContextMenu;
    this.onSelectionChange = onSelectionChange;
    this.onViewChange = onViewChange;
    this.onDropItems = onDropItems;
    this.onBookmarkFolder = onBookmarkFolder;

    this.thumbs = new ThumbnailCache({
      onReady: (p, url) => this.updateThumbOnScreen(p, url),
    });

    const initialView = settings.get('view') === 'list' ? 'list' : 'grid';
    const initialSize = clamp(Number(settings.get('iconSize')) || 96, 48, 256);

    this.viewSwitcher = new Segmented({
      options: [
        { value: 'grid', icon: 'grid', title: 'Grid View' },
        { value: 'list', icon: 'list', title: 'List View' },
      ],
      value: initialView,
      onChange: (mode) => {
        this.setViewMode(mode);
        if (this.onViewChange) this.onViewChange(mode);
      },
    });

    this.zoomSlider = new Slider({
      min: 48,
      max: 256,
      step: 16,
      value: initialSize,
      onInput: (val) => this.setIconSize(val, false),
      onChange: (val) => this.setIconSize(val, true),
    });
    this.zoomWrap = h('div.files-zoom-wrap', { 'data-tip': 'Icon Size' },
      icon('image', 'sm'),
      this.zoomSlider.el,
    );

    const { cellWidth, cellHeight } = this.gridDimensions(initialSize);
    this.list = new VirtualList({
      layout: initialView,
      rowHeight: 32,
      cellWidth,
      cellHeight,
      key: (item) => item.path,
      label: (item) => item.name,
      sort: this.state.sort,
      rowClass: (item) => {
        const classes = [];
        if (item.isHidden) classes.push('is-hidden-item');
        if (this.state.clipboard && this.state.clipboard.mode === 'cut' &&
            this.state.clipboard.paths.includes(item.path)) {
          classes.push('is-cut-item');
        }
        return classes.join(' ');
      },
      columns: [
        {
          id: 'name',
          label: 'Name',
          sortable: true,
          minWidth: 180,
          cell: (item) => this.renderNameCell(item),
        },
        {
          id: 'size',
          label: 'Size',
          width: 100,
          align: 'right',
          sortable: true,
          cell: (item) => (item.isDirectory ? '—' : formatBytes(item.size)),
        },
        {
          id: 'mtime',
          label: 'Modified',
          width: 140,
          sortable: true,
          cell: (item) => formatDate(item.deletionTime || item.mtime),
        },
        {
          id: 'kind',
          label: 'Kind',
          width: 130,
          sortable: true,
          cell: (item) => (this.state.currentPath === TRASH_URI && item.originalPath
            ? h('span.ellipsis.dim', item.originalPath)
            : (item.kindLabel || 'File')),
        },
      ],
      columnWidths: settings.get('columns'),
      onColumnResize: (w) => settings.set('columns', w),
      render: (item, el, i) => this.renderGridCell(item, el, i),
      onSort: (id, dir) => {
        if (this.onSort) this.onSort(id, dir);
      },
      onActivate: (items) => {
        if (items && items.length && this.onActivate) this.onActivate(items[0]);
      },
      onContextMenu: (e, items) => {
        if (this.onContextMenu) this.onContextMenu(e, items);
      },
      onSelectionChange: (items) => {
        if (this.onSelectionChange) this.onSelectionChange(items);
      },
      empty: emptyState({
        icon: 'folder',
        title: 'This folder is empty',
        hint: 'Drop files here or use New Folder to add content.',
      }),
    });

    this.el = this.list.el;
    this.setupDragAndDrop();
    this.setViewMode(initialView, { save: false });
  }

  gridDimensions(iconSize) {
    const s = clamp(Number(iconSize) || 96, 48, 256);
    return {
      cellWidth: Math.round(s + 36),
      cellHeight: Math.round(s + 44),
    };
  }

  setViewMode(mode, { save = true } = {}) {
    const view = mode === 'list' ? 'list' : 'grid';
    this.state.view = view;
    if (save) this.settings.set('view', view);
    this.viewSwitcher.set(view);
    this.zoomWrap.classList.toggle('hidden', view !== 'grid');

    const iconSize = clamp(Number(this.settings.get('iconSize')) || 96, 48, 256);
    const { cellWidth, cellHeight } = this.gridDimensions(iconSize);
    this.list.setLayout(view, { cellWidth, cellHeight });
  }

  setIconSize(size, save = true) {
    const s = clamp(Math.round(Number(size) || 96), 48, 256);
    if (save) this.settings.set('iconSize', s);
    this.zoomSlider.set(s);
    if (this.state.view === 'grid') {
      const { cellWidth, cellHeight } = this.gridDimensions(s);
      this.list.setLayout('grid', { cellWidth, cellHeight });
    }
  }

  renderNameCell(item) {
    const ic = icon(item.isDirectory ? 'folder' : iconFor({ name: item.name, isDir: item.isDirectory }));
    if (item.isDirectory) ic.classList.add('folder-icon');
    const children = [ic, h('span.ellipsis', item.name)];
    if (item.relDir) {
      children.push(h('span.files-rel-hint', item.relDir));
    } else if (this.state.currentPath === TRASH_URI && item.originalPath) {
      children.push(h('span.files-rel-hint', item.originalPath));
    }
    return h('div.col-name-wrap', ...children);
  }

  renderGridCell(item, el) {
    el.dataset.path = item.path;
    const thumbBox = h('div.files-grid-thumb');
    if (item.isDirectory) thumbBox.classList.add('is-folder');

    const url = this.thumbs.get(item);
    if (url) {
      thumbBox.appendChild(h('img', { src: url, alt: item.name, draggable: 'false' }));
    } else {
      thumbBox.appendChild(icon(item.isDirectory ? 'folder' : iconFor({ name: item.name, isDir: item.isDirectory }), 'lg'));
    }

    const nameEl = h('div.files-grid-name', { title: item.name }, item.name);
    el.replaceChildren(thumbBox, nameEl);
  }

  updateThumbOnScreen(filePath, url) {
    if (this.state.view !== 'grid') return;
    for (const el of this.list.pool.values()) {
      if (el._item && el._item.path === filePath) {
        const box = el.querySelector('.files-grid-thumb');
        if (box) {
          box.replaceChildren(h('img', { src: url, alt: el._item.name, draggable: 'false' }));
        }
      }
    }
  }

  setupDragAndDrop() {
    // External files dropped from OS / another app
    this.list.scroller.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    this.list.scroller.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      const paths = [];
      for (const f of Array.from(e.dataTransfer.files)) {
        if (f && f.path) paths.push(f.path);
      }
      if (paths.length && this.onDropItems && this.state.currentPath && this.state.currentPath !== TRASH_URI) {
        this.onDropItems(paths, this.state.currentPath, { copy: true });
      }
    });

    // Pointer-based drag and drop of items onto folders or sidebar via kit helper
    enableItemDrag(this.list, {
      canDrag: () => this.state.currentPath !== TRASH_URI,
      ghost: (items) => {
        const label = items.length === 1 ? items[0].name : formatCount(items.length, 'item');
        return [icon(items[0].isDirectory ? 'folder' : 'file', 'sm'), h('span', label)];
      },
      findTarget: (el, draggedItems) => {
        const sideRow = el.closest('.sidebar-item[data-drop-path]');
        if (sideRow) {
          return { el: sideRow, path: sideRow.dataset.dropPath, kind: 'sidebar-item' };
        }
        const sideNav = el.closest('.sidebar');
        if (sideNav && draggedItems.length === 1 && draggedItems[0].isDirectory) {
          return { el: sideNav, path: draggedItems[0].path, kind: 'bookmark' };
        }
        const itemEl = el.closest('.vlist-row, .vgrid-cell');
        if (itemEl && itemEl._item && itemEl._item.isDirectory) {
          const folderPath = itemEl._item.path;
          if (!draggedItems.some((d) => d.path === folderPath)) {
            return { el: itemEl, path: folderPath, kind: 'folder' };
          }
        }
        return null;
      },
      onDrop: (draggedItems, target, ev) => {
        if (target.kind === 'bookmark') {
          if (this.onBookmarkFolder) this.onBookmarkFolder(draggedItems[0].path, draggedItems[0].name);
        } else if (target.path && this.onDropItems) {
          const srcPaths = draggedItems.map((d) => d.path);
          this.onDropItems(srcPaths, target.path, { copy: ev.ctrlKey || ev.metaKey });
        }
      },
    });
  }
}
