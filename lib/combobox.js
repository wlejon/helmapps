/**
 * Combobox: a text field that suggests as you type. The suggestions come
 * from a function of the text, so any matching works (prefixes, words,
 * typos) over any number of choices; free text is always allowed, the
 * caller decides what a commit with no suggestion means.
 *
 *   import { Combobox } from '/lib/combobox.js';
 *   const cb = new Combobox({
 *     value: 'Mallard', placeholder: 'Name',
 *     suggest: (text) => index.search(text).map((e) => ({ label: e.label, detail: e.scientific, value: e, strong: e.score >= 80 })),
 *     onCommit: ({ item, text, shiftKey }) => save(item ? item.value : text),
 *     onCancel: () => stopEditing(),
 *   });
 *   row.append(cb.el);
 *   cb.focus();               // the text selected, the suggestions for it shown
 *
 * Suggestions: [{ label, detail?, value?, strong? }], best first, shown in a
 * list under the field (in the page's top layer, so a scrolling panel never
 * clips it). With `inline: true` the list is instead part of the field's own
 * element, in the flow under the input: what follows it in its container
 * moves down rather than being covered (a popover whose buttons sit under
 * the field), and `onLayout` is called each time the list opens, changes or
 * closes so the container can place itself again; it stays open when the
 * field loses the focus (the container's own close takes it). The first is highlighted
 * when it is `strong` (or when
 * `preselect(items, text)` says so), so Enter takes it; otherwise Enter
 * commits the text as typed with `item` null.
 *
 * Keys: Up / Down move the highlight (to none past either end), Enter
 * commits (onCommit gets shiftKey, so Shift+Enter can mean "the other
 * way"), Tab puts the highlighted suggestion's label in the field and keeps
 * editing, Escape cancels. A click on a suggestion commits it. Leaving the
 * field calls onBlur (default: nothing; the list closes). The keys it
 * handles never reach the app's shortcuts.
 */

import { h } from './dom.js';

export class Combobox {
  /**
   * @param {object} o
   * @param {string} [o.value]
   * @param {string} [o.placeholder]
   * @param {(text: string) => Array<{label: string, detail?: string, value?: any, strong?: boolean}>} o.suggest
   * @param {(items: object[], text: string) => boolean} [o.preselect]  default: items[0].strong
   * @param {(c: {item: object|null, text: string, shiftKey: boolean}) => void} [o.onCommit]
   * @param {() => void} [o.onCancel]
   * @param {() => void} [o.onBlur]
   * @param {(text: string) => void} [o.onInput]
   * @param {string} [o.label]       the field's accessible name
   * @param {boolean} [o.inline]     the list in the field's own flow, not floating over the page
   * @param {() => void} [o.onLayout] inline: the list opened, changed or closed
   */
  constructor({ value = '', placeholder = '', suggest, preselect = null, onCommit = null, onCancel = null,
    onBlur = null, onInput = null, label = '', inline = false, onLayout = null } = {}) {
    this.inline = !!inline;
    this.onLayout = onLayout;
    this.suggest = suggest || (() => []);
    this.preselect = preselect || ((items) => !!(items[0] && items[0].strong));
    this.onCommit = onCommit;
    this.onCancel = onCancel;
    this.onBlur = onBlur;
    this.onInput = onInput;
    this.items = [];
    this.active = -1;
    this.done = false;
    this.input = h('input.field.combobox-input', {
      type: 'text', placeholder, autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-label': label || placeholder || null,
    });
    this.input.value = value;
    this.list = h('div.menu.combobox-list.hidden', { role: 'listbox' });
    this.el = this.inline ? h('div.combobox.inline', this.input, this.list) : h('div.combobox', this.input);
    if (this.inline) this.list.classList.add('inline');
    this.input.addEventListener('input', () => {
      this.refresh();
      if (this.onInput) this.onInput(this.input.value);
    });
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.input.addEventListener('blur', () => {
      // An inline list stays: closing it would move what is under it while
      // the press that took the focus is still on its way to a click there.
      if (!this.inline) this.close();
      if (!this.done && this.onBlur) this.onBlur();
    });
  }

  /** The text in the field. */
  get value() { return this.input.value; }

