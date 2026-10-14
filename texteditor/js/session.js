/**
 * SessionManager: crash recovery autosave (5s idle timer), external file
 * watcher (fs.watch), and open-tabs session persistence.
 */

import { decodeBufferBytes } from './buffer.js';

const fs = require('fs');
const path = require('path');

export class SessionManager {
  constructor({ app, settings, getDocs, getActiveDoc, onExternalCleanReload, onExternalDirtyChange, onExternalDeleted, onRecoveryAvailable }) {
    this.app = app;
    this.settings = settings;
    this.getDocs = getDocs;
    this.getActiveDoc = getActiveDoc;
    this.onExternalCleanReload = onExternalCleanReload;
    this.onExternalDirtyChange = onExternalDirtyChange;
    this.onExternalDeleted = onExternalDeleted;
    this.onRecoveryAvailable = onRecoveryAvailable;

    this.autosaveDelayMs = 5000;
    this.autosaveTimers = new Map(); // doc.id -> timeoutId
    this.watchers = new Map();       // doc.id -> { watcher, filePath }
    this.pendingRecovery = [];
  }

  get recoveryDir() {
    const base = (typeof bro !== 'undefined' && bro.app && bro.app.dataDir)
      ? bro.app.dataDir
      : (process.env.BRO_APP_HOME || '.');
    return path.join(base, 'recovery');
  }

  get autosaveMirrorDir() {
    const base = (typeof bro !== 'undefined' && bro.app && bro.app.dataDir)
      ? bro.app.dataDir
      : (process.env.BRO_APP_HOME || '.');
    return path.join(base, 'autosave');
  }

  setAutosaveDelay(ms) {
    this.autosaveDelayMs = Math.max(10, Number(ms) || 5000);
  }

  recoveryFileFor(docOrId) {
    const id = typeof docOrId === 'object' ? docOrId.id : docOrId;
    return path.join(this.recoveryDir, `recovery-${id}.json`);
  }

  mirrorFileFor(docOrId) {
    const id = typeof docOrId === 'object' ? docOrId.id : docOrId;
    return path.join(this.autosaveMirrorDir, `recovery-${id}.json`);
  }

  /**
   * Schedule an autosave recovery snapshot 5s after the last change to `doc`.
   */
  scheduleAutosave(doc) {
    if (!doc) return;
    const prev = this.autosaveTimers.get(doc.id);
    if (prev) clearTimeout(prev);
    if (!doc.dirty) {
      this.autosaveTimers.delete(doc.id);
      this.clearRecoveryForDoc(doc);
      return;
    }
    const timer = setTimeout(() => {
      this.autosaveTimers.delete(doc.id);
      this.writeRecoveryForDoc(doc);
    }, this.autosaveDelayMs);
    this.autosaveTimers.set(doc.id, timer);
  }

  async writeRecoveryForDoc(doc) {
    if (!doc || !doc.dirty) return null;
    const payload = JSON.stringify({
      id: doc.id,
      path: doc.path || '',
      title: doc.title || 'Untitled',
      text: doc.text,
      savedText: doc.savedText,
      eol: doc.eol,
      bom: doc.bom,
      timestamp: Date.now(),
    });
    const recDir = this.recoveryDir;
    const mirDir = this.autosaveMirrorDir;
    const recFile = this.recoveryFileFor(doc);
    const mirFile = this.mirrorFileFor(doc);
    try {
      await fs.promises.mkdir(recDir, { recursive: true });
      await fs.promises.writeFile(recFile, payload, 'utf-8');
      await fs.promises.mkdir(mirDir, { recursive: true });
      await fs.promises.writeFile(mirFile, payload, 'utf-8');
    } catch (_) {}
    return recFile;
  }

  async flushAutosave() {
    for (const [id, timer] of this.autosaveTimers.entries()) {
      clearTimeout(timer);
      this.autosaveTimers.delete(id);
    }
    const docs = this.getDocs().filter((d) => d.dirty);
    await Promise.all(docs.map((d) => this.writeRecoveryForDoc(d)));
  }

