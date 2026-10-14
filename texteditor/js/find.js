/**
 * Find & Replace bar and Go to Line dialog for Text Editor.
 *
 * Supports:
 *  - Incremental search with match counter ("1 of 3" / "No results")
 *  - Next (Enter / F3) and Previous (Shift+Enter / Shift+F3) navigation
 *  - Match Case (Aa), Whole Word (\b), and Regular Expression (.*) toggles
 *  - Replace and Replace All with regex capture-group expansion ($1, $2, $&)
 *  - Escape closes the bar and restores focus to the active <textarea>
 */

import { h } from '/lib/dom.js';
import { promptDialog } from '/lib/dialog.js';

export class FindBar {
  constructor({ getActiveDoc, editorView, onDocMutated }) {
    this.getActiveDoc = getActiveDoc;
    this.editorView = editorView;
    this.onDocMutated = onDocMutated;

    this.visible = false;
    this.replaceMode = false;
    this.matchCase = false;
    this.wholeWord = false;
    this.regex = false;

    this.matches = [];
    this.activeIndex = -1;

    this.findInput = h('input.field.te-find-input', {
      type: 'text',
      placeholder: 'Find…',
      'aria-label': 'Find',
    });

    this.replaceInput = h('input.field.te-find-input', {
      type: 'text',
      placeholder: 'Replace with…',
      'aria-label': 'Replace with',
    });

    this.caseBtn = h('button.te-toggle-btn', {
      text: 'Aa',
      'data-tip': 'Match Case',
      'aria-label': 'Match Case',
      onclick: () => this.toggleOption('matchCase'),
    });

    this.wordBtn = h('button.te-toggle-btn', {
      text: '\\b',
      'data-tip': 'Whole Word',
      'aria-label': 'Whole Word',
      onclick: () => this.toggleOption('wholeWord'),
    });

    this.regexBtn = h('button.te-toggle-btn', {
      text: '.*',
      'data-tip': 'Regular Expression',
      'aria-label': 'Regular Expression',
      onclick: () => this.toggleOption('regex'),
    });

    this.countEl = h('span.te-find-count.num', '');

    this.prevBtn = h('button.icon-btn.small', {
      icon: 'chevron-up',
      'data-tip': 'Previous Match',
      'aria-label': 'Previous Match',
      onclick: () => this.findPrev(),
    });

    this.nextBtn = h('button.icon-btn.small', {
      icon: 'chevron-down',
      'data-tip': 'Next Match',
      'aria-label': 'Next Match',
      onclick: () => this.findNext(),
    });

    this.closeBtn = h('button.icon-btn.small', {
      icon: 'x',
      'data-tip': 'Close (Escape)',
      'aria-label': 'Close Find',
      onclick: () => this.close(),
    });

    this.replaceOneBtn = h('button.btn.small', {
      text: 'Replace',
      onclick: () => this.replaceOne(),
    });

    this.replaceAllBtn = h('button.btn.small', {
      text: 'Replace All',
      onclick: () => this.replaceAll(),
    });

    this.findRow = h('div.te-find-row',
      this.findInput,
      h('div.te-find-toggles', this.caseBtn, this.wordBtn, this.regexBtn),
      this.prevBtn,
      this.nextBtn,
      this.countEl,
      h('div.toolbar-spacer'),
      this.closeBtn,
    );

    this.replaceRow = h('div.te-find-row.te-replace-row.hidden',
      this.replaceInput,
      this.replaceOneBtn,
      this.replaceAllBtn,
    );

    this.el = h('div.te-findbar.hidden', this.findRow, this.replaceRow);

    this.findInput.addEventListener('input', () => {
      this.recompute({ selectFirst: true, focusEditor: false });
    });

    this.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) this.findPrev({ focusEditor: false });
        else this.findNext({ focusEditor: false });
      }
    });

    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.replaceOne();
      }
    });
  }

  toggleOption(prop) {
    this[prop] = !this[prop];
    this.caseBtn.classList.toggle('active', this.matchCase);
    this.wordBtn.classList.toggle('active', this.wholeWord);
    this.regexBtn.classList.toggle('active', this.regex);
    this.recompute({ selectFirst: true, focusEditor: false });
  }

  open({ replace = false } = {}) {
    this.visible = true;
    this.replaceMode = !!replace;
    this.el.classList.remove('hidden');
    this.replaceRow.classList.toggle('hidden', !this.replaceMode);

    // If text is currently selected in the editor (single line), seed the find query
    const ta = this.editorView.activeTextarea();
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n')) {
        this.findInput.value = sel;
      }
    }

    this.recompute({ selectFirst: true, focusEditor: false });
    this.findInput.focus();
    if (this.findInput.select) this.findInput.select();
  }

  close() {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.add('hidden');
    this.editorView.focusActive();
  }

  setQuery(query, { replaceWith, matchCase, wholeWord, regex } = {}) {
    if (typeof matchCase === 'boolean') this.matchCase = matchCase;
    if (typeof wholeWord === 'boolean') this.wholeWord = wholeWord;
    if (typeof regex === 'boolean') this.regex = regex;
    this.caseBtn.classList.toggle('active', this.matchCase);
    this.wordBtn.classList.toggle('active', this.wholeWord);
    this.regexBtn.classList.toggle('active', this.regex);
    if (query != null) this.findInput.value = query;
    if (replaceWith != null) this.replaceInput.value = replaceWith;
    this.recompute({ selectFirst: true, focusEditor: false });
  }

  buildRegExp() {
    const raw = this.findInput.value;
    if (!raw) return null;
    let pattern = this.regex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (this.wholeWord) {
      pattern = `\\b(?:${pattern})\\b`;
    }
    const flags = this.matchCase ? 'g' : 'gi';
    try {
      return new RegExp(pattern, flags);
    } catch (_) {
      return null;
    }
  }

  recompute({ selectFirst = false, focusEditor = false } = {}) {
    const doc = this.getActiveDoc();
    this.matches = [];
    this.activeIndex = -1;
    this.findInput.classList.remove('invalid');

    const query = this.findInput.value;
    if (!doc || !query) {
      this.countEl.textContent = '';
      this.countEl.classList.remove('empty');
      return;
    }

    const re = this.buildRegExp();
    if (!re) {
      this.findInput.classList.add('invalid');
      this.countEl.textContent = 'Invalid regex';
      this.countEl.classList.add('empty');
      return;
    }

    const text = doc.text;
    let usedNativeSearch = false;
    // Use bro.search.Regex.findAll for O(N) single-pass match finding on ASCII texts
    if (typeof bro !== 'undefined' && bro.search && typeof bro.search.Regex === 'function') {
      try {
        // bro.search.Regex.findAll returns byte offsets; on ASCII strings (or when
        // verified), byte offsets equal UTF-16 code unit indices.
        if (!/[^\x00-\x7F]/.test(text)) {
          const nativeRe = new bro.search.Regex(re.source, !this.matchCase);
          const hits = nativeRe.findAll(text);
          for (let i = 0; i < hits.length && i < 100000; i++) {
            this.matches.push({ start: hits[i].start, end: hits[i].end });
          }
          usedNativeSearch = true;
        }
      } catch (_) {
        usedNativeSearch = false;
      }
    }

    if (!usedNativeSearch) {
      let m;
      while ((m = re.exec(text)) !== null) {
        this.matches.push({
          start: m.index,
          end: m.index + m[0].length,
        });
        if (m[0].length === 0) {
          re.lastIndex++;
          if (re.lastIndex > text.length) break;
        }
        if (this.matches.length >= 100000) break;
      }
    }

    if (this.matches.length === 0) {
      this.countEl.textContent = 'No results';
      this.countEl.classList.add('empty');
      return;
    }

    this.countEl.classList.remove('empty');
    if (selectFirst) {
      this.activeIndex = 0;
      this.applyMatchSelection(this.matches[0], { focusEditor });
    } else {
      this.activeIndex = Math.min(Math.max(0, this.activeIndex), this.matches.length - 1);
    }
    this.updateCountText();
  }

  updateCountText() {
    if (!this.matches.length) {
      this.countEl.textContent = this.findInput.value ? 'No results' : '';
      return;
    }
    const idx = this.activeIndex >= 0 ? this.activeIndex + 1 : 1;
    this.countEl.textContent = `${idx} of ${this.matches.length}`;
  }

  applyMatchSelection(match, { focusEditor = false } = {}) {
    if (!match) return;
    const entry = this.editorView.activeEntry();
    if (!entry) return;
    const { textarea } = entry;
    const prevFocus = document.activeElement;
    textarea.setSelectionRange(match.start, match.end);
    this.editorView.updateCaret(entry);
    if (focusEditor) {
      textarea.focus();
    } else if (prevFocus && prevFocus !== textarea && prevFocus.focus) {
      prevFocus.focus();
    }
  }

  findNext({ focusEditor = false } = {}) {
    if (!this.matches.length) {
      this.recompute({ selectFirst: true, focusEditor });
      return null;
    }
    const entry = this.editorView.activeEntry();
    const ta = entry ? entry.textarea : null;
    const cur = this.matches[this.activeIndex];
    if (ta && cur && (ta.selectionStart !== cur.start || ta.selectionEnd !== cur.end)) {
      this.applyMatchSelection(cur, { focusEditor });
      this.updateCountText();
      return cur;
    }
    this.activeIndex = (this.activeIndex + 1) % this.matches.length;
    const match = this.matches[this.activeIndex];
    this.applyMatchSelection(match, { focusEditor });
    this.updateCountText();
    return match;
  }

  findPrev({ focusEditor = false } = {}) {
    if (!this.matches.length) {
      this.recompute({ selectFirst: true, focusEditor });
      return null;
    }
    this.activeIndex = (this.activeIndex - 1 + this.matches.length) % this.matches.length;
    const match = this.matches[this.activeIndex];
    this.applyMatchSelection(match, { focusEditor });
    this.updateCountText();
    return match;
  }

  replaceOne() {
    const doc = this.getActiveDoc();
    if (!doc || doc.readOnly) return 0;
    if (!this.matches.length) this.recompute({ selectFirst: true });
    if (!this.matches.length) return 0;

    const idx = Math.max(0, this.activeIndex);
    const match = this.matches[idx];
    const re = this.buildRegExp();
    if (!re) return 0;

    const singleFlags = this.matchCase ? '' : 'i';
    const singleRe = new RegExp(re.source, singleFlags);
    const matchedSlice = doc.text.slice(match.start, match.end);
    const replacedSlice = this.regex
      ? matchedSlice.replace(singleRe, this.replaceInput.value)
      : this.replaceInput.value;

    const nextText = doc.text.slice(0, match.start) + replacedSlice + doc.text.slice(match.end);
    doc.setText(nextText, { markDirty: true });
    this.editorView.refreshDoc(doc);

    const nextCaret = match.start + replacedSlice.length;
    const ta = this.editorView.activeTextarea();
    if (ta) ta.setSelectionRange(nextCaret, nextCaret);

    if (this.onDocMutated) this.onDocMutated(doc);
    this.recompute({ selectFirst: false });
    if (this.matches.length) {
      this.activeIndex = Math.min(idx, this.matches.length - 1);
      this.applyMatchSelection(this.matches[this.activeIndex]);
      this.updateCountText();
    }
    return 1;
  }

  replaceAll() {
    const doc = this.getActiveDoc();
    if (!doc || doc.readOnly) return 0;
    if (!this.matches.length) this.recompute({ selectFirst: false });
    const count = this.matches.length;
    if (!count) return 0;

    const re = this.buildRegExp();
    if (!re) return 0;

    const replacement = this.replaceInput.value;
    const safeReplacement = this.regex
      ? replacement
      : replacement.replace(/\$/g, '$$$$');
    const nextText = doc.text.replace(re, safeReplacement);

    doc.setText(nextText, { markDirty: true });
    this.editorView.refreshDoc(doc);
    if (this.onDocMutated) this.onDocMutated(doc);
    this.recompute({ selectFirst: false });
    return count;
  }
}

/**
 * Prompt for a line number (1..doc.lineCount) and jump the caret to the start of that line.
 */
export async function promptGoToLine(doc, editorView) {
  if (!doc) return false;
  const maxLine = Math.max(1, doc.lineCount);
  const answer = await promptDialog({
    title: 'Go to Line',
    body: `Enter a line number between 1 and ${maxLine}:`,
    value: String(doc.caret.line || 1),
    ok: 'Go',
    validate: (val) => {
      const n = Number(val.trim());
      if (!Number.isInteger(n) || n < 1 || n > maxLine) {
        return `Enter a number from 1 to ${maxLine}`;
      }
      return '';
    },
  });
  if (answer == null) return false;
  const line = Number(answer.trim());
  return editorView.goToLine(doc, line);
}
