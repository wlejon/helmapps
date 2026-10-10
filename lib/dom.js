/**
 * DOM helpers every app uses: the h() element builder, queries, guarded
 * access to bro namespaces, and small timing helpers.
 *
 *   import { h, $, api } from '/lib/dom.js';
 *   const row = h('div.row#first', { onclick: open, title: 'Open' }, h('span.name', name));
 *   const vfs = api('vfs');          // null when bro.vfs is compiled out or not granted
 */

import { icon } from './icons.js';

/**
 * h('tag.class.class#id', props?, ...children)
 * props: onX (event listeners), text, html, icon (an icon name), dataset,
 * style (object), and anything else as a property (when not a string) or
 * attribute. Children may be nodes, strings, numbers, arrays, null/false.
 */
export function h(spec, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'icon') el.appendChild(icon(v));
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/** Append children (nodes, strings, arrays, null) to el; returns el. */
export function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Remove every child of el, then append children. */
export function replaceChildren(el, ...children) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return append(el, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** addEventListener that returns its own remover. */
export function on(target, event, fn, opts) {
  target.addEventListener(event, fn, opts);
  return () => target.removeEventListener(event, fn, opts);
}

/**
 * The bro namespace `name` when it is installed and available, else null.
 * Every privileged or optional namespace (vfs, apps, thumb, sys, ...) may be
 * missing: compiled out of this build, not granted to this app, or on a
 * platform without the backend. Check, and hide the feature, never fake it.
 */
export function api(name) {
  if (typeof bro === 'undefined' || !bro) return null;
  const ns = bro[name];
  if (!ns || ns.available === false) return null;
  return ns;
}

/** Why bro.<name> is unavailable, for an empty state; '' when it is available. */
export function apiReason(name) {
  if (typeof bro === 'undefined' || !bro || !bro[name]) return `bro.${name} is not in this build`;
  const ns = bro[name];
  if (ns.available !== false) return '';
  return ns.reason || `bro.${name} is unavailable`;
}

/** Call fn, answering fallback (and warning once per tag) when it throws. */
const warned = new Set();
export function attempt(tag, fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (!warned.has(tag)) {
      warned.add(tag);
      console.warn(`${tag} failed: ${err && err.message ? err.message : err}`);
    }
    return fallback;
  }
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** fn delayed until `ms` pass with no further call. .cancel() drops a pending call. */
export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  d.cancel = () => { if (t) clearTimeout(t); t = null; };
  return d;
}

/** fn at most once per animation frame, with the latest arguments. */
export function perFrame(fn) {
  let pending = false;
  let last = [];
  return (...args) => {
    last = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...last); });
  };
}

/** Is this key event typing into a text field (so app shortcuts should stay out)? */
export function isTyping(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || t.isContentEditable === true;
}
