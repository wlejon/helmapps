/**
 * Toasts: short messages at the bottom of the window, optionally with one
 * action (Undo). For things that happened inside the app. A system
 * notification (bro.sys.notifications, via helm) is for things the user
 * must see while the app is not in front.
 *
 *   import { toast } from '/lib/toast.js';
 *   toast('Copied 3 items');
 *   toast('Moved to Trash', { action: 'Undo', onAction: undo, icon: 'trash' });
 *   toast('Could not save: disk full', { error: true });
 *   toast('Named Blue Jay', { key: 'answers', action: 'Undo', onAction });
 *
 * A toast with a `key` takes the place of the one shown with the same key,
 * so a run of saves from one source is one toast (the latest, its Undo the
 * latest's) rather than a pile over the window.
 */

import { h } from './dom.js';
import { icon } from './icons.js';

let host = null;

/**
 * @param {string} text
 * @param {object} [o]
 * @param {string} [o.icon]
 * @param {boolean} [o.error]
 * @param {string} [o.action]      a button label
 * @param {()=>void} [o.onAction]
 * @param {number} [o.ms]          how long it stays (default 3.5 s, 6 s with an action)
 * @param {string} [o.key]         its source: replaces the toast shown with the same key
 * @returns {{close: ()=>void, el: HTMLElement}}
 */
export function toast(text, { icon: iconName, error = false, action, onAction, ms, key } = {}) {
  if (!host || !document.contains(host)) {
    host = h('div.toasts', { role: 'status' });
    document.body.appendChild(host);
  }
  const el = h('div.toast',
    icon(iconName || (error ? 'alert' : 'check-circle')),
    h('span.toast-text', text));
  if (error) el.classList.add('error');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    el.appendChild(h('button.btn.small', {
      onclick: () => { close(); if (onAction) onAction(); },
    }, action));
  }
  el.appendChild(h('button.icon-btn.small', { onclick: close, 'aria-label': 'Dismiss', 'data-tip': 'Dismiss', icon: 'x' }));
  // The same source's last toast is replaced in its place, not stacked over.
  const prev = key ? Array.from(host.children).find((c) => c.dataset.toastKey === key && !c.classList.contains('leaving')) : null;
  if (key) el.dataset.toastKey = key;
  if (prev) prev.replaceWith(el);
  else host.appendChild(el);
  // Keep at most four.
  while (host.children.length > 4) host.firstChild.remove();
  setTimeout(close, ms || (action ? 6000 : 3500));
  return { close, el };
}
