/**
 * Text Editor (helm.texteditor): plain-text editor for notes, config files,
 * and quick code edits.
 *
 * Follows docs/performance.md:
 *  - Paints the entire window frame synchronously before any disk I/O.
 *  - Uses one native <textarea> per open document for zero-lag typing, IME,
 *    selection, clipboard, and undo/redo.
 *  - Performs all file reads, atomic writes, watchers, and recovery autosaves
 *    asynchronously off the rendering path.
 */

import { startApp } from '/lib/app.js';
import { h, clamp } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar } from '/lib/layout.js';
import { menu } from '/lib/menu.js';
import { confirmDialog, alertDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { formatBytes } from '/lib/format.js';
import { addRecent, homeDir } from '/lib/files.js';

import {
  DocBuffer,
  LARGE_FILE_BYTES,
  readBufferFromDisk,
  writeBufferToDisk,
} from './buffer.js';
import { EditorView } from './editor-view.js';
import { TabManager } from './tabs.js';
import { FindBar, promptGoToLine } from './find.js';
import { SessionManager } from './session.js';

const fs = require('fs');
const path = require('path');

const FILE_DIALOG_FILTER =
  'Text Files|txt;md;json;js;css;html;ini;conf;cfg;yaml;yml;toml;sh;py;c;cpp;h;log';

const app = startApp({
  settings: {
    wordWrap:      { type: 'bool', default: false },
    fontSize:      { type: 'int', default: 14, min: 10, max: 32 },
    monospace:     { type: 'bool', default: true },
    tabWidth:      { type: 'int', default: 4, min: 1, max: 16 },
    insertSpaces:  { type: 'bool', default: true },
    showStatusBar: { type: 'bool', default: true },
    recent:        { type: 'json', default: [] },
    session:       { type: 'json', default: { files: [], activePath: '' } },
  },
});

const { commands, settings } = app;

// ---- State --------------------------------------------------------------------

const state = {
  ready: false,
  opening: 0,
};

// ---- Window & Layout (built synchronously before any disk I/O) ----------------

const ui = appFrame({ toolbar: true, sidebar: false, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);

const editorView = new EditorView({
  settings,
  onBufferInput: (doc) => onDocumentEdited(doc),
  onCaretChange: (doc) => updateStatusBar(doc),
});

const tabManager = new TabManager({
  app,
  commands,
  onActivate: (doc) => onTabActivated(doc),
  onRequestSave: (doc) => saveDoc(doc),
  onDocClosed: (doc) => {
    editorView.removeDoc(doc.id);
    session.unwatchDoc(doc.id);
    session.clearRecoveryForDoc(doc.id);
    session.saveSession();
  },
  onNewTab: () => newTab(),
});

const findBar = new FindBar({
  getActiveDoc: () => tabManager.activeDoc(),
  editorView,
  onDocMutated: (doc) => onDocumentEdited(doc),
});

const session = new SessionManager({
  app,
  settings,
  getDocs: () => tabManager.docs,
  getActiveDoc: () => tabManager.activeDoc(),
  onExternalCleanReload: (doc) => {
    editorView.refreshDoc(doc);
    tabManager.updateDoc(doc);
    if (findBar.visible) findBar.recompute({ selectFirst: false });
    if (tabManager.activeDoc() === doc) {
      updateBanners(doc);
      updateStatusBar(doc);
    }
  },
  onExternalDirtyChange: (doc) => {
    if (tabManager.activeDoc() === doc) {
      updateBanners(doc);
    }
  },
  onExternalDeleted: (doc) => {
    tabManager.updateDoc(doc);
    if (tabManager.activeDoc() === doc) {
      updateBanners(doc);
    }
  },
  onRecoveryAvailable: () => {
    updateRecoveryBanner();
  },
});

// ---- Banners ------------------------------------------------------------------

const readOnlyBannerText = h('span.te-banner-text', 'Binary or non-UTF-8 file — opened read-only');
const readOnlyBanner = h('div.te-banner.readonly.hidden',
  icon('lock'),
  readOnlyBannerText,
);

const externalBannerText = h('span.te-banner-text', 'Changed on disk.');
const externalReloadBtn = h('button.btn.small.primary', {
  text: 'Reload',
  onclick: () => reloadActiveFromDisk(),
});
const externalKeepBtn = h('button.btn.small', {
  text: 'Keep mine',
  onclick: () => keepMineOnExternalChange(),
});
const externalBanner = h('div#external-banner.te-banner.warn.te-external-banner.hidden',
  icon('alert'),
  externalBannerText,
  h('div.te-banner-actions', externalReloadBtn, externalKeepBtn),
);

const recoveryBannerText = h('span.te-banner-text', 'Unsaved changes were recovered from a previous session.');
const recoveryRestoreBtn = h('button.btn.small.primary', {
  text: 'Restore',
  onclick: () => restoreRecovery(),
});
const recoveryDiscardBtn = h('button.btn.small', {
  text: 'Discard',
  onclick: () => discardRecovery(),
});
const recoveryBanner = h('div.te-banner.warn.te-recovery-banner.hidden',
  icon('history'),
  recoveryBannerText,
  h('div.te-banner-actions', recoveryRestoreBtn, recoveryDiscardBtn),
);

ui.content.append(
  tabManager.el,
  recoveryBanner,
  readOnlyBanner,
  externalBanner,
  findBar.el,
  editorView.el,
);

// ---- Status bar ---------------------------------------------------------------

const statusCaret = h('span.te-status-item.num', 'Ln 1, Col 1');
const statusIndent = h('button.te-status-item.num', {
  'data-tip': 'Change Indentation',
  onclick: (e) => showIndentationMenu(e.currentTarget),
}, 'Spaces: 4');
const statusEol = h('button.te-status-item', {
  'data-tip': 'Toggle Line Endings (LF / CRLF)',
  onclick: () => toggleActiveEol(),
}, 'LF');
const statusEncoding = h('span.te-status-item', 'UTF-8');

ui.statusbar.append(
  statusCaret,
  h('div.toolbar-spacer'),
  statusIndent,
  h('div.te-status-sep'),
  statusEol,
  h('div.te-status-sep'),
  statusEncoding,
);

// ---- Commands -----------------------------------------------------------------

commands.addAll([
  { id: 'new-tab', label: 'New Tab', icon: 'file-plus', keys: ['Mod+N', 'Mod+T'], inText: true, run: () => newTab() },
  { id: 'open', label: 'Open…', icon: 'folder-open', keys: ['Mod+O'], inText: true, run: () => pickAndOpenFiles() },
  { id: 'save', label: 'Save', icon: 'save', keys: ['Mod+S'], inText: true,
    enabled: () => !!tabManager.activeDoc() && !tabManager.activeDoc().readOnly, run: () => saveActive() },
  { id: 'save-as', label: 'Save As…', icon: 'download', keys: ['Mod+Shift+S'], inText: true,
    enabled: () => !!tabManager.activeDoc(), run: () => saveAs(tabManager.activeDoc()) },
  { id: 'save-all', label: 'Save All', icon: 'save', keys: ['Mod+Alt+S'], inText: true,
    enabled: () => tabManager.docs.some((d) => d.dirty && !d.readOnly), run: () => saveAll() },
  { id: 'close-tab', label: 'Close Tab', icon: 'x', keys: ['Mod+W'], inText: true,
    enabled: () => tabManager.docs.length > 0, run: () => tabManager.closeTab() },
  { id: 'next-tab', label: 'Next Tab', keys: ['Ctrl+Tab', 'Ctrl+PageDown'], inText: true,
    enabled: () => tabManager.docs.length > 1, run: () => tabManager.nextTab() },
  { id: 'prev-tab', label: 'Previous Tab', keys: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'], inText: true,
    enabled: () => tabManager.docs.length > 1, run: () => tabManager.prevTab() },
  { id: 'find', label: 'Find…', icon: 'search', keys: ['Mod+F'], inText: true,
    run: () => findBar.open({ replace: false }) },
  { id: 'replace', label: 'Find and Replace…', icon: 'edit', keys: ['Mod+H'], inText: true,
    run: () => findBar.open({ replace: true }) },
  { id: 'find-next', label: 'Find Next', keys: ['F3'], inText: true,
    run: () => findBar.findNext({ focusEditor: true }) },
  { id: 'find-prev', label: 'Find Previous', keys: ['Shift+F3'], inText: true,
    run: () => findBar.findPrev({ focusEditor: true }) },
  { id: 'close-find', label: 'Close Find Bar', keys: ['Escape'], inText: true,
    enabled: () => findBar.visible, run: () => findBar.close() },
  { id: 'goto-line', label: 'Go to Line…', icon: 'hash', keys: ['Mod+G'], inText: true,
    enabled: () => !!tabManager.activeDoc(), run: () => promptGoToLine(tabManager.activeDoc(), editorView) },
  { id: 'toggle-wrap', label: 'Word Wrap', icon: 'wrap-text', keys: ['Alt+Z'], inText: true,
    checked: () => settings.get('wordWrap'), run: () => settings.set('wordWrap', !settings.get('wordWrap')) },
  { id: 'toggle-monospace', label: 'Monospace Font', icon: 'code', inText: true,
    checked: () => settings.get('monospace'), run: () => settings.set('monospace', !settings.get('monospace')) },
  { id: 'toggle-statusbar', label: 'Show Status Bar', inText: true,
    checked: () => settings.get('showStatusBar'), run: () => settings.set('showStatusBar', !settings.get('showStatusBar')) },
  { id: 'zoom-in', label: 'Zoom In', icon: 'zoom-in', keys: ['Mod+='], inText: true,
    run: () => settings.set('fontSize', clamp((Number(settings.get('fontSize')) || 14) + 2, 10, 32)) },
  { id: 'zoom-out', label: 'Zoom Out', icon: 'zoom-out', keys: ['Mod+-'], inText: true,
    run: () => settings.set('fontSize', clamp((Number(settings.get('fontSize')) || 14) - 2, 10, 32)) },
  { id: 'zoom-reset', label: 'Reset Zoom', keys: ['Mod+0'], inText: true,
    run: () => settings.set('fontSize', 14) },
  { id: 'new-window', label: 'New Window', icon: 'external-link', keys: ['Mod+Shift+N'], inText: true,
    run: () => app.newWindow(['--new-window']) },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], inText: true,
    run: async () => { if (await tabManager.confirmQuitAll()) { session.saveSession(); app.quit(); } } },
]);

