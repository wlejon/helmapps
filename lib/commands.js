/**
 * Commands and keyboard shortcuts: every action an app offers is a command,
 * registered once, and the toolbar buttons, menus, context menus and keys
 * all run it by id. That keeps a shortcut, its menu hint and its enabled
 * state from drifting apart.
 *
 *   import { Commands } from '/lib/commands.js';
 *   const commands = new Commands();
 *   commands.add({ id: 'open', label: 'Open…', icon: 'folder-open', keys: ['Mod+O'],
 *                  run: () => openDialog() });
 *   commands.add({ id: 'delete', label: 'Move to Trash', icon: 'trash', keys: ['Delete'],
 *                  enabled: () => selection.size > 0, run: () => trashSelected() });
 *   commands.attach(window);              // the keys now work
 *   commands.run('open');                 // from code, a test, a button
 *   menu.show([commands.item('open'), commands.item('delete')], x, y);
 *
 * Chords are written 'Mod+Shift+Z', 'Alt+ArrowLeft', 'F2', 'Delete'. Mod is
 * Ctrl on Linux and Windows and Cmd on macOS. Letters are upper-case. Keys
 * are ignored while the user types in a text field unless the command says
 * inText: true (Escape and Mod+S usually do).
 */

import { attempt, isTyping } from './dom.js';

const IS_MAC = (typeof process !== 'undefined' && process.platform === 'darwin');

const ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

/** A chord string in canonical order with Mod resolved: 'Ctrl+Shift+Z'. */
export function normalizeChord(chord) {
  const parts = String(chord).split('+').map((p) => p.trim()).filter(Boolean);
  // 'Ctrl++' splits into ['Ctrl', ''] → trailing '+'
  if (String(chord).endsWith('++')) parts.push('+');
  let key = parts.pop() || '';
  const mods = new Set();
  for (let p of parts) {
    p = p.toLowerCase();
    if (p === 'mod') mods.add(IS_MAC ? 'Meta' : 'Ctrl');
    else if (p === 'ctrl' || p === 'control') mods.add('Ctrl');
    else if (p === 'alt' || p === 'option') mods.add('Alt');
    else if (p === 'shift') mods.add('Shift');
    else if (p === 'meta' || p === 'cmd' || p === 'super') mods.add('Meta');
  }
  if (key.length === 1) key = key.toUpperCase();
  else key = NAMED[key.toLowerCase()] || (/^f\d{1,2}$/i.test(key) ? key.toUpperCase() : key);
  return [...ORDER.filter((m) => mods.has(m)), key].join('+');
}

// Key names as KeyboardEvent.key spells them, whatever case a chord used.
const NAMED = {
  space: 'Space', esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete', enter: 'Enter',
  return: 'Enter', tab: 'Tab', backspace: 'Backspace', insert: 'Insert', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft',
  right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight', contextmenu: 'ContextMenu',
};

/** The key name of a keyboard event, as chords spell it. */
export function eventKey(e) {
  const code = e.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (e.key === ' ' || code === 'Space') return 'Space';
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  return e.key || code;
}

/** The chord a keyboard event is: 'Ctrl+Shift+Z'. */
export function eventChord(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  const key = eventKey(e);
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(key)) return '';
  return [...mods, key].join('+');
}

/** A chord for display: 'Ctrl+Shift+Z' (⌘⇧Z on macOS). */
export function displayChord(chord) {
  const c = normalizeChord(chord);
  if (!IS_MAC) return c.replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→');
  return c.replace('Ctrl+', '⌃').replace('Alt+', '⌥').replace('Shift+', '⇧').replace('Meta+', '⌘');
}

export class Commands {
  constructor() {
    this.map = new Map();      // id -> command
    this.chords = new Map();   // chord -> [id]
    this.listeners = new Set();
  }

  /**
   * @param {object} c
   * @param {string} c.id
   * @param {string} c.label        menu and tooltip text
   * @param {(args?:any)=>any} c.run
   * @param {string} [c.icon]
   * @param {string[]} [c.keys]     chords
   * @param {()=>boolean} [c.enabled]  false greys it out and stops keys and runs
   * @param {()=>boolean} [c.checked]  a toggle's state, shown as a check in menus
   * @param {boolean} [c.inText]    keys fire even while typing in a field
   * @param {boolean} [c.danger]    shown red in menus
   */
  add(c) {
    if (!c || !c.id || typeof c.run !== 'function') throw new Error('commands.add: id and run are required');
    if (this.map.has(c.id)) this.remove(c.id);
    const cmd = { keys: [], ...c, keys: (c.keys || []).map(normalizeChord) };
    this.map.set(c.id, cmd);
    for (const k of cmd.keys) {
      if (!this.chords.has(k)) this.chords.set(k, []);
      this.chords.get(k).push(c.id);
    }
    return cmd;
  }

  /** Register several: commands.addAll([{...}, {...}]). */
  addAll(list) {
    for (const c of list) this.add(c);
  }

  remove(id) {
    const cmd = this.map.get(id);
    if (!cmd) return;
    for (const k of cmd.keys) {
      const ids = (this.chords.get(k) || []).filter((x) => x !== id);
      if (ids.length) this.chords.set(k, ids); else this.chords.delete(k);
    }
    this.map.delete(id);
  }

  get(id) {
    return this.map.get(id) || null;
  }

  has(id) {
    return this.map.has(id);
  }

  isEnabled(id) {
    const c = this.map.get(id);
    if (!c) return false;
    return c.enabled ? !!attempt(`enabled ${id}`, () => c.enabled(), false) : true;
  }

  isChecked(id) {
    const c = this.map.get(id);
    return !!(c && c.checked && attempt(`checked ${id}`, () => c.checked(), false));
  }

  /** Run a command by id. Answers its result, or undefined when disabled or unknown. */
  run(id, args) {
    const c = this.map.get(id);
    if (!c) {
      console.warn(`commands: no command '${id}'`);
      return undefined;
    }
    if (!this.isEnabled(id)) return undefined;
    const result = c.run(args);
    for (const fn of this.listeners) attempt('command listener', () => fn(id, args));
    return result;
  }

  /** fn(id, args) after every command runs: refresh toolbars, status bars. */
  onRun(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The first chord of a command, for display ('' when it has none). */
  keysFor(id) {
    const c = this.map.get(id);
    return c && c.keys.length ? displayChord(c.keys[0]) : '';
  }

  /** A menu item (lib/menu.js) for a command, with its state now. */
  item(id, overrides) {
    const c = this.map.get(id);
    if (!c) return null;
    return {
      label: c.label,
      icon: c.icon,
      keys: this.keysFor(id),
      disabled: !this.isEnabled(id),
      checked: c.checked ? this.isChecked(id) : undefined,
      danger: c.danger,
      action: () => this.run(id),
      ...(overrides || {}),
    };
  }

  /** The command a keyboard event triggers, or null. */
  match(e) {
    const chord = eventChord(e);
    if (!chord) return null;
    const ids = this.chords.get(chord);
    if (!ids) return null;
    const typing = isTyping(e);
    for (const id of ids) {
      const c = this.map.get(id);
      if (typing && !c.inText) continue;
      if (this.isEnabled(id)) return c;
    }
    return null;
  }

  /** Handle keydown on target (normally window). Returns a detach function. */
  attach(target = window) {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      const c = this.match(e);
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      this.run(c.id);
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }

  /** Every command, for a command palette or a keyboard-shortcuts page. */
  list() {
    return Array.from(this.map.values());
  }
}
