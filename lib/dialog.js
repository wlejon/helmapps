/**
 * Dialogs, in the page and promise-based. Use these, not the global
 * alert() / confirm() / prompt(): those block the whole app (headless answers
 * them from setDialogAnswer) and look like nothing else in helm.
 *
 *   import { confirmDialog, promptDialog, alertDialog, Dialog } from '/lib/dialog.js';
 *   if (await confirmDialog({ title: 'Move 3 items to the Trash?', body: 'You can restore them from the Trash.',
 *                             ok: 'Move to Trash', danger: true })) trash();
 *   const name = await promptDialog({ title: 'New Folder', value: 'Untitled Folder', ok: 'Create',
 *                                     validate: (v) => v.includes('/') ? 'No slashes' : '' });
 *   await alertDialog({ title: 'Could not open', body: err.message, icon: 'alert' });
 *
 *   // Your own content:
 *   const d = new Dialog({ title: 'Properties', icon: 'info', wide: true });
 *   d.body.append(...rows);
 *   d.addButton('Close', { primary: true, value: true });
 *   const result = await d.open();          // the clicked button's value; null on Escape
 *
 * Enter presses the primary button, Escape cancels. One dialog at a time is
 * the expected use; a second opens above the first. Dialog.current is the
 * top one (tests use it).
 */

import { h } from './dom.js';
import { icon } from './icons.js';

const stack = [];

export class Dialog {
  /**
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.icon]     a glyph beside the title
   * @param {boolean} [o.danger]  red glyph (a destructive question)
   * @param {boolean} [o.wide]
   * @param {string|Node} [o.body]
   */
  constructor({ title, icon: iconName, danger = false, wide = false, body } = {}) {
    this.result = undefined;
    this.resolve = null;
    this.buttons = [];
    this.body = h('div.dialog-body');
    if (typeof body === 'string') this.body.appendChild(h('p', body));
    else if (body) this.body.appendChild(body);
    this.actions = h('div.dialog-actions');
    this.el = h('div.dialog', { role: 'dialog', tabindex: '-1' },
      h('div.dialog-head',
        iconName ? h('div.dialog-glyph', icon(iconName)) : null,
        h('div.dialog-title', title || '')),
      this.body,
      this.actions);
    if (danger) this.el.classList.add('danger');
    if (wide) this.el.classList.add('wide');
    this.scrim = h('div.dialog-scrim', this.el);
    this.scrim.addEventListener('pointerdown', (e) => {
      if (e.target === this.scrim) this.close(null);
    });
    this.onKey = (e) => {
      if (Dialog.current !== this) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(null);
      } else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) {
        const primary = this.buttons.find((b) => b.primary && !b.el.disabled);
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          primary.el.click();
        }
      }
    };
  }

  /**
   * A button. Clicking it closes the dialog with `value` unless `onClick`
   * returns false (keep it open, e.g. validation failed).
   */
  addButton(label, { primary = false, danger = false, value = label, onClick } = {}) {
    const el = h('button.btn', label);
    if (primary) el.classList.add(danger ? 'danger' : 'primary');
    else el.classList.add('ghost');
    el.addEventListener('click', () => {
      if (onClick && onClick() === false) return;
      this.close(value);
    });
    this.buttons.push({ el, primary, value });
    this.actions.appendChild(el);
    return el;
  }

  /** Show it; resolves with the chosen value (null when cancelled). */
  open() {
    document.body.appendChild(this.scrim);
    stack.push(this);
    window.addEventListener('keydown', this.onKey, true);
    this.returnFocus = document.activeElement;
    const first = this.el.querySelector('input, textarea, select') ||
      (this.buttons.find((b) => b.primary) || {}).el || this.el;
    first.focus();
    if (first.select) first.select();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  close(value) {
    if (!this.resolve) return;
    window.removeEventListener('keydown', this.onKey, true);
    this.scrim.remove();
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    const back = this.returnFocus;
    if (back && back.focus && document.contains(back)) back.focus();
    const resolve = this.resolve;
    this.resolve = null;
    this.result = value;
    resolve(value);
  }

  /** The topmost open dialog, or null. */
  static get current() {
    return stack.length ? stack[stack.length - 1] : null;
  }
}

/** Yes/no. Resolves true for OK, false for Cancel or Escape. */
export async function confirmDialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, icon: iconName } = {}) {
  const d = new Dialog({ title, body, danger, icon: iconName || (danger ? 'alert' : null) });
  d.addButton(cancel, { value: false });
  d.addButton(ok, { primary: true, danger, value: true });
  return (await d.open()) === true;
}

/** A message with one button. */
export async function alertDialog({ title, body, ok = 'OK', icon: iconName = 'info' } = {}) {
  const d = new Dialog({ title, body, icon: iconName });
  d.addButton(ok, { primary: true, value: true });
  await d.open();
}

/**
 * One line of text. Resolves with the text, or null when cancelled.
 * validate(text) answers '' when fine, else the message to show.
 */
export async function promptDialog({ title, body, value = '', placeholder = '', ok = 'OK', cancel = 'Cancel',
  validate, selectStem = false } = {}) {
  const d = new Dialog({ title, body });
  const input = h('input.field', { type: 'text', value, placeholder });
  const msg = h('div.dim', { style: { fontSize: 'var(--fs-cap)', minHeight: '16px' } });
  d.body.append(input, msg);
  const check = () => {
    const err = validate ? (validate(input.value) || '') : '';
    msg.textContent = err;
    input.classList.toggle('invalid', !!err);
    okBtn.disabled = !!err || input.value.trim() === '';
    return !err;
  };
  d.addButton(cancel, { value: null });
  const okBtn = d.addButton(ok, { primary: true, value: undefined, onClick: () => check() });
  input.addEventListener('input', check);
  const p = d.open();
  // Rename: select the name without its extension.
  if (selectStem && input.setSelectionRange) {
    const dot = value.lastIndexOf('.');
    if (dot > 0) input.setSelectionRange(0, dot);
  }
  check();
  const r = await p;
  return r === null ? null : input.value;
}