// ---- Toolbar ------------------------------------------------------------------

toolbar.button('new-tab');
toolbar.button('open');

const recentBtn = h('button.icon-btn', {
  icon: 'history',
  'data-tip': 'Recent Files',
  'aria-label': 'Recent Files',
  onclick: (e) => showRecentMenu(e.currentTarget),
});
toolbar.add(recentBtn);

toolbar.sep();
toolbar.button('save');
toolbar.button('save-as');
toolbar.sep();
toolbar.button('find');
toolbar.button('replace');
toolbar.button('goto-line');
toolbar.spacer();
toolbar.button('toggle-wrap');

const viewMenuBtn = h('button.icon-btn', {
  icon: 'settings',
  'data-tip': 'View & Indentation Options',
  'aria-label': 'View Options',
  onclick: (e) => showViewMenu(e.currentTarget),
});
toolbar.add(viewMenuBtn);

// ---- Settings watchers --------------------------------------------------------

function applyAllViewSettings() {
  editorView.applySettings();
  ui.statusbar.classList.toggle('hidden', !settings.get('showStatusBar'));
  updateStatusBar(tabManager.activeDoc());
  toolbar.refresh();
}

for (const key of ['wordWrap', 'fontSize', 'monospace', 'tabWidth', 'insertSpaces', 'showStatusBar']) {
  settings.watch(key, () => applyAllViewSettings());
}

