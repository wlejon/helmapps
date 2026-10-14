/**
 * Properties dialog (Alt+Enter) showing Name, Kind, MIME type, Size (computed
 * asynchronously for folders via bro.vfs.usage or async walk), Location,
 * Modified time, and thumbnail/icon preview.
 */

import { h, api } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Dialog } from '/lib/dialog.js';
import { formatBytes, formatNumber, formatCount, formatDateLong } from '/lib/format.js';
import { mimeOf, iconFor } from '/lib/files.js';
import { TRASH_URI, kindLabelOf } from './model.js';

const fs = require('fs');
const path = require('path');

export class Inspector {
  constructor({ state, thumbs }) {
    this.state = state;
    this.thumbs = thumbs;
  }

  get vfs() {
    if (this.state.disableVfs) return null;
    return this.state.customVfs || api('vfs');
  }

  async showProperties(items) {
    let targetItems = items && items.length ? items : [];
    if (!targetItems.length) {
      const cur = this.state.currentPath;
      if (!cur || cur === TRASH_URI) return;
      try {
        const st = await fs.promises.stat(cur);
        targetItems = [{
          path: cur,
          name: path.basename(cur) || cur,
          isDirectory: st.isDirectory(),
          size: st.size || 0,
          mtime: st.mtimeMs || 0,
          birthtime: st.birthtimeMs || 0,
          kindLabel: 'Folder',
        }];
      } catch (_) {
        return;
      }
    }

    const single = targetItems.length === 1 ? targetItems[0] : null;
    const title = single ? `${single.name} Properties` : `${formatCount(targetItems.length, 'item')} Properties`;
    const d = new Dialog({ title, icon: 'info', wide: true });

    const previewBox = h('div.files-props-preview');
    if (single) {
      const url = this.thumbs ? this.thumbs.get(single) : null;
      if (url) {
        previewBox.appendChild(h('img', { src: url, alt: single.name }));
      } else {
        previewBox.appendChild(icon(single.isDirectory ? 'folder' : iconFor({ name: single.name, isDir: single.isDirectory }), 'lg'));
      }
    } else {
      previewBox.appendChild(icon('layers', 'lg'));
    }

    const headTitle = single ? single.name : formatCount(targetItems.length, 'item');
    const headSub = single
      ? (single.kindLabel || kindLabelOf(single.name, single.isDirectory))
      : 'Multiple selection';

    const head = h('div.files-props-head',
      previewBox,
      h('div',
        h('div.title.selectable', headTitle),
        h('div.dim', headSub)));

    const sizeVal = h('div.files-props-val.num.selectable', 'Calculating…');
    const grid = h('div.files-props-grid');
    const addRow = (label, valNode) => {
      grid.append(
        h('div.files-props-label', label),
        typeof valNode === 'string' ? h('div.files-props-val.selectable', valNode) : valNode,
      );
    };

    if (single) {
      addRow('Kind', single.kindLabel || kindLabelOf(single.name, single.isDirectory));
      if (!single.path.startsWith('trash://')) {
        addRow('MIME Type', mimeOf(single.path, single.isDirectory));
      }
      addRow('Size', sizeVal);
      if (single.originalPath) {
        addRow('Original Location', single.originalPath);
      } else {
        addRow('Location', path.dirname(single.path));
      }
      if (single.mtime) {
        addRow('Modified', formatDateLong(single.mtime));
      }
      if (single.birthtime) {
        addRow('Created', formatDateLong(single.birthtime));
      }
    } else {
      addRow('Items', formatCount(targetItems.length, 'item'));
      addRow('Total Size', sizeVal);
      addRow('Location', path.dirname(targetItems[0].path));
    }

    d.body.append(head, grid);
    d.addButton('Close', { primary: true, value: true });

    let cancelled = false;
    let activeScan = null;

    if (single && !single.isDirectory) {
      const bytes = single.size || 0;
      sizeVal.textContent = `${formatBytes(bytes)} (${formatNumber(bytes)} bytes)`;
    } else {
      this.computeSizeLive(targetItems, sizeVal, () => cancelled, (scan) => { activeScan = scan; });
    }

    await d.open();
    cancelled = true;
    if (activeScan && typeof activeScan.cancel === 'function') {
      try { activeScan.cancel(); } catch (_) { /* ignore */ }
    }
  }

  async computeSizeLive(items, sizeEl, isCancelled, onScanCreated) {
    const vfs = this.vfs;
    if (items.length === 1 && items[0].isDirectory && !items[0].path.startsWith('trash://') &&
        vfs && typeof vfs.usage === 'function') {
      try {
        const scan = vfs.usage(items[0].path, { includeHidden: true });
        if (onScanCreated) onScanCreated(scan);
        const tick = () => {
          if (isCancelled()) return;
          const p = scan.progress();
          sizeEl.textContent = `${formatBytes(p.bytes)} (${formatNumber(p.bytes)} bytes) — ${formatCount(p.files, 'file')}, ${formatCount(p.directories, 'folder')}` +
            (p.finished ? '' : ' (counting…)');
          if (!p.finished && !p.cancelled) {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
        return;
      } catch (_) { /* fall back to async walk */ }
    }

    // Fallback async directory walk
    let totalBytes = 0;
    let totalFiles = 0;
    let totalDirs = 0;

    const walk = async (p) => {
      if (isCancelled()) return;
      try {
        const st = await fs.promises.lstat(p);
        if (st.isDirectory()) {
          totalDirs++;
          const children = await fs.promises.readdir(p);
          for (const c of children) {
            if (isCancelled()) return;
            await walk(path.join(p, c));
          }
        } else {
          totalFiles++;
          totalBytes += st.size || 0;
        }
        if (!isCancelled()) {
          sizeEl.textContent = `${formatBytes(totalBytes)} (${formatNumber(totalBytes)} bytes) — ${formatCount(totalFiles, 'file')}`;
        }
      } catch (_) { /* ignore */ }
    };

    for (const it of items) {
      if (isCancelled()) return;
      if (it.isDirectory && !it.path.startsWith('trash://')) {
        await walk(it.path);
      } else {
        totalFiles++;
        totalBytes += it.size || 0;
      }
    }
    if (!isCancelled()) {
      sizeEl.textContent = `${formatBytes(totalBytes)} (${formatNumber(totalBytes)} bytes)` +
        (totalDirs > 0 ? ` — ${formatCount(totalFiles, 'file')}, ${formatCount(totalDirs, 'folder')}` : '');
    }
  }
}