  /** Put text in the field (no onInput) and suggest for it. */
  set(text) {
    this.input.value = text;
    this.refresh();
  }

  /** Focus the field with its text selected, and show the suggestions for it. */
  focus({ select = true } = {}) {
    this.input.focus();
    if (select && this.input.value) this.input.setSelectionRange(0, this.input.value.length);
    this.refresh();
  }

  /** The suggestion Enter takes now, or null. */
  get highlighted() { return this.active >= 0 ? this.items[this.active] || null : null; }

  /** Suggest again for the field's text. */
  refresh() {
    const text = this.input.value;
    this.items = text.trim() ? (this.suggest(text) || []).filter(Boolean) : [];
    this.active = this.items.length && this.preselect(this.items, text) ? 0 : -1;
    this.render();
  }

  render() {
    if (!this.items.length || !this.input.isConnected) { this.close(); return; }
    this.list.replaceChildren(...this.items.map((it, i) => {
      const row = h('div.menu-item.combobox-item', { role: 'option' },
        h('span.menu-text', it.label),
        it.detail ? h('span.combobox-detail', it.detail) : null);
      if (i === this.active) row.classList.add('active');
      row.addEventListener('pointerenter', () => this.highlight(i));
      // Keep the focus in the field: a click on a row must not blur it first.
      row.addEventListener('pointerdown', (e) => e.preventDefault());
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.commit(this.items[i], e.shiftKey);
      });
      return row;
    }));
    this.input.setAttribute('aria-expanded', 'true');
    if (this.inline) {
      this.list.classList.remove('hidden');
      if (this.onLayout) this.onLayout();
      return;
    }
    if (!this.list.isConnected) document.body.appendChild(this.list);
    this.list.classList.remove('hidden');
    this.place();
  }

  /** Under the field, as wide as it (at least 240 px), above it when there is no room below. */
  place() {
    const r = this.input.getBoundingClientRect();
    const w = Math.max(240, r.width);
    this.list.style.minWidth = `${Math.round(w)}px`;
    this.list.style.maxWidth = `${Math.round(Math.max(w, 380))}px`;
    const lr = this.list.getBoundingClientRect();
    const left = Math.max(6, Math.min(r.left, window.innerWidth - lr.width - 6));
    const below = r.bottom + 4;
    const top = below + lr.height > window.innerHeight - 6 && r.top - 4 - lr.height > 6 ? r.top - 4 - lr.height : below;
    this.list.style.left = `${Math.round(left)}px`;
    this.list.style.top = `${Math.round(top)}px`;
  }

  highlight(i) {
    this.active = i;
    Array.from(this.list.children).forEach((row, k) => row.classList.toggle('active', k === i));
  }

  close() {
    const was = !this.list.classList.contains('hidden');
    this.list.classList.add('hidden');
    this.input.setAttribute('aria-expanded', 'false');
    if (was && this.inline && !this.done && this.onLayout) this.onLayout();
  }

  /** Take the list out of the page (the field goes with its own element). */
  destroy() {
    this.done = true;
    this.close();
    if (!this.inline) this.list.remove();
  }

  commit(item, shiftKey = false) {
    if (this.done) return;
    this.done = true;
    const text = this.input.value;
    this.destroy();
    if (this.onCommit) this.onCommit({ item: item || null, text, shiftKey: !!shiftKey });
  }

  cancel() {
    if (this.done) return;
    this.done = true;
    this.destroy();
    if (this.onCancel) this.onCancel();
  }

  key(e) {
    const n = this.items.length;
    let handled = true;
    if (e.key === 'ArrowDown') {
      if (this.list.classList.contains('hidden') && n) this.render();
      if (n) this.highlight(this.active + 1 >= n ? -1 : this.active + 1);
    } else if (e.key === 'ArrowUp') {
      if (n) this.highlight(this.active <= -1 ? n - 1 : this.active - 1);
    } else if (e.key === 'Enter') {
      this.commit(this.highlighted, e.shiftKey);
    } else if (e.key === 'Escape') {
      this.cancel();
    } else if (e.key === 'Tab' && this.highlighted && !e.shiftKey) {
      this.input.value = this.highlighted.label;
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
      this.refresh();
      if (this.onInput) this.onInput(this.input.value);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}