// ---- Document Lifecycle & Actions ---------------------------------------------

function newTab({ text = '', title = '' } = {}) {
  const doc = new DocBuffer({
    title: title || tabManager.nextUntitledTitle(),
    text,
    savedText: '',
    dirty: text.length > 0,
  });
  tabManager.addDoc(doc, { activate: true });
  toolbar.refresh();
  return doc;
}

function onTabActivated(doc) {
  editorView.showDoc(doc, { focus: !findBar.visible });
  updateBanners(doc);
  updateStatusBar(doc);
  if (findBar.visible) {
    findBar.recompute({ selectFirst: false });
  }
  toolbar.refresh();
  session.saveSession();
}

function onDocumentEdited(doc) {
  tabManager.updateDoc(doc);
  updateStatusBar(doc);
  if (findBar.visible) {
    findBar.recompute({ selectFirst: false });
  }
  toolbar.refresh();
  session.scheduleAutosave(doc);
}

function updateBanners(doc = tabManager.activeDoc()) {
  if (!doc) {
    readOnlyBanner.classList.add('hidden');
    externalBanner.classList.add('hidden');
    return;
  }
  if (doc.readOnly) {
    readOnlyBannerText.textContent = doc.binary
      ? 'Binary or non-UTF-8 file — opened read-only'
      : 'Read-only file';
    readOnlyBanner.classList.remove('hidden');
  } else {
    readOnlyBanner.classList.add('hidden');
  }

  if (doc.externalChanged) {
    externalBannerText.textContent = `“${doc.title}” has changed on disk.`;
    externalReloadBtn.textContent = 'Reload';
    externalKeepBtn.textContent = 'Keep mine';
    externalBanner.classList.remove('hidden');
  } else if (doc.deletedOnDisk) {
    externalBannerText.textContent = `“${doc.title}” was deleted on disk. Save to recreate it.`;
    externalReloadBtn.textContent = 'Save';
    externalKeepBtn.textContent = 'Keep mine';
    externalBanner.classList.remove('hidden');
  } else {
    externalBanner.classList.add('hidden');
  }
}

