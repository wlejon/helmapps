/**
 * What can be done to the file on screen: rename it, move it to the Trash
 * (with Undo), copy the picture or its path, open it in another app, show it in Files. The
 * view's rotate and flip never come here: they change the view only.
 *
 *   const actions = new FileActions({ current: () => state.path, vfs, onRenamed, onTrashed, onRestored });
 */

import { promptDialog, alertDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { menu } from '/lib/menu.js';
import { api } from '/lib/dom.js';
import { appsFor, appsReady, openFile, openApp } from '/lib/files.js';
import { formatOf, isImage } from './formats.js';

const fs = require('fs');
const path = require('path');

export class FileActions {
  constructor({ current, imagePng, onRenamed, onTrashed, onRestored }) {
    this.current = current;
    this.imagePng = imagePng;   // (path) => Promise<Blob>: the picture as a PNG
    this.onRenamed = onRenamed;
    this.onTrashed = onTrashed;
    this.onRestored = onRestored;
  }

  get vfs() {
    return api('vfs');
  }

  /** F2: a new name for the file, then the rename on disk. */
  async rename() {
    const from = this.current();
    if (!from) return false;
    const dir = path.dirname(from);
    const ext = path.extname(from);
    const name = await promptDialog({
      title: 'Rename',
      value: path.basename(from),
      ok: 'Rename',
      selectStem: true,
      validate: (v) => {
        const t = v.trim();
        if (/[\\/]/.test(t)) return 'A name cannot contain a slash';
        if (t === '.' || t === '..') return 'Not a valid name';
        if (t !== path.basename(from) && !isImage(t)) return `Keep an image extension such as ${ext || '.png'}`;
        return '';
      },
    });
    if (name == null) return false;
    const to = path.join(dir, name.trim());
    if (to === from) return false;
    try {
      await fs.promises.stat(to);
      await alertDialog({ title: `“${name.trim()}” already exists`, body: 'Choose another name.', icon: 'alert' });
      return false;
    } catch (_) { /* free: go on */ }
    try {
      await fs.promises.rename(from, to);
    } catch (err) {
      await alertDialog({ title: `Could not rename “${path.basename(from)}”`, body: err.message, icon: 'alert' });
      return false;
    }
    this.onRenamed(from, to);
    return true;
  }

  /** Delete: to the Trash at once, with Undo in the toast. */
  async trash() {
    const p = this.current();
    const vfs = this.vfs;
    if (!p || !vfs) return false;
    let item;
    try {
      item = await vfs.trash(p);
    } catch (err) {
      await alertDialog({ title: `Could not move “${path.basename(p)}” to the Trash`, body: err.message, icon: 'alert' });
      return false;
    }
    this.onTrashed(p);
    toast(`Moved “${path.basename(p)}” to the Trash`, {
      icon: 'trash',
      action: item && item.id ? 'Undo' : undefined,
      onAction: async () => {
        try {
          await vfs.restoreTrash(item.id);
          this.onRestored(p);
        } catch (err) {
          toast(`Could not restore: ${err.message}`, { error: true });
        }
      },
    });
    return true;
  }

  /** Mod+C: the picture itself onto the clipboard, as a PNG. */
  async copyImage() {
    const p = this.current();
    if (!p || !this.imagePng) return;
    try {
      const png = await this.imagePng(p);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Copied the image', { icon: 'copy' });
    } catch (err) {
      toast(`Could not copy: ${err.message}`, { error: true });
    }
  }

  /** Mod+Shift+C: the file's path, as text. */
  async copyPath() {
    const p = this.current();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      toast('Copied the path', { icon: 'copy' });
    } catch (err) {
      toast(`Could not copy: ${err.message}`, { error: true });
    }
  }

  /** The apps that open this type, as a menu below `anchor` (or at x, y). */
  async openWithMenu(at) {
    const p = this.current();
    if (!p) return;
    await appsReady();   // the catalog builds off the page thread
    if (this.current() !== p) return;
    const f = formatOf(p);
    const apps = appsFor(f ? f.mime : 'application/octet-stream')
      .filter((a) => a && a.id && !/helm\.images/.test(a.id));
    const items = apps.length
      ? apps.slice(0, 20).map((a) => ({ label: a.name || a.id, icon: 'external-link', action: () => this.openWith(a) }))
      : [{ label: 'No other app opens this type', disabled: true }];
    items.unshift({ heading: 'Open With' });
    if (at instanceof Element) menu.showBelow(items, at);
    else menu.show(items, at ? at.x : 200, at ? at.y : 120);
  }

  async openWith(appEntry) {
    const p = this.current();
    if (!p) return;
    if (!(await openFile(p, appEntry.id))) toast(`${appEntry.name || 'That app'} did not start`, { error: true });
  }

  /** Mod+Shift+O: the folder in the Files app. */
  async showInFiles() {
    const p = this.current();
    if (!p) return;
    if (!(await openApp('helm.files', [path.dirname(p)]))) toast('The Files app is not installed', { error: true });
  }
}
