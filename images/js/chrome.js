/**
 * The window's chrome around the picture: the toolbar's buttons (which show
 * in which mode), the zoom, More and picture menus, and the status bar's
 * note while the view is turned. All of it runs commands by id.
 */

import { h } from '/lib/dom.js';
import { menu } from '/lib/menu.js';

/**
 * Fill the toolbar. `extra` (an element) goes after the title, before the
 * picture's buttons. Answers the title, the zoom button, and the buttons
 * that show only on a picture (imageOnly), only in the stabilize view
 * (burstOnly) and everywhere but there (notBurst).
 */
export function buildToolbar(toolbar, commands, { extra = null } = {}) {
  const imageOnly = [], burstOnly = [], notBurst = [];
  const only = (el) => { imageOnly.push(el); return el; };
  const inBurst = (el) => { burstOnly.push(el); return el; };
  const outBurst = (el) => { notBurst.push(el); return el; };
  outBurst(toolbar.button('show-folder'));
  inBurst(toolbar.button('burst-close'));
  outBurst(toolbar.sep());
  outBurst(toolbar.button('prev'));
  outBurst(toolbar.button('next'));
  const titleEl = toolbar.add(h('div.iv-title.ellipsis'));
  toolbar.spacer();
  if (extra) toolbar.add(extra);
  inBurst(toolbar.button('burst-play'));
  inBurst(toolbar.button('burst-correct'));
  inBurst(toolbar.button('burst-exclude'));
  inBurst(toolbar.button('burst-export'));
  only(toolbar.button('subject'));
  only(toolbar.button('stabilize'));
  only(toolbar.sep());
  only(toolbar.button('zoom-out'));
  const zoomButton = only(toolbar.add(h('button.btn.ghost.small.iv-zoom.num', { 'data-tip': 'Zoom', 'data-command': 'zoom-menu',
    onclick: () => commands.run('zoom-menu') }, '100%')));
  only(toolbar.button('zoom-in'));
  only(toolbar.sep());
  only(toolbar.button('rotate-ccw'));
  only(toolbar.button('rotate-cw'));
  only(toolbar.sep());
  outBurst(toolbar.button('slideshow'));
  outBurst(toolbar.button('details'));
  outBurst(toolbar.button('open'));
  outBurst(toolbar.button('menu'));
  return { titleEl, zoomButton, imageOnly, burstOnly, notBurst };
}

export function zoomMenu(commands, viewer, anchor) {
  const s = viewer.scale();
  const level = (z, label) => ({ label, checked: !viewer.v.fit && Math.abs(s - z) < 1e-3, action: () => viewer.zoomTo(z) });
  menu.showBelow([
    { ...commands.item('fit'), checked: viewer.v.fit },
    { separator: true },
    level(0.25, '25%'), level(0.5, '50%'), level(1, '100%'), level(2, '200%'), level(4, '400%'),
    { separator: true },
    commands.item('zoom-in'), commands.item('zoom-out'),
  ], anchor);
}

export function moreMenu(commands) {
  const anchor = document.querySelector('[data-command="menu"]');
  const has = (id) => commands.has(id) && commands.isEnabled(id);
  menu.showBelow([
    commands.item('flip-h'), commands.item('flip-v'),
    { separator: true },
    commands.item('fullscreen'), commands.item('strip'),
    { label: 'Background', icon: 'palette', submenu: [commands.item('bg-dark'), commands.item('bg-mid'), commands.item('bg-checker')] },
    has('find-animals') ? commands.item('find-animals') : null,
    { separator: true },
    commands.item('copy'), commands.item('copy-path'), commands.item('open-with'), commands.item('show-in-files'),
    { separator: true },
    commands.item('rename'), commands.item('trash'),
  ], anchor);
}

/** The picture's context menu. */
export function stageMenu(commands, e) {
  e.preventDefault();
  menu.show([
    commands.item('fit'), commands.item('actual'), commands.item('zoom-in'), commands.item('zoom-out'),
    { separator: true },
    commands.item('rotate-cw'), commands.item('rotate-ccw'), commands.item('flip-h'), commands.item('flip-v'),
    { separator: true },
    commands.item('copy'), commands.item('copy-path'), commands.item('open-with'), commands.item('show-in-files'),
    { separator: true },
    commands.item('rename'), commands.item('trash'),
  ], e.clientX, e.clientY);
}

/** The Open dialog: the path picked, or ''. */
export function chooseImage(filter) {
  if (typeof showOpenFileDialog !== 'function') return '';
  const picked = showOpenFileDialog(filter, false);
  return picked && picked.length ? picked[0] : '';
}

/** Drop an image (or a folder) onto the window: open(path). */
export function acceptDrops(el, open) {
  el.addEventListener('dragover', (e) => e.preventDefault());
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [];
    const first = files.find((f) => f.path);
    if (first) open(first.path);
  });
}

/** "Rotated 90°, flipped · view only" while the view differs from the file. */
export function viewNote(v) {
  const parts = [];
  if (v.rotation) parts.push(`Rotated ${v.rotation}°`);
  if (v.flipH) parts.push('flipped horizontally');
  if (v.flipV) parts.push('flipped vertically');
  if (!parts.length) return '';
  const s = parts.join(', ');
  return `${s[0].toUpperCase()}${s.slice(1)} · view only`;
}