function updateRecoveryBanner() {
  const count = session.pendingRecovery.length;
  if (count > 0) {
    recoveryBannerText.textContent = count === 1
      ? 'An unsaved document was recovered from a previous session.'
      : `${count} unsaved documents were recovered from a previous session.`;
    recoveryBanner.classList.remove('hidden');
  } else {
    recoveryBanner.classList.add('hidden');
  }
}

function updateStatusBar(doc = tabManager.activeDoc()) {
  const insertSpaces = settings.get('insertSpaces');
  const tabWidth = clamp(Number(settings.get('tabWidth')) || 4, 1, 16);
  statusIndent.textContent = insertSpaces ? `Spaces: ${tabWidth}` : `Tab Size: ${tabWidth}`;

  if (!doc) {
    statusCaret.textContent = 'Ln 1, Col 1';
    statusEol.textContent = 'LF';
    statusEncoding.textContent = 'UTF-8';
    return;
  }

  const { line, col, start, end } = doc.caret;
  const selLen = Math.abs((end || 0) - (start || 0));
  statusCaret.textContent = selLen > 0
    ? `Ln ${line}, Col ${col} (${selLen} selected)`
    : `Ln ${line}, Col ${col}`;
  statusEol.textContent = doc.eol;
  statusEncoding.textContent = doc.encodingLabel;
}

function toggleActiveEol() {
  const doc = tabManager.activeDoc();
  if (!doc || doc.readOnly) return;
  doc.eol = doc.eol === 'CRLF' ? 'LF' : 'CRLF';
  doc.dirty = true;
  onDocumentEdited(doc);
}

function recordRecentFile(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const list = Array.isArray(settings.get('recent')) ? settings.get('recent') : [];
  const norm = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const filtered = list.filter((p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p)) !== norm);
  filtered.unshift(resolved);
  if (filtered.length > 10) filtered.length = 10;
  settings.set('recent', filtered);
  addRecent(resolved);
}

