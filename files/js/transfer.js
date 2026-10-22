/**
 * File operations (New Folder, Rename, Copy, Cut, Paste, Duplicate, Delete
 * Permanently, Move to Trash, Undo, Redo), name conflict dialog, and progress
 * indicator in the status bar.
 */

import { h, api } from '/lib/dom.js';
import { Dialog, confirmDialog, promptDialog, alertDialog } from '/lib/dialog.js';
import { Checkbox, Progress } from '/lib/controls.js';
import { toast } from '/lib/toast.js';
import { formatCount } from '/lib/format.js';
import { exists } from '/lib/files.js';
import { TRASH_URI } from './model.js';

const fs = require('fs');
const path = require('path');

/** Validate a file or folder name (no slashes, not empty, not . or ..). */
export function validateFileName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'Name cannot be empty';
  if (trimmed === '.' || trimmed === '..') return 'Invalid name';
  if (name.includes('/') || name.includes('\\')) return 'Name cannot contain slashes';
  if (name.includes('\0')) return 'Invalid character in name';
  return '';
}

/** Generate a unique "name (2).ext", "name (3).ext" path in `dirPath`. */
export function uniqueConflictPath(dirPath, fileName) {
  const ext = path.extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let n = 2;
  while (n < 10000) {
    const candidate = path.join(dirPath, `${stem} (${n})${ext}`);
    if (!exists(candidate)) return candidate;
    n++;
  }
  return path.join(dirPath, `${stem} (${Date.now()})${ext}`);
}

export class TransferManager {
  constructor({ state, model, trash, onStatusUpdate }) {
    this.state = state;
    this.model = model;
    this.trash = trash;
    this.onStatusUpdate = onStatusUpdate;

    // App-level undo/redo stack to complement bro.vfs.undo/redo
    this.undoStack = [];
    this.redoStack = [];

    this.progress = new Progress(null);
    this.progressLabel = h('span.num', '');
    this.progressWrap = h('div.files-status-transfer.hidden',
      this.progressLabel,
      this.progress.el,
    );
  }

  get vfs() {
    if (this.state.disableVfs) return null;
    return this.state.customVfs || api('vfs');
  }

  hasVfs() {
    return !!this.vfs;
  }

  pushUndo(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    if (this.onStatusUpdate) this.onStatusUpdate();
  }

  canUndo() {
    if (this.state.disableVfs) return false;
    return this.undoStack.length > 0;
  }

  canRedo() {
    if (this.state.disableVfs) return false;
    return this.redoStack.length > 0;
  }

  async undo() {
    if (!this.canUndo()) return false;
    const entry = this.undoStack.pop();
    try {
      if (entry.undo) {
        await entry.undo();
      }
      this.redoStack.push(entry);
      await this.model.reload({ preserveSelection: true });
      if (this.onStatusUpdate) this.onStatusUpdate();
      toast('Undid last action', { icon: 'undo', key: 'undo' });
      return true;
    } catch (err) {
      if (this.onStatusUpdate) this.onStatusUpdate();
      toast(`Could not undo: ${err.message || err}`, { error: true });
      return false;
    }
  }

  async redo() {
    if (!this.canRedo()) return false;
    const entry = this.redoStack.pop();
    try {
      if (entry.redo) {
        await entry.redo();
      }
      this.undoStack.push(entry);
      await this.model.reload({ preserveSelection: true });
      if (this.onStatusUpdate) this.onStatusUpdate();
      toast('Redid action', { icon: 'redo', key: 'undo' });
      return true;
    } catch (err) {
      if (this.onStatusUpdate) this.onStatusUpdate();
      toast(`Could not redo: ${err.message || err}`, { error: true });
      return false;
    }
  }

  /** Run an async operation and show progress in the status bar if it takes > 300 ms. */
  async withProgress(label, fn) {
    let shown = false;
    const timer = setTimeout(() => {
      shown = true;
      this.progressLabel.textContent = label;
      this.progress.set(null);
      this.progressWrap.classList.remove('hidden');
    }, 300);
    try {
      return await fn((fraction, text) => {
        if (text) this.progressLabel.textContent = text;
        if (shown) this.progress.set(fraction);
      });
    } finally {
      clearTimeout(timer);
      if (shown) this.progressWrap.classList.add('hidden');
    }
  }

  /** Create a new folder in the current directory and select it. */
  async newFolder() {
    if (!this.hasVfs()) return null;
    const dirPath = this.state.currentPath;
    if (!dirPath || dirPath === TRASH_URI) return null;

    let defaultName = 'New Folder';
    if (exists(path.join(dirPath, defaultName))) {
      defaultName = path.basename(uniqueConflictPath(dirPath, defaultName));
    }

    const name = await promptDialog({
      title: 'New Folder',
      value: defaultName,
      placeholder: 'Folder name',
      ok: 'Create',
      validate: (val) => {
        const err = validateFileName(val);
        if (err) return err;
        if (exists(path.join(dirPath, val.trim()))) return 'An item with that name already exists';
        return '';
      },
    });
    if (!name) return null;
    const target = path.join(dirPath, name.trim());
    try {
      await fs.promises.mkdir(target);
      this.pushUndo({
        type: 'mkdir',
        undo: async () => { await fs.promises.rmdir(target); },
        redo: async () => { await fs.promises.mkdir(target); },
      });
      await this.model.reload({ select: target });
      return target;
    } catch (err) {
      await alertDialog({ title: 'Could not create folder', body: err.message || String(err), icon: 'alert' });
      return null;
    }
  }

