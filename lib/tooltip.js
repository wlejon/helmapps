/**
 * Tooltips for any element with data-tip="text" (and optionally
 * data-keys="Ctrl+O", shown as a key cap). Toolbar buttons from lib/layout.js
 * get both from their command. installTooltips() once at startup; app.js
 * does it for you.
 */

import { h } from './dom.js';

let tip = null;
let timer = null;
let current = null;

function hide() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (tip) { tip.remove(); tip = null; }
  current = null;
}

function show(el) {
  hide();
  current = el;
  timer = setTimeout(() => {
    if (current !== el || !document.contains(el)) return;
    tip = h('div.tooltip', el.dataset.tip, el.dataset.keys ? h('span.kbd', el.dataset.keys) : null);
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.bottom + 6;
    if (y + t.height > window.innerHeight - 4) y = r.top - t.height - 6;
    x = Math.max(4, Math.min(x, window.innerWidth - t.width - 4));
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  }, 550);
}

let installed = false;

export function installTooltips() {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerover', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el === current) return;
    if (el) show(el); else hide();
  });
  document.addEventListener('pointerdown', hide, true);
  window.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
}
