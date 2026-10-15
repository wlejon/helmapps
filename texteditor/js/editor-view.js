/**
 * EditorView: manages the per-document <textarea> instances and synchronized
 * line-number gutter.
 *
 * Uses one native <textarea> per open document as required by briefs/texteditor.md
 * so native typing, selection, IME, clipboard, and per-document undo/redo stacks
 * are preserved across tab switches.
 */

import { h, clamp } from '/lib/dom.js';
import { lineColAt, offsetOfLine } from './buffer.js';

export class EditorView {
  constructor({ settings, onBufferInput, onCaretChange }) {
    this.settings = settings;
    this.onBufferInput = onBufferInput;
    this.onCaretChange = onCaretChange;
    this.el = h('div.te-stage');
    this.views = new Map(); // doc.id -> { root, gutter, gutterInner, textarea, renderedKey }
    this.activeId = null;
  }

  buildNumberRange(firstLine, lastLine) {
    const out = [];
    for (let i = firstLine; i <= lastLine; i++) out.push(String(i));
    return out.join('\n');
  }

  createDocView(doc) {
    if (this.views.has(doc.id)) return this.views.get(doc.id);

    const gutterInner = h('div.te-gutter-inner.num', '1');
    const gutter = h('div.te-gutter', { 'aria-hidden': 'true' }, gutterInner);
    const textarea = h('textarea.te-textarea.selectable', {
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
    });

    textarea.value = doc.text;
    textarea.readOnly = !!doc.readOnly;

    const root = h('div.te-doc-view.hidden', gutter, textarea);
    const entry = {
      doc,
      root,
      gutter,
      gutterInner,
      textarea,
      lineHeightPx: 22,
      renderedKey: '',
    };

    textarea.addEventListener('input', () => {
      if (doc.readOnly) {
        if (textarea.value !== doc.text) textarea.value = doc.text;
        return;
      }
      doc.setText(textarea.value, { markDirty: true });
      this.syncGutter(entry);
      this.updateCaret(entry);
      if (this.onBufferInput) this.onBufferInput(doc);
    });

    textarea.addEventListener('scroll', () => {
      this.syncGutter(entry);
    });

    const onSelectOrMove = () => {
      this.updateCaret(entry);
    };
    textarea.addEventListener('keyup', onSelectOrMove);
    textarea.addEventListener('mouseup', onSelectOrMove);
    textarea.addEventListener('click', onSelectOrMove);
    textarea.addEventListener('select', onSelectOrMove);
    textarea.addEventListener('focus', onSelectOrMove);

    textarea.addEventListener('keydown', (e) => this.onKeyDown(e, entry));

    this.views.set(doc.id, entry);
    this.el.appendChild(root);
    this.applySettingsToEntry(entry);
    this.syncGutter(entry);
    return entry;
  }