/**
 * Open a single file path into a tab (or activate its existing tab).
 */
async function openFile(filePath, { activate = true, quiet = false, caretOffset = 0 } = {}) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);

  const existing = tabManager.findByPath(resolved);
  if (existing) {
    if (activate) tabManager.activate(existing.id);
    return existing;
  }

  state.opening++;
  try {
    let st;
    try {
      st = await fs.promises.stat(resolved);
    } catch (err) {
      if (!quiet) toast(`Could not open ${path.basename(resolved)}: ${err.message}`, { error: true });
      return null;
    }

    if (st.isDirectory()) {
      if (!quiet) toast(`Cannot open a folder in Text Editor: ${path.basename(resolved)}`, { error: true });
      return null;
    }

    if (st.size > LARGE_FILE_BYTES) {
      const ok = await confirmDialog({
        title: `Open large file “${path.basename(resolved)}”?`,
        body: `This file is ${formatBytes(st.size)}. Opening files over 20 MB may take a moment.`,
        ok: 'Open Anyway',
      });
      if (!ok) return null;
    }

    const doc = await readBufferFromDisk(resolved);

    // Replace the initial untouched Untitled tab if it is the only tab open
    let replaceDoc = null;
    if (tabManager.docs.length === 1) {
      const only = tabManager.docs[0];
      if (!only.path && !only.dirty && only.text === '') {
        replaceDoc = only;
      }
    }

    tabManager.addDoc(doc, { activate });
    if (replaceDoc) {
      await tabManager.closeTab(replaceDoc.id, { force: true });
      if (activate) tabManager.activate(doc.id);
    }

    if (caretOffset > 0) {
      const entry = editorView.views.get(doc.id);
      if (entry) {
        const pos = Math.min(caretOffset, doc.text.length);
        entry.textarea.setSelectionRange(pos, pos);
        editorView.updateCaret(entry);
      }
    }

    session.watchDoc(doc);
    recordRecentFile(resolved);
    session.saveSession();
    toolbar.refresh();
    return doc;
  } catch (err) {
    if (!quiet) toast(`Could not read ${path.basename(resolved)}: ${err.message}`, { error: true });
    return null;
  } finally {
    state.opening--;
  }
}

async function openFiles(paths, { cwd = '', quiet = false } = {}) {
  const opened = [];
  for (let i = 0; i < paths.length; i++) {
    const raw = paths[i];
    if (!raw) continue;
    const p = path.isAbsolute(raw) ? raw : path.resolve(cwd || app.cwd || '.', raw);
    const doc = await openFile(p, { activate: i === paths.length - 1, quiet });
    if (doc) opened.push(doc);
  }
  return opened;
}

async function pickAndOpenFiles() {
  if (typeof showOpenFileDialogAsync === 'function') {
    const picked = await showOpenFileDialogAsync(FILE_DIALOG_FILTER, true);
    if (picked && picked.length) await openFiles(picked);
  } else if (typeof showOpenFileDialog === 'function') {
    const picked = showOpenFileDialog(FILE_DIALOG_FILTER, true);
    if (picked && picked.length) await openFiles(picked);
  }
}

async function saveDoc(doc, targetPath = '') {
  if (!doc) return false;
  if (doc.readOnly && !targetPath) {
    toast('This file is read-only; use Save As to save a copy', { error: true });
    return false;
  }
  let dest = targetPath || doc.path;
  if (!dest) {
    const defaultName = doc.title.includes('.') ? doc.title : `${doc.title}.txt`;
    if (typeof showSaveFileDialogAsync === 'function') {
      dest = await showSaveFileDialogAsync(FILE_DIALOG_FILTER, defaultName);
    } else if (typeof showSaveFileDialog === 'function') {
      dest = showSaveFileDialog(FILE_DIALOG_FILTER, defaultName);
    }
    if (!dest) return false;
  }

  try {
    await writeBufferToDisk(doc, dest);
    doc.readOnly = false;
    doc.binary = false;
    tabManager.updateDoc(doc);
    editorView.refreshDoc(doc);
    updateBanners(doc);
    updateStatusBar(doc);
    session.watchDoc(doc);
    await session.clearRecoveryForDoc(doc);
    recordRecentFile(doc.path);
    session.saveSession();
    toolbar.refresh();
    return true;
  } catch (err) {
    await alertDialog({
      title: `Could not save “${doc.title}”`,
      body: err.message || String(err),
      icon: 'alert',
    });
    return false;
  }
}

