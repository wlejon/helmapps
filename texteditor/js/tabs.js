/**
 * TabManager: wraps the kit's Tabs component with a "+" New Tab button,
 * manages open DocBuffers, active tab switching, dirty indicators, and
 * confirmation dialogs when closing modified documents.
 */

import { h } from '/lib/dom.js';
import { Tabs } from '/lib/layout.js';
import { Dialog } from '/lib/dialog.js';
import { iconFor } from '/lib/files.js';

const path = require('path');

export class TabManager {
  constructor({ app, commands, onActivate, onRequestSave, onDocClosed, onNewTab }) {
    this.app = app;
    this.commands = commands;
    this.onActivate = onActivate;
    this.onRequestSave = onRequestSave;
    this.onDocClosed = onDocClosed;
    this.onNewTab = onNewTab;

    this.docs = [];
    this.byId = new Map();
    this.activeId = null;

    this.tabs = new Tabs({
      onActivate: (id) => this.activate(id),
      onClose: (id) => this.closeTab(id),
    });

    this.newTabBtn = h('button.icon-btn.small.te-new-tab', {
      icon: 'plus',
      'aria-label': 'New Tab',
      'data-tip': 'New Tab',
      'data-keys': commands.keysFor('new-tab') || 'Ctrl+N',
      onclick: () => {
        if (this.onNewTab) this.onNewTab();
      },
    });

    this.el = h('div.te-tabbar', this.tabs.el, this.newTabBtn);
  }

  activeDoc() {
    return this.activeId != null ? (this.byId.get(this.activeId) || null) : null;
  }

  getDoc(id) {
    return this.byId.get(id) || null;
  }

  findByPath(filePath) {
    if (!filePath) return null;
    const norm = this.normalizePath(filePath);
    return this.docs.find((d) => d.path && this.normalizePath(d.path) === norm) || null;
  }

  normalizePath(p) {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  nextUntitledTitle() {
    const used = new Set(this.docs.map((d) => d.title));
    if (!used.has('Untitled')) return 'Untitled';
    let n = 2;
    while (used.has(`Untitled ${n}`)) n++;
    return `Untitled ${n}`;
  }

  addDoc(doc, { activate = true } = {}) {
    if (!this.byId.has(doc.id)) {
      this.docs.push(doc);
      this.byId.set(doc.id, doc);
      const iconName = doc.path ? iconFor({ name: doc.title }) : 'file-text';
      this.tabs.add({
        id: doc.id,
        label: doc.title,
        icon: iconName,
        dirty: doc.dirty,
        title: doc.path || doc.title,
      });
    }
    if (activate) {
      this.activate(doc.id);
    } else {
      this.updateDoc(doc);
    }
    return doc;
  }

  activate(id) {
    const doc = this.byId.get(id);
    if (!doc) return null;
    this.activeId = id;
    this.tabs.activate(id, false);
    this.updateWindowTitle(doc);
    if (this.onActivate) this.onActivate(doc);
    return doc;
  }

  updateDoc(doc) {
    if (!doc || !this.byId.has(doc.id)) return;
    this.tabs.update(doc.id, {
      label: doc.title,
      dirty: doc.dirty,
      title: doc.path || doc.title,
    });
    if (this.activeId === doc.id) {
      this.updateWindowTitle(doc);
    }
  }

  updateWindowTitle(doc = this.activeDoc()) {
    if (!doc) {
      this.app.setTitle('');
      return;
    }
    const prefix = doc.dirty ? '• ' : '';
    this.app.setTitle(`${prefix}${doc.title}`);
  }

  stepTab(delta) {
    if (this.docs.length <= 1) return;
    const idx = this.docs.findIndex((d) => d.id === this.activeId);
    const nextIdx = (idx + delta + this.docs.length) % this.docs.length;
    this.activate(this.docs[nextIdx].id);
  }

  nextTab() {
    this.stepTab(1);
  }

  prevTab() {
    this.stepTab(-1);
  }

  /**
   * Ask Save / Don't Save / Cancel for a dirty tab.
   * Returns 'save' | 'discard' | 'cancel'.
   */
  async promptDirtyClose(doc) {
    const d = new Dialog({
      title: `Save changes to “${doc.title}” before closing?`,
      body: "Your changes will be lost if you don't save them.",
      icon: 'alert',
    });
    d.addButton('Cancel', { value: 'cancel' });
    d.addButton("Don't Save", { danger: true, value: 'discard' });
    d.addButton('Save', { primary: true, value: 'save' });
    const choice = await d.open();
    return choice || 'cancel';
  }

  /**
   * Close a tab by id (defaults to active tab). If dirty, prompts first unless
   * `{ force: true }` is passed.
   */
  async closeTab(id = this.activeId, { force = false } = {}) {
    const doc = this.byId.get(id);
    if (!doc) return false;

    if (doc.dirty && !force) {
      const choice = await this.promptDirtyClose(doc);
      if (choice === 'cancel') return false;
      if (choice === 'save') {
        const saved = this.onRequestSave ? await this.onRequestSave(doc) : false;
        if (!saved) return false;
      }
    }

    const idx = this.docs.findIndex((d) => d.id === doc.id);
    if (idx >= 0) this.docs.splice(idx, 1);
    this.byId.delete(doc.id);
    this.tabs.remove(doc.id);

    if (this.onDocClosed) this.onDocClosed(doc);

    if (this.docs.length === 0) {
      this.activeId = null;
      if (this.onNewTab) {
        this.onNewTab();
      }
      return true;
    }

    if (this.activeId === doc.id) {
      const nextDoc = this.docs[Math.min(idx, this.docs.length - 1)];
      this.activate(nextDoc.id);
    }
    return true;
  }

  /**
   * When quitting with modified tabs, ask once for all of them.
   */
  async confirmQuitAll() {
    const dirtyDocs = this.docs.filter((d) => d.dirty);
    if (!dirtyDocs.length) return true;

    const names = dirtyDocs.map((d) => `“${d.title}”`).join(', ');
    const d = new Dialog({
      title: dirtyDocs.length === 1
        ? `Save changes to ${names} before quitting?`
        : `Save changes to ${dirtyDocs.length} documents before quitting?`,
      body: dirtyDocs.length === 1
        ? "Your changes will be lost if you don't save them."
        : `Unsaved documents: ${names}`,
      icon: 'alert',
    });
    d.addButton('Cancel', { value: 'cancel' });
    d.addButton("Don't Save", { danger: true, value: 'discard' });
    d.addButton(dirtyDocs.length === 1 ? 'Save' : 'Save All', { primary: true, value: 'save' });
    const choice = await d.open();
    if (!choice || choice === 'cancel') return false;
    if (choice === 'save') {
      for (const doc of dirtyDocs) {
        const ok = this.onRequestSave ? await this.onRequestSave(doc) : false;
        if (!ok) return false;
      }
    }
    return true;
  }
}
