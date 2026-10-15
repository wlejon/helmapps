/**
 * The pieces of an app window: the frame, toolbar buttons bound to
 * commands, a sidebar, a split pane, breadcrumbs, document tabs and empty
 * states. The classes they draw with are in css/layout.css.
 *
 *   import { appFrame, Toolbar, Sidebar, SplitPane, Breadcrumbs, Tabs, emptyState } from '/lib/layout.js';
 *   const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
 *   document.body.appendChild(ui.frame);
 *   const tb = new Toolbar(ui.toolbar, commands);
 *   tb.button('back'); tb.button('forward'); tb.sep(); tb.add(crumbs.el); tb.spacer(); tb.add(search);
 *   const side = new Sidebar({ onSelect: (item) => go(item.id) });
 *   side.setSections([{ title: 'Places', items: [{ id: home, label: 'Home', icon: 'home' }] }]);
 *   ui.sidebar.appendChild(side.el);
 */

import { h, clamp } from './dom.js';
import { icon } from './icons.js';

/**
 * The window's frame: toolbar / body (sidebar + content) / status bar.
 * Pass false to leave a part out. Answers the elements to fill.
 */
export function appFrame({ toolbar = true, sidebar = false, statusbar = false } = {}) {
  const parts = {};
  parts.toolbar = toolbar ? h('header.toolbar') : null;
  parts.sidebar = sidebar ? h('nav.sidebar') : null;
  parts.content = h('main.content');
  parts.statusbar = statusbar ? h('footer.statusbar') : null;
  parts.body = h('div.app-body', parts.sidebar, parts.content);
  parts.frame = h('div.app-frame', parts.toolbar, parts.body, parts.statusbar);
  return parts;
}

/**
 * Toolbar buttons that run commands (lib/commands.js) and follow their
 * enabled/checked state. refresh() re-reads the state; it runs after every
 * command, and the app calls it when state changes for other reasons
 * (selection, navigation).
 */
export class Toolbar {
  constructor(el, commands) {
    this.el = el;
    this.commands = commands;
    this.bound = [];
    if (commands) commands.onRun(() => this.refresh());
  }

  /** An icon button for command id (the command needs an icon). */
  button(id, { label = false } = {}) {
    const c = this.commands.get(id);
    if (!c) throw new Error(`toolbar: no command '${id}'`);
    const keys = this.commands.keysFor(id);
    const b = label
      ? h('button.btn.ghost', { 'data-tip': c.label, 'data-keys': keys || null }, c.icon ? icon(c.icon) : null, c.label)
      : h('button.icon-btn', { 'data-tip': c.label, 'data-keys': keys || null, 'aria-label': c.label }, icon(c.icon || 'info'));
    b.dataset.command = id;
    b.addEventListener('click', () => this.commands.run(id));
    this.bound.push({ id, el: b });
    this.el.appendChild(b);
    this.refreshOne(id, b);
    return b;
  }

  /** Any element (a search field, breadcrumbs, a Segmented). */
  add(el) {
    this.el.appendChild(el);
    return el;
  }

  group(...els) {
    return this.add(h('div.toolbar-group', ...els));
  }

  spacer() { return this.add(h('div.toolbar-spacer')); }
  sep() { return this.add(h('div.toolbar-sep')); }
  title(text) { return this.add(h('div.toolbar-title', text)); }

  refresh() {
    for (const { id, el } of this.bound) this.refreshOne(id, el);
  }

  refreshOne(id, el) {
    el.disabled = !this.commands.isEnabled(id);
    const c = this.commands.get(id);
    if (c && c.checked) {
      const on = !!this.commands.isChecked(id);
      el.classList.toggle('active', on);
      el.setAttribute('aria-pressed', String(on));
    }
  }
}

/**
 * A thin bar showing how full something is (a drive, a quota). fraction is
 * 0..1; past 85% it turns the warning colour, past 95% the danger colour.
 */
export function meter(fraction) {
  const f = clamp(Number(fraction) || 0, 0, 1);
  const el = h('div.meter', h('div.meter-fill', { style: { width: `${(f * 100).toFixed(1)}%` } }));
  if (f >= 0.95) el.classList.add('full');
  else if (f >= 0.85) el.classList.add('high');
  return el;
}

