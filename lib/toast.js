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
 * @returns {{close: ()=>void, el: HTMLElement}}
 */
export function toast(text, { icon: iconName, error = false, action, onAction, ms } = {}) {
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
  el.appendChild(h('button.icon-btn.small', { onclick: close, title: 'Dismiss', icon: 'x' }));
  host.appendChild(el);
  // Keep at most four.
  while (host.children.length > 4) host.firstChild.remove();
  setTimeout(close, ms || (action ? 6000 : 3500));
  return { close, el };
}