async function saveActive() {
  return saveDoc(tabManager.activeDoc());
}

async function saveAs(doc = tabManager.activeDoc()) {
  if (!doc) return false;
  const defaultName = doc.path ? path.basename(doc.path) : (doc.title.includes('.') ? doc.title : `${doc.title}.txt`);
  let dest = null;
  if (typeof showSaveFileDialogAsync === 'function') {
    dest = await showSaveFileDialogAsync(FILE_DIALOG_FILTER, defaultName);
  } else if (typeof showSaveFileDialog === 'function') {
    dest = showSaveFileDialog(FILE_DIALOG_FILTER, defaultName);
  }
  if (!dest) return false;
  return saveDoc(doc, dest);
}

async function saveAll() {
  let allOk = true;
  for (const doc of tabManager.docs) {
    if (doc.dirty && !doc.readOnly) {
      const ok = await saveDoc(doc);
      if (!ok) allOk = false;
    }
  }
  return allOk;
}

async function reloadActiveFromDisk() {
  const doc = tabManager.activeDoc();
  if (!doc || !doc.path) return false;
  if (doc.deletedOnDisk) {
    return saveDoc(doc);
  }
  try {
    await readBufferFromDisk(doc.path, doc);
    await session.clearRecoveryForDoc(doc);
    editorView.refreshDoc(doc);
    tabManager.updateDoc(doc);
    if (findBar.visible) {
      findBar.recompute({ selectFirst: false });
    }
    updateBanners(doc);
    updateStatusBar(doc);
    toolbar.refresh();
    return true;
  } catch (err) {
    toast(`Could not reload: ${err.message}`, { error: true });
    return false;
  }
}

function keepMineOnExternalChange() {
  const doc = tabManager.activeDoc();
  if (!doc) return;
  doc.externalChanged = false;
  doc.deletedOnDisk = false;
  doc.dirty = true;
  tabManager.updateDoc(doc);
  updateBanners(doc);
  toolbar.refresh();
}

// ---- Crash Recovery Restore / Discard -----------------------------------------

async function restoreRecovery() {
  const items = session.pendingRecovery.map((r) => r.data || r);
  session.pendingRecovery = [];
  updateRecoveryBanner();

  for (const item of items) {
    const existing = item.path ? tabManager.findByPath(item.path) : null;
    if (existing) {
      existing.eol = item.eol || existing.eol;
      existing.bom = item.bom != null ? !!item.bom : existing.bom;
      existing.setText(item.text, { markDirty: true });
      existing.dirty = true;
      editorView.refreshDoc(existing);
      tabManager.updateDoc(existing);
      tabManager.activate(existing.id);
    } else {
      let replaceDoc = null;
      if (tabManager.docs.length === 1) {
        const only = tabManager.docs[0];
        if (!only.path && !only.dirty && only.text === '') replaceDoc = only;
      }
      const doc = new DocBuffer({
        id: item.id,
        filePath: item.path || '',
        title: item.title || (item.path ? path.basename(item.path) : 'Untitled'),
        text: item.text || '',
        savedText: item.savedText || '',
        eol: item.eol || 'LF',
        bom: !!item.bom,
        dirty: true,
      });
      tabManager.addDoc(doc, { activate: true });
      if (replaceDoc && replaceDoc.id !== doc.id) {
        await tabManager.closeTab(replaceDoc.id, { force: true });
        tabManager.activate(doc.id);
      }
      if (doc.path) session.watchDoc(doc);
    }
  }
  await session.clearAllRecovery();
  toolbar.refresh();
}