/**
 * A sidebar of sections and items.
 *   setSections([{ title?, items: [{ id, label, icon?, count?, sub?, meter?, title?, data? }] }])
 * `sub` is a second, quieter line (a drive's free space); `meter` (0..1)
 * draws a fill bar under it. onSelect(item) on click; onContextMenu(e, item)
 * on right-click.
 */
export class Sidebar {
  constructor({ onSelect, onContextMenu } = {}) {
    this.onSelect = onSelect;
    this.onContextMenu = onContextMenu;
    this.selected = null;
    this.rows = new Map();
    this.el = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } });
  }

  setSections(sections) {
    this.rows.clear();
    const out = [];
    for (const s of sections) {
      if (s.title) out.push(h('div.sidebar-section.micro', s.title));
      for (const it of s.items || []) {
        const twoLine = it.sub != null || it.meter != null;
        const row = h('button.sidebar-item', { title: it.title || null },
          it.icon ? icon(it.icon) : null,
          twoLine
            ? h('span.sidebar-text',
              h('span.sidebar-label', it.label),
              it.sub != null ? h('span.sidebar-sub', it.sub) : null,
              it.meter != null ? meter(it.meter) : null)
            : h('span.grow', it.label),
          it.count != null ? h('span.count', String(it.count)) : null);
        if (twoLine) row.classList.add('two-line');
        row.addEventListener('click', () => {
          this.select(it.id);
          if (this.onSelect) this.onSelect(it);
        });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (this.onContextMenu) this.onContextMenu(e, it);
        });
        this.rows.set(it.id, row);
        out.push(row);
      }
    }
    this.el.replaceChildren(...out);
    this.select(this.selected);
  }

  /** Highlight an item by id (null for none). Does not call onSelect. */
  select(id) {
    this.selected = id;
    for (const [k, row] of this.rows) {
      row.classList.toggle('selected', k === id);
      if (k === id) row.setAttribute('aria-current', 'page');
      else row.removeAttribute('aria-current');
    }
  }
}

/**
 * Two panes and a draggable divider. One pane has a fixed size (in px) the
 * user drags; the other fills the rest.
 *   const split = new SplitPane({ fixed: 'first', size: 260, min: 160, max: 600,
 *                                 onResize: (px) => settings.set('previewWidth', px) });
 *   split.first.appendChild(list.el); split.second.appendChild(preview);
 */
export class SplitPane {
  constructor({ vertical = false, fixed = 'first', size = 260, min = 120, max = 2000, onResize } = {}) {
    this.vertical = vertical;
    this.fixedSide = fixed;
    this.min = min;
    this.max = max;
    this.onResize = onResize;
    this.first = h('div.split-pane');
    this.second = h('div.split-pane');
    this.divider = h('div.split-divider');
    this.el = h('div.split', this.first, this.divider, this.second);
    if (vertical) this.el.classList.add('vertical');
    this.fixedEl().classList.add('fixed');
    (fixed === 'first' ? this.second : this.first).classList.add('fill');
    this.setSize(size);
    this.divider.addEventListener('pointerdown', (e) => this.drag(e));
  }

  fixedEl() {
    return this.fixedSide === 'first' ? this.first : this.second;
  }

  setSize(px) {
    this.size = clamp(Math.round(px), this.min, this.max);
    this.fixedEl().style[this.vertical ? 'height' : 'width'] = `${this.size}px`;
  }

  /** Show or hide the fixed pane (a preview panel). */
  setCollapsed(collapsed) {
    this.fixedEl().classList.toggle('hidden', !!collapsed);
    this.divider.classList.toggle('hidden', !!collapsed);
  }