  onKeyDown(e, entry) {
    const { doc, textarea } = entry;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      if (doc.readOnly) return;
      const insertSpaces = this.settings.get('insertSpaces');
      const tabWidth = clamp(Number(this.settings.get('tabWidth')) || 4, 1, 16);
      const unit = insertSpaces ? ' '.repeat(tabWidth) : '\t';
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const val = textarea.value;

      if (!e.shiftKey && start === end) {
        const expected = val.slice(0, start) + unit + val.slice(end);
        let inserted = false;
        if (typeof document.execCommand === 'function') {
          try {
            textarea.focus();
            inserted = document.execCommand('insertText', false, unit) && textarea.value === expected;
          } catch (_) {
            inserted = false;
          }
        }
        if (!inserted) {
          textarea.value = expected;
        }
        const pos = start + unit.length;
        textarea.setSelectionRange(pos, pos);
      } else {
        const lineStart = val.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const block = val.slice(lineStart, end);
        const lines = block.split('\n');
        let deltaFirst = 0;
        let deltaTotal = 0;
        const transformed = lines.map((line, i) => {
          if (!e.shiftKey) {
            if (i === 0) deltaFirst = unit.length;
            deltaTotal += unit.length;
            return unit + line;
          }
          let removed = 0;
          if (line.startsWith('\t')) {
            removed = 1;
          } else {
            while (removed < tabWidth && line[removed] === ' ') removed++;
          }
          if (i === 0) deltaFirst = -removed;
          deltaTotal -= removed;
          return line.slice(removed);
        }).join('\n');

        const expected = val.slice(0, lineStart) + transformed + val.slice(end);
        let inserted = false;
        if (typeof document.execCommand === 'function') {
          try {
            textarea.focus();
            textarea.setSelectionRange(lineStart, end);
            inserted = document.execCommand('insertText', false, transformed) && textarea.value === expected;
          } catch (_) {
            inserted = false;
          }
        }
        if (!inserted) {
          textarea.value = expected;
        }
        const newStart = Math.max(lineStart, start + deltaFirst);
        const newEnd = Math.max(newStart, end + deltaTotal);
        textarea.setSelectionRange(newStart, newEnd);
      }

      doc.setText(textarea.value, { markDirty: true });
      this.syncGutter(entry);
      this.updateCaret(entry);
      if (this.onBufferInput) this.onBufferInput(doc);
    }
  }

  syncGutter(entry) {
    const { doc, gutter, gutterInner, textarea } = entry;
    const totalLines = Math.max(1, doc.lineCount);
    const lh = entry.lineHeightPx || 22;
    const scrollTop = textarea.scrollTop || 0;
    const firstLine = Math.max(1, Math.floor(scrollTop / lh) - 5);
    const lastLine = Math.min(totalLines, firstLine + 80);
    const key = `${firstLine}:${lastLine}:${totalLines}`;
    if (entry.renderedKey !== key) {
      entry.renderedKey = key;
      const digits = Math.max(3, String(totalLines).length);
      gutter.style.minWidth = `${digits * 9 + 24}px`;
      gutterInner.textContent = this.buildNumberRange(firstLine, lastLine);
    }
    const offsetY = (firstLine - 1) * lh - scrollTop;
    gutterInner.style.transform = `translateY(${offsetY}px)`;
  }

  updateCaret(entry) {
    const { doc, textarea } = entry;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    if (doc._cachedCaretOffset !== start || doc._cachedCaretLen !== doc.text.length) {
      const lc = lineColAt(doc.text, start);
      doc._cachedCaretOffset = start;
      doc._cachedCaretLen = doc.text.length;
      doc.caret = { start, end, line: lc.line, col: lc.col };
    } else {
      doc.caret.start = start;
      doc.caret.end = end;
    }
    if (this.onCaretChange && this.activeId === doc.id) {
      this.onCaretChange(doc);
    }
  }

  showDoc(doc, { focus = true } = {}) {
    const entry = this.createDocView(doc);
    this.activeId = doc.id;
    for (const [id, v] of this.views) {
      v.root.classList.toggle('hidden', id !== doc.id);
    }
    if (entry.textarea.value !== doc.text) {
      entry.textarea.value = doc.text;
    }
    entry.textarea.readOnly = !!doc.readOnly;
    this.syncGutter(entry);
    this.applySettingsToEntry(entry);
    this.updateCaret(entry);
    if (focus) entry.textarea.focus();
    return entry;
  }

  refreshDoc(doc) {
    const entry = this.views.get(doc.id);
    if (!entry) return;
    const prevStart = entry.textarea.selectionStart || 0;
    const prevEnd = entry.textarea.selectionEnd || 0;
    if (entry.textarea.value !== doc.text) {
      entry.textarea.value = doc.text;
      const maxPos = doc.text.length;
      entry.textarea.setSelectionRange(Math.min(prevStart, maxPos), Math.min(prevEnd, maxPos));
    }
    entry.textarea.readOnly = !!doc.readOnly;
    this.syncGutter(entry);
    this.updateCaret(entry);
  }

  removeDoc(docId) {
    const entry = this.views.get(docId);
    if (!entry) return;
    entry.root.remove();
    this.views.delete(docId);
    if (this.activeId === docId) this.activeId = null;
  }

  activeEntry() {
    return this.activeId != null ? (this.views.get(this.activeId) || null) : null;
  }

  activeTextarea() {
    const e = this.activeEntry();
    return e ? e.textarea : null;
  }

  focusActive() {
    const ta = this.activeTextarea();
    if (ta) ta.focus();
  }

  goToLine(doc, lineNumber) {
    const entry = this.views.get(doc.id);
    if (!entry) return false;
    const offset = offsetOfLine(doc.text, lineNumber);
    entry.textarea.focus();
    entry.textarea.setSelectionRange(offset, offset);
    this.syncGutter(entry);
    this.updateCaret(entry);
    return true;
  }

  applySettingsToEntry(entry) {
    const wrap = !!this.settings.get('wordWrap');
    const fontSize = clamp(Number(this.settings.get('fontSize')) || 14, 10, 32);
    const mono = this.settings.get('monospace') !== false;
    const tabWidth = clamp(Number(this.settings.get('tabWidth')) || 4, 1, 16);
    const fontFamily = mono ? 'var(--font-mono)' : 'var(--font-ui)';
    const lineHeight = `${Math.round(fontSize * 1.55)}px`;

    entry.textarea.classList.toggle('wrap', wrap);
    entry.textarea.classList.toggle('nowrap', !wrap);
    entry.textarea.style.fontFamily = fontFamily;
    entry.textarea.style.fontSize = `${fontSize}px`;
    entry.textarea.style.lineHeight = lineHeight;
    entry.textarea.style.tabSize = String(tabWidth);

    // Brief states: no line numbers in wrap mode
    entry.gutter.classList.toggle('hidden', wrap);
    entry.gutter.style.fontFamily = fontFamily;
    entry.gutter.style.fontSize = `${fontSize}px`;
    entry.gutter.style.lineHeight = lineHeight;
  }

  applySettings() {
    for (const entry of this.views.values()) {
      this.applySettingsToEntry(entry);
    }
  }
}