async function discardRecovery() {
  await session.clearAllRecovery();
  updateRecoveryBanner();
}

function showRecentMenu(anchor) {
  const recent = Array.isArray(settings.get('recent')) ? settings.get('recent') : [];
  if (!recent.length) {
    menu.showBelow([{ label: 'No Recent Files', disabled: true }], anchor);
    return;
  }
  menu.showBelow([
    { heading: 'Recent Files' },
    ...recent.map((p) => ({
      label: path.basename(p),
      icon: 'file-text',
      keys: path.dirname(p).replace(homeDir(), '~'),
      action: () => openFile(p),
    })),
    { separator: true },
    { label: 'Clear Recent Files', icon: 'trash', action: () => settings.set('recent', []) },
  ], anchor);
}

function indentationMenuItems() {
  const insertSpaces = !!settings.get('insertSpaces');
  const tabWidth = Number(settings.get('tabWidth')) || 4;
  return [
    { heading: 'Indentation' },
    { label: 'Indent Using Spaces', checked: insertSpaces, action: () => settings.set('insertSpaces', true) },
    { label: 'Indent Using Tabs', checked: !insertSpaces, action: () => settings.set('insertSpaces', false) },
    { separator: true },
    { heading: 'Tab Width' },
    ...[2, 4, 8].map((w) => ({
      label: `${w} Spaces`,
      checked: tabWidth === w,
      action: () => settings.set('tabWidth', w),
    })),
  ];
}

function showIndentationMenu(anchor) {
  menu.showBelow(indentationMenuItems(), anchor);
}

function showViewMenu(anchor) {
  menu.showBelow([
    commands.item('toggle-wrap'),
    commands.item('toggle-monospace'),
    commands.item('toggle-statusbar'),
    { separator: true },
    commands.item('zoom-in'),
    commands.item('zoom-out'),
    commands.item('zoom-reset'),
    { separator: true },
    { label: 'Indentation…', icon: 'align-left', submenu: indentationMenuItems() },
    { separator: true },
    commands.item('save-all'),
    commands.item('new-window'),
  ], anchor);
}

// ---- Initial tab & Launch -----------------------------------------------------

newTab();
applyAllViewSettings();

async function handleLaunch({ argv = [], cwd = '', first = false } = {}) {
  if (argv.includes('--new-window') && !first) { app.newWindow(); return; }
  const fileArgs = argv.filter((a) => a && !a.startsWith('-'));
  if (fileArgs.length > 0) {
    await openFiles(fileArgs, { cwd });
  } else if (first) {
    const saved = settings.get('session');
    if (saved && Array.isArray(saved.files) && saved.files.length > 0) {
      for (const item of saved.files) {
        if (item && item.path) {
          await openFile(item.path, {
            activate: item.path === saved.activePath,
            quiet: true,
            caretOffset: item.caret || 0,
          });
        }
      }
    }
  }
  if (first) {
    await session.checkRecovery();
    state.ready = true;
  }
}

app.onLaunch((info) => handleLaunch(info));

app.expose({
  state, tabs: tabManager, editorView, findBar, session,
  activeDoc: () => tabManager.activeDoc(),
  activeTextarea: () => editorView.activeTextarea(),
  newTab, openFile, openFiles, saveDoc, saveActive, saveAs, saveAll,
  closeTab: (id, opts) => tabManager.closeTab(id, opts),
  goToLine: (line) => editorView.goToLine(tabManager.activeDoc(), line),
  reloadActiveFromDisk, keepMineOnExternalChange,
  checkRecovery: () => session.checkRecovery(),
  restoreRecovery, discardRecovery,
  flushAutosave: () => session.flushAutosave(),
  setAutosaveDelay: (ms) => session.setAutosaveDelay(ms),
  triggerLaunch: (info) => handleLaunch(info),
});