  /** Rename a single selected item. */
  async renameItem(item) {
    if (!this.hasVfs() || !item) return null;
    const dirPath = path.dirname(item.path);
    const newName = await promptDialog({
      title: 'Rename',
      value: item.name,
      ok: 'Rename',
      selectStem: !item.isDirectory,
      validate: (val) => {
        const err = validateFileName(val);
        if (err) return err;
        const trimmed = val.trim();
        if (trimmed !== item.name && exists(path.join(dirPath, trimmed))) {
          return 'An item with that name already exists';
        }
        return '';
      },
    });
    if (!newName || newName.trim() === item.name) return null;
    const dest = path.join(dirPath, newName.trim());
    const vfs = this.vfs;
    try {
      if (vfs && typeof vfs.move === 'function') {
        await vfs.move(item.path, dest);
      } else {
        await fs.promises.rename(item.path, dest);
      }
      this.pushUndo({
        type: 'rename',
        undo: async () => { await fs.promises.rename(dest, item.path); },
        redo: async () => { await fs.promises.rename(item.path, dest); },
      });
      await this.model.reload({ select: dest });
      return dest;
    } catch (err) {
      await alertDialog({ title: 'Could not rename item', body: err.message || String(err), icon: 'alert' });
      return null;
    }
  }

  /** Copy or Cut selected items into the clipboard. */
  setClipboard(mode, items) {
    if (!items || !items.length) return;
    const paths = items.map((it) => it.path);
    this.state.clipboard = { mode, paths };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(paths.join('\n')).catch(() => {});
      }
    } catch (_) { /* ignore */ }
    const verb = mode === 'cut' ? 'Cut' : 'Copied';
    toast(`${verb} ${formatCount(paths.length, 'item')}`, { icon: mode === 'cut' ? 'cut' : 'copy', key: 'clipboard' });
    if (this.onStatusUpdate) this.onStatusUpdate();
  }

  /** Ask user how to resolve a file conflict: 'replace' | 'keep-both' | 'skip' | null (cancel). */
  async askConflictDialog(fileName, destDir, showApplyAll = false) {
    const d = new Dialog({
      title: `“${fileName}” already exists`,
      icon: 'alert',
    });
    const applyAllBox = new Checkbox({ on: false, label: 'Apply to all conflicts' });
    d.body.append(
      h('p', `An item named “${fileName}” already exists in “${path.basename(destDir) || destDir}”. How would you like to proceed?`),
      showApplyAll ? h('div.files-conflict-meta', applyAllBox.el) : null,
    );
    d.addButton('Cancel', { value: null });
    d.addButton('Skip', { value: 'skip' });
    d.addButton('Replace', { danger: true, value: 'replace' });
    d.addButton('Keep Both', { primary: true, value: 'keep-both' });
    const choice = await d.open();
    return { choice, applyAll: applyAllBox.value };
  }

  /** Paste clipboard items into `destDir` (defaults to currentPath). */
  async paste(destDir = this.state.currentPath) {
    if (!this.hasVfs()) return false;
    const clip = this.state.clipboard;
    if (!clip || !clip.paths || !clip.paths.length || !destDir || destDir === TRASH_URI) return false;
    const ok = await this.transferPaths(clip.paths, destDir, { copy: clip.mode !== 'cut' });
    if (ok && clip.mode === 'cut') {
      this.state.clipboard = null;
    }
    return ok;
  }

  /** Transfer (copy or move) a list of source paths into `destDir`. */
  async transferPaths(srcPaths, destDir, { copy = true } = {}) {
    if (!this.hasVfs() || !srcPaths || !srcPaths.length || !destDir) return false;
    if (destDir === TRASH_URI) {
      const items = srcPaths.map((p) => ({ path: p, name: path.basename(p) }));
      return this.trash.trashItems(items, { onUndoPush: (u) => this.pushUndo(u) });
    }

    const vfs = this.vfs;
    let applyAllChoice = null;
    const createdOrMoved = [];
    const undoOps = [];

    await this.withProgress(copy ? 'Copying…' : 'Moving…', async (report) => {
      for (let i = 0; i < srcPaths.length; i++) {
        const src = srcPaths[i];
        const base = path.basename(src);
        let dest = path.join(destDir, base);
        report(i / srcPaths.length, `${copy ? 'Copying' : 'Moving'} ${base}…`);

        // Copying onto itself in the same folder -> automatic Keep Both
        if (path.resolve(src) === path.resolve(dest)) {
          if (!copy) continue;
          dest = uniqueConflictPath(destDir, base);
        } else if (exists(dest)) {
          let decision = applyAllChoice;
          if (!decision) {
            const ans = await this.askConflictDialog(base, destDir, srcPaths.length - i > 1);
            if (!ans.choice) return; // Cancelled
            decision = ans.choice;
            if (ans.applyAll) applyAllChoice = decision;
          }
          if (decision === 'skip') continue;
          if (decision === 'keep-both') {
            dest = uniqueConflictPath(destDir, base);
          } else if (decision === 'replace') {
            if (vfs && typeof vfs.remove === 'function') {
              await vfs.remove(dest, { recursive: true });
            } else {
              await fs.promises.rm(dest, { recursive: true, force: true });
            }
          }
        }

        if (copy) {
          if (vfs && typeof vfs.copy === 'function') {
            await vfs.copy(src, dest, { overwrite: true });
          } else {
            await fs.promises.cp(src, dest, { recursive: true, force: true });
          }
          createdOrMoved.push(dest);
          undoOps.push({
            undo: async () => { await fs.promises.rm(dest, { recursive: true, force: true }); },
            redo: async () => {
              if (vfs && typeof vfs.copy === 'function') await vfs.copy(src, dest, { overwrite: true });
              else await fs.promises.cp(src, dest, { recursive: true, force: true });
            },
          });
        } else {
          if (vfs && typeof vfs.move === 'function') {
            await vfs.move(src, dest, { overwrite: true });
          } else {
            await fs.promises.rename(src, dest);
          }
          createdOrMoved.push(dest);
          undoOps.push({
            undo: async () => {
              if (vfs && typeof vfs.move === 'function') await vfs.move(dest, src, { overwrite: true });
              else await fs.promises.rename(dest, src);
            },
            redo: async () => {
              if (vfs && typeof vfs.move === 'function') await vfs.move(src, dest, { overwrite: true });
              else await fs.promises.rename(src, dest);
            },
          });
        }
      }
    });

    if (createdOrMoved.length > 0) {
      this.pushUndo({
        type: copy ? 'copy' : 'move',
        undo: async () => {
          for (const op of undoOps.slice().reverse()) await op.undo();
        },
        redo: async () => {
          for (const op of undoOps) await op.redo();
        },
      });
      await this.model.reload({ select: createdOrMoved[createdOrMoved.length - 1] });
      return true;
    }
    return false;
  }

  /** Duplicate selected items in the current folder. */
  async duplicateItems(items) {
    if (!this.hasVfs() || !items || !items.length) return false;
    const dirPath = this.state.currentPath;
    if (!dirPath || dirPath === TRASH_URI) return false;
    const vfs = this.vfs;
    const created = [];
    for (const it of items) {
      const dest = uniqueConflictPath(dirPath, it.name);
      try {
        if (vfs && typeof vfs.copy === 'function') {
          await vfs.copy(it.path, dest);
        } else {
          await fs.promises.cp(it.path, dest, { recursive: true });
        }
        created.push({ src: it.path, dest });
      } catch (err) {
        await alertDialog({ title: `Could not duplicate “${it.name}”`, body: err.message || String(err), icon: 'alert' });
        break;
      }
    }
    if (created.length) {
      this.pushUndo({
        type: 'duplicate',
        undo: async () => {
          for (const c of created) await fs.promises.rm(c.dest, { recursive: true, force: true });
        },
        redo: async () => {
          for (const c of created) {
            if (vfs && typeof vfs.copy === 'function') await vfs.copy(c.src, c.dest);
            else await fs.promises.cp(c.src, c.dest, { recursive: true });
          }
        },
      });
      await this.model.reload({ select: created[created.length - 1].dest });
      return true;
    }
    return false;
  }

  /** Permanently delete selected items after a danger confirmDialog. */
  async deletePermanently(items) {
    if (!this.hasVfs() || !items || !items.length) return false;
    const what = items.length === 1 ? `“${items[0].name}”` : formatCount(items.length, 'item');
    const ok = await confirmDialog({
      title: `Permanently delete ${what}?`,
      body: 'This item will be deleted immediately and cannot be recovered.',
      ok: 'Delete Permanently',
      danger: true,
    });
    if (!ok) return false;

    const vfs = this.vfs;
    for (const it of items) {
      try {
        if (vfs && typeof vfs.remove === 'function') {
          await vfs.remove(it.path, { recursive: true });
        } else {
          await fs.promises.rm(it.path, { recursive: true, force: true });
        }
      } catch (err) {
        await alertDialog({ title: `Could not delete “${it.name}”`, body: err.message || String(err), icon: 'alert' });
        break;
      }
    }
    await this.model.reload();
    toast(`Deleted ${what}`, { icon: 'trash' });
    return true;
  }
}
