/**
 * Trash view and trash operations (bro.vfs.trash, listTrash, restoreTrash, emptyTrash).
 * Supports injecting an isolated mock trash provider for headless tests so the
 * host OS Recycle Bin / user Trash is never touched during tests.
 */

import { h, api } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { confirmDialog, alertDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { formatCount } from '/lib/format.js';
import { kindOf } from '/lib/files.js';
import { kindLabelOf } from './model.js';

const fs = require('fs');
const path = require('path');

export class TrashManager {
  constructor({ state, onChanged }) {
    this.state = state;
    this.onChanged = onChanged;
    this.provider = null; // optional custom/mock provider for tests

    this.restoreBtn = h('button.btn.small', {
      onclick: () => this.restoreSelected(),
    }, icon('undo'), 'Restore');

    this.emptyBtn = h('button.btn.danger.small', {
      onclick: () => this.emptyTrash(),
    }, icon('trash'), 'Empty Trash…');

    this.bannerEl = h('div.files-banner.hidden',
      icon('trash'),
      h('span.files-banner-title', 'Trash'),
      h('span.files-banner-sub.grow', 'Items here can be restored to their original location or permanently deleted.'),
      this.restoreBtn,
      this.emptyBtn,
    );
  }

  get activeBackend() {
    if (this.provider) return this.provider;
    if (this.state.disableVfs) return null;
    return this.state.customVfs || api('vfs');
  }

  /** Set a custom trash provider (or null to use bro.vfs). */
  setProvider(provider) {
    this.provider = provider;
  }

  /**
   * Create a fixture-backed isolated trash provider for headless tests,
   * storing trashed files inside `trashDir` without touching the OS trash.
   */
  createMockProvider(trashDir) {
    fs.mkdirSync(trashDir, { recursive: true });
    let seq = 0;
    const items = new Map(); // id -> { id, name, originalPath, trashPath, deletionTime, size, isDirectory }

    const provider = {
      trash: async (filePath) => {
        const st = await fs.promises.stat(filePath);
        const id = `trash-${++seq}-${ path.basename(filePath) }`;
        const trashPath = path.join(trashDir, id);
        await fs.promises.rename(filePath, trashPath);
        const rec = {
          id,
          name: path.basename(filePath),
          originalPath: filePath,
          trashPath,
          deletionTime: Date.now(),
          deletionDate: new Date().toISOString(),
          size: st.isDirectory() ? 0 : st.size,
          isDirectory: st.isDirectory(),
        };
        items.set(id, rec);
        return rec;
      },
      listTrash: async () => Array.from(items.values()),
      restoreTrash: async (id) => {
        const rec = items.get(id);
        if (!rec) throw new Error(`Trash item not found: ${id}`);
        await fs.promises.mkdir(path.dirname(rec.originalPath), { recursive: true });
        await fs.promises.rename(rec.trashPath, rec.originalPath);
        items.delete(id);
        return true;
      },
      emptyTrash: async () => {
        for (const rec of items.values()) {
          await fs.promises.rm(rec.trashPath, { recursive: true, force: true });
        }
        items.clear();
        return true;
      },
    };
    this.provider = provider;
    return provider;
  }

  updateBanner(isTrashView, selectedItems = []) {
    this.bannerEl.classList.toggle('hidden', !isTrashView);
    if (!isTrashView) return;
    const hasBackend = !!this.activeBackend;
    this.restoreBtn.disabled = !hasBackend || selectedItems.length === 0;
    this.emptyBtn.disabled = !hasBackend || (this.state.TrashCount === 0);
  }

  async loadEntries() {
    const backend = this.activeBackend;
    if (!backend) return [];
    const listFn = backend.listTrash || backend.trashList;
    if (typeof listFn !== 'function') return [];
    const raw = await listFn.call(backend);
    const entries = (raw || []).map((it) => {
      const name = it.name || path.basename(it.originalPath || it.id || 'Item');
      const isDir = !!it.isDirectory;
      const delTime = it.deletionTime
        ? Number(it.deletionTime)
        : (it.deletionDate ? Date.parse(it.deletionDate) || 0 : 0);
      const uKind = kindOf(name, isDir);
      return {
        path: `trash://${it.id || name}`,
        trashId: it.id,
        name,
        originalPath: it.originalPath || '',
        deletionTime: delTime,
        mtime: delTime,
        size: Number(it.size) || 0,
        isDirectory: isDir,
        isHidden: false,
        kind: uKind,
        kindLabel: kindLabelOf(name, isDir),
      };
    });
    this.state.TrashCount = entries.length;
    return entries;
  }

  /** Move selected items to Trash. If `confirm: true` (or real OS trash in headless without mock), can prompt or toast with Undo. */
  async trashItems(items, { askConfirm = false, onUndoPush } = {}) {
    const backend = this.activeBackend;
    if (!backend || typeof backend.trash !== 'function' || !items || !items.length) return false;

    if (askConfirm) {
      const what = items.length === 1 ? `“${items[0].name}”` : formatCount(items.length, 'item');
      const ok = await confirmDialog({
        title: `Move ${what} to the Trash?`,
        body: 'You can restore items from the Trash later.',
        ok: 'Move to Trash',
        danger: true,
      });
      if (!ok) return false;
    }

    const trashedIds = [];
    for (const it of items) {
      try {
        const res = await backend.trash(it.path);
        if (res && res.id) trashedIds.push({ id: res.id, originalPath: it.path, name: it.name });
      } catch (err) {
        await alertDialog({
          title: `Could not move “${it.name}” to the Trash`,
          body: err.message || String(err),
          icon: 'alert',
        });
        break;
      }
    }

    if (trashedIds.length) {
      if (onUndoPush) {
        onUndoPush({
          type: 'trash',
          items: trashedIds,
          undo: async () => {
            for (const t of trashedIds) {
              if (t.id && typeof backend.restoreTrash === 'function') {
                await backend.restoreTrash(t.id);
              }
            }
          },
          redo: async () => {
            for (const t of trashedIds) {
              if (t.originalPath && typeof backend.trash === 'function') {
                const r = await backend.trash(t.originalPath);
                if (r && r.id) t.id = r.id;
              }
            }
          },
        });
      }
      if (this.onChanged) await this.onChanged();
      toast(`Moved ${formatCount(trashedIds.length, 'item')} to the Trash`, {
        icon: 'trash',
        key: 'trash',
        action: 'Undo',
        onAction: async () => {
          for (const t of trashedIds) {
            if (t.id && typeof backend.restoreTrash === 'function') {
              await backend.restoreTrash(t.id);
            }
          }
          if (this.onChanged) await this.onChanged();
        },
      });
      return true;
    }
    return false;
  }

  async restoreItems(items) {
    const backend = this.activeBackend;
    if (!backend || typeof backend.restoreTrash !== 'function' || !items || !items.length) return false;
    let count = 0;
    for (const it of items) {
      const id = it.trashId || it.id;
      if (!id) continue;
      try {
        await backend.restoreTrash(id);
        count++;
      } catch (err) {
        await alertDialog({
          title: `Could not restore “${it.name}”`,
          body: err.message || String(err),
          icon: 'alert',
        });
        break;
      }
    }
    if (count > 0) {
      if (this.onChanged) await this.onChanged();
      toast(`Restored ${formatCount(count, 'item')}`, { icon: 'undo' });
      return true;
    }
    return false;
  }

  async restoreSelected() {
    if (this.getSelected) {
      return this.restoreItems(this.getSelected());
    }
    return false;
  }

  async emptyTrash() {
    const backend = this.activeBackend;
    if (!backend || typeof backend.emptyTrash !== 'function') return false;
    const ok = await confirmDialog({
      title: 'Empty the Trash?',
      body: 'All items in the Trash will be permanently deleted. This cannot be undone.',
      ok: 'Empty Trash',
      danger: true,
    });
    if (!ok) return false;
    try {
      await backend.emptyTrash();
      if (this.onChanged) await this.onChanged();
      toast('Emptied the Trash', { icon: 'trash' });
      return true;
    } catch (err) {
      await alertDialog({
        title: 'Could not empty the Trash',
        body: err.message || String(err),
        icon: 'alert',
      });
      return false;
    }
  }
}