  drag(e) {
    e.preventDefault();
    const start = this.vertical ? e.clientY : e.clientX;
    const from = this.size;
    const sign = this.fixedSide === 'first' ? 1 : -1;
    this.divider.classList.add('dragging');
    const move = (ev) => {
      const now = this.vertical ? ev.clientY : ev.clientX;
      this.setSize(from + sign * (now - start));
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      this.divider.classList.remove('dragging');
      if (this.onResize) this.onResize(this.size);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }
}

/**
 * A path as clickable segments.
 *   crumbs.set([{ label: 'Home', value: '/home/j' }, { label: 'Pictures', value: '/home/j/Pictures' }]);
 * onNavigate(value) when a segment other than the last is clicked.
 */
export class Breadcrumbs {
  constructor({ onNavigate } = {}) {
    this.onNavigate = onNavigate;
    this.el = h('div.crumbs');
  }

  set(segments) {
    const out = [];
    segments.forEach((s, i) => {
      if (i > 0) out.push(h('span.crumb-sep', icon('chevron-right')));
      const last = i === segments.length - 1;
      const b = h('button.crumb', { title: s.title || s.label }, s.icon ? icon(s.icon, 'sm') : null, s.label);
      if (last) b.classList.add('current');
      else b.addEventListener('click', () => this.onNavigate && this.onNavigate(s.value));
      out.push(b);
    });
    this.el.replaceChildren(...out);
    // Keep the end of a long path in view.
    this.el.scrollLeft = 1e6;
  }
}

/**
 * Document tabs.
 *   const tabs = new Tabs({ onActivate: (id) => show(id), onClose: (id) => closeDoc(id) });
 *   tabs.add({ id: 1, label: 'notes.txt', icon: 'file-text' }); tabs.activate(1);
 *   tabs.update(1, { label: 'notes.txt', dirty: true });
 * Middle-click closes. A "new tab" button is the app's to add after tabs.el.
 */
export class Tabs {
  constructor({ onActivate, onClose } = {}) {
    this.onActivate = onActivate;
    this.onClose = onClose;
    this.tabs = new Map();
    this.active = null;
    this.el = h('div.tabstrip', { role: 'tablist' });
  }

  add({ id, label, icon: iconName, dirty = false, title }) {
    const lab = h('span.tab-label', label);
    const close = h('button.icon-btn.small.tab-close', { 'aria-label': 'Close', 'data-tip': 'Close', icon: 'x' });
    const el = h('div.tab', { role: 'tab', title: title || label }, iconName ? icon(iconName, 'sm') : null, lab, close);
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1) { e.preventDefault(); if (this.onClose) this.onClose(id); return; }
      if (e.button === 0 && !close.contains(e.target)) this.activate(id, true);
    });
    close.addEventListener('click', (e) => { e.stopPropagation(); if (this.onClose) this.onClose(id); });
    this.tabs.set(id, { el, lab });
    this.el.appendChild(el);
    this.update(id, { dirty });
    return el;
  }

  update(id, { label, dirty, title } = {}) {
    const t = this.tabs.get(id);
    if (!t) return;
    if (label != null) t.lab.textContent = label;
    if (title != null) t.el.title = title;
    if (dirty != null) t.el.classList.toggle('dirty', !!dirty);
  }

  /** Remove a tab (the app decides what becomes active next). */
  remove(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    t.el.remove();
    this.tabs.delete(id);
    if (this.active === id) this.active = null;
  }

  activate(id, fromUser = false) {
    this.active = id;
    for (const [k, t] of this.tabs) {
      t.el.classList.toggle('active', k === id);
      t.el.setAttribute('aria-selected', String(k === id));
    }
    if (fromUser && this.onActivate) this.onActivate(id);
  }

  ids() {
    return Array.from(this.tabs.keys());
  }
}

/**
 * An empty state: a glyph, a line, a hint, and an optional button.
 *   emptyState({ icon: 'folder', title: 'This folder is empty', hint: 'Drop files here.',
 *                action: { label: 'New Folder', run: newFolder } })
 */
export function emptyState({ icon: iconName = 'info', title = '', hint = '', action } = {}) {
  return h('div.empty',
    h('div.empty-glyph', icon(iconName)),
    title ? h('div.empty-title', title) : null,
    hint ? h('div.empty-hint', hint) : null,
    action ? h('button.btn.primary', { onclick: action.run }, action.label) : null);
}