  async clearRecoveryForDoc(docOrId) {
    const id = typeof docOrId === 'object' ? docOrId.id : docOrId;
    const timer = this.autosaveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.autosaveTimers.delete(id);
    }
    const recFile = this.recoveryFileFor(id);
    const mirFile = this.mirrorFileFor(id);
    try { await fs.promises.unlink(recFile); } catch {}
    try { await fs.promises.unlink(mirFile); } catch {}
  }

  async clearAllRecovery() {
    for (const timer of this.autosaveTimers.values()) clearTimeout(timer);
    this.autosaveTimers.clear();
    for (const dir of [this.recoveryDir, this.autosaveMirrorDir]) {
      try {
        const entries = await fs.promises.readdir(dir);
        await Promise.all(entries.map((name) => fs.promises.unlink(path.join(dir, name)).catch(() => {})));
      } catch {}
    }
    this.pendingRecovery = [];
  }

  /**
   * Check `bro.app.dataDir/recovery/` (and `autosave/`) for crash recovery files
   * left behind and notify the UI to offer restoration.
   */
  async checkRecovery() {
    const found = [];
    const seen = new Set();
    for (const dir of [this.recoveryDir, this.autosaveMirrorDir]) {
      let names = [];
      try {
        names = await fs.promises.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.json') || seen.has(name)) continue;
        seen.add(name);
        try {
          const raw = await fs.promises.readFile(path.join(dir, name), 'utf-8');
          const data = JSON.parse(raw);
          if (data && typeof data.text === 'string') {
            found.push({ file: path.join(dir, name), data });
          }
        } catch {}
      }
    }
    this.pendingRecovery = found;
    if (found.length > 0 && this.onRecoveryAvailable) {
      this.onRecoveryAvailable(found.map((f) => f.data));
    }
    return found.map((f) => f.data);
  }

  // ---- External file watching ---------------------------------------------------

  watchDoc(doc) {
    this.unwatchDoc(doc.id);
    if (!doc || !doc.path) return;
    const targetPath = path.resolve(doc.path);
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    const normBase = process.platform === 'win32' ? base.toLowerCase() : base;

    let debounceTimer = null;
    try {
      const watcher = fs.watch(dir, { recursive: false }, (eventType, filename) => {
        if (Date.now() < doc.selfWriteUntil) return;
        if (filename) {
          const normName = process.platform === 'win32' ? String(filename).toLowerCase() : String(filename);
          if (normName !== normBase && !normName.endsWith('/' + normBase) && !normName.endsWith('\\' + normBase)) {
            return;
          }
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          this.inspectExternalState(doc);
        }, 60);
      });
      if (watcher && typeof watcher.on === 'function') {
        watcher.on('error', () => {});
      }
      this.watchers.set(doc.id, {
        watcher,
        filePath: targetPath,
        close: () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          try { watcher.close(); } catch {}
        },
      });
    } catch (_) {}
  }

  unwatchDoc(docId) {
    const entry = this.watchers.get(docId);
    if (!entry) return;
    entry.close();
    this.watchers.delete(docId);
  }

  async inspectExternalState(doc) {
    if (!doc || !doc.path) return;
    if (Date.now() < doc.selfWriteUntil) return;

    try {
      await fs.promises.stat(doc.path);
    } catch (_) {
      if (!doc.deletedOnDisk) {
        doc.deletedOnDisk = true;
        doc.dirty = true;
        if (this.onExternalDeleted) this.onExternalDeleted(doc);
      }
      return;
    }

    try {
      const raw = await fs.promises.readFile(doc.path);
      const decoded = decodeBufferBytes(raw);
      if (decoded.text === doc.savedText && decoded.text === doc.text) return;

      if (!doc.dirty) {
        doc.eol = decoded.eol;
        doc.bom = decoded.bom;
        doc.binary = decoded.binary;
        doc.readOnly = decoded.readOnly;
        doc.deletedOnDisk = false;
        doc.externalChanged = false;
        doc.setText(decoded.text, { markDirty: false });
        if (this.onExternalCleanReload) this.onExternalCleanReload(doc);
      } else {
        doc.externalChanged = true;
        if (this.onExternalDirtyChange) this.onExternalDirtyChange(doc);
      }
    } catch (_) {}
  }

  // ---- Session persistence ------------------------------------------------------

  saveSession() {
    const docs = this.getDocs();
    const active = this.getActiveDoc();
    const files = docs
      .filter((d) => !!d.path)
      .map((d) => ({
        path: d.path,
        caret: d.caret ? d.caret.start : 0,
      }));
    this.settings.set('session', {
      files,
      activePath: active && active.path ? active.path : '',
    });
  }
}
