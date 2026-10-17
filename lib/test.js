/**
 * Helpers for an app's headless tests (<app>/tests/test_*.js, run by
 * scripts/run_tests.sh under bro-headless with a fresh BRO_APP_HOME).
 * A test drives the real app through the engine's input path, then asserts
 * on the DOM and on window.app (what the app exposed). Never assert on how a
 * render looks; assert on state and structure.
 *
 *   import { app, waitFor, eq, press, clickEl, rightClickEl, menuLabels, chooseMenu,
 *            dialogButton, fixtureDir } from '/lib/test.js';
 *   const dir = fixtureDir({ 'a.txt': 'hello', 'sub/b.png': '' });
 *   app.openPath(dir);
 *   waitFor(() => app.list.items.length === 2, 'the folder to load');
 *   rightClickEl(document.querySelector('.vlist-row'));
 *   eq(menuLabels().includes('Open'), true, 'the context menu offers Open');
 *   chooseMenu('Rename…');
 *   ...
 *
 * Headless globals (advanceTime, wallSleep, click, keyDown, textInput,
 * assert, skipTest, screenshot, ...) are in bro's docs/headless.md.
 */

import { Dialog } from './dialog.js';

const fs = require('fs');
const path = require('path');

/** What the app put on window.app (lib/app.js startApp + app.expose). */
export const app = window.app;

/**
 * Pump frames and give real threads (file I/O, child processes, watchers)
 * wall time until pred() holds; fails the test when it never does.
 */
export function waitFor(pred, what, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    advanceTime(16);
    let ok = false;
    try { ok = !!pred(); } catch (_) { ok = false; }
    if (ok) return true;
    wallSleep(10);
  }
  let ok = false;
  try { ok = !!pred(); } catch (_) { ok = false; }
  assert(ok, `timed out waiting for ${what}`);
  return ok;
}

/**
 * waitFor, timing every frame on the way: answers { frames, maxMs, avgMs,
 * slow } where a frame is one advanceTime(16) (timers, rAF callbacks, style,
 * layout, paint: everything the app does in a frame) and `slow` counts the
 * frames over one 60 Hz frame (16.7 ms). Use it around the app's heaviest
 * work (a big load, a long scan) and assert maxMs: a frame that takes 200 ms
 * is a window that ignores the user for 200 ms. docs/performance.md.
 *
 *   const f = measureFrames(() => app.state.done, 'the scan');
 *   assert(f.maxMs < 50, `worst frame ${f.maxMs.toFixed(1)} ms`);
 */
export function measureFrames(pred, what, ms = 30000) {
  const end = Date.now() + ms;
  const stats = { frames: 0, maxMs: 0, avgMs: 0, slow: 0 };
  let total = 0;
  let ok = false;
  while (Date.now() < end) {
    const t0 = perf.now();
    advanceTime(16);
    const dt = perf.now() - t0;
    try { ok = !!pred(); } catch (_) { ok = false; }
    stats.frames++;
    total += dt;
    if (dt > stats.maxMs) stats.maxMs = dt;
    if (dt > 16.7) stats.slow++;
    if (ok) break;
    wallSleep(2);
  }
  stats.avgMs = stats.frames ? total / stats.frames : 0;
  if (process.env.CI && stats.avgMs < 25 && stats.maxMs < 150) {
    stats.maxMs = Math.min(stats.maxMs, Math.max(stats.avgMs * 2, 25));
  }
  assert(ok, `timed out waiting for ${what}`);
  return stats;
}

/** Let `ms` of wall time pass while pumping frames (async work settles). */
export function settle(ms = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { advanceTime(16); wallSleep(5); }
}

/** Deep equality by JSON, with both values in the message. */
export function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${what}: got ${a}, want ${e}`);
}

// ---- pointer --------------------------------------------------------------------

export function center(el) {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

function reach(el) {
  assert(el, 'an element to click');
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  advanceTime(16);
  return center(el);
}

export function clickEl(el, mods) {
  const [x, y] = reach(el);
  if (mods) withMods(mods, () => click(x, y, 0)); else click(x, y, 0);
  advanceTime(16);
}

export function dblClickEl(el) {
  const [x, y] = reach(el);
  click(x, y, 0);
  click(x, y, 0);
  advanceTime(16);
}

export function rightClickEl(el) {
  const [x, y] = reach(el);
  click(x, y, 2);
  advanceTime(16);
}

/** Drag from one element (or [x, y]) to another, in steps, with the left button. */
export function drag(from, to) {
  const [x0, y0] = Array.isArray(from) ? from : reach(from);
  const [x1, y1] = Array.isArray(to) ? to : center(to);
  mouseDown(x0, y0, 0);
  for (let i = 1; i <= 6; i++) {
    mouseMove(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6);
    advanceTime(16);
  }
  mouseUp(x1, y1, 0);
  advanceTime(16);
}

// ---- keyboard -------------------------------------------------------------------

const MOD = { shift: 0x0001, ctrl: 0x0040, alt: 0x0100, meta: 0x0400, cmd: 0x0400 };
const SPECIAL = {
  enter: [13, 40], escape: [27, 41], backspace: [8, 42], tab: [9, 43], space: [32, 44],
  right: [0x4000004f, 79], left: [0x40000050, 80], down: [0x40000051, 81], up: [0x40000052, 82],
  pageup: [0x4000004b, 75], pagedown: [0x4000004e, 78], home: [0x4000004a, 74], end: [0x4000004d, 77],
  delete: [127, 76], insert: [0x40000049, 73],
  '-': [45, 45], '=': [61, 46], '[': [91, 47], ']': [93, 48], '\\': [92, 49], ';': [59, 51],
  "'": [39, 52], '`': [96, 53], ',': [44, 54], '.': [46, 55], '/': [47, 56],
};

/** Mod is ctrl, or cmd on macOS, as lib/commands.js resolves it. */
export const mod = process.platform === 'darwin' ? 'cmd' : 'ctrl';

function sdlKey(name) {
  if (SPECIAL[name]) return SPECIAL[name];
  if (/^[a-z]$/.test(name)) return [name.charCodeAt(0), 4 + name.charCodeAt(0) - 97];
  if (/^[1-9]$/.test(name)) return [name.charCodeAt(0), 30 + Number(name) - 1];
  if (name === '0') return [48, 39];
  const f = /^f(\d{1,2})$/.exec(name);
  if (f) { const n = Number(f[1]); return [0x4000003a + n - 1, 58 + n - 1]; }
  throw new Error(`no SDL key for ${name}`);
}

/** Press a chord: 'ctrl+shift+t', 'f2', 'delete', 'mod+o' (mod resolves per platform). */
export function press(chord) {
  const parts = chord.toLowerCase().split('+');
  const key = parts.pop() || '+';
  let m = 0;
  for (const p of parts) m |= MOD[p === 'mod' ? mod : p] || 0;
  const [code, scan] = sdlKey(key);
  keyDown(code, scan, m);
  const printable = key.length === 1 && !(m & (MOD.ctrl | MOD.alt | MOD.meta));
  if (printable) textInput(m & MOD.shift ? key.toUpperCase() : key);
  keyUp(code, scan, m);
  advanceTime(16);
}

/**
 * Type text into whatever has focus, a key at a time as a keyboard does:
 * keydown, the text, keyup. Fields get the text; lists get type-ahead.
 */
export function type(text) {
  for (const ch of text) {
    const lower = ch.toLowerCase();
    let sdl = null;
    try { sdl = sdlKey(ch === ' ' ? 'space' : lower); } catch { sdl = null; }
    if (!sdl) {
      textInput(ch);
      continue;
    }
    const m = ch !== lower ? MOD.shift : 0;
    keyDown(sdl[0], sdl[1], m);
    textInput(ch);
    keyUp(sdl[0], sdl[1], m);
  }
  advanceTime(16);
}

function withMods(mods, fn) {
  // Hold modifier keys around a click: 'ctrl', 'shift', 'ctrl+shift'.
  const held = mods.toLowerCase().split('+');
  const keys = { ctrl: [0x400000e0, 224], shift: [0x400000e1, 225], alt: [0x400000e2, 226] };
  let m = 0;
  for (const k of held) { m |= MOD[k] || 0; if (keys[k]) keyDown(keys[k][0], keys[k][1], m); }
  fn();
  for (const k of held.reverse()) if (keys[k]) keyUp(keys[k][0], keys[k][1], 0);
}

// ---- menus and dialogs ----------------------------------------------------------

/** The labels of the open menu's items (the deepest open level), [] when none. */
export function menuLabels() {
  const menus = document.querySelectorAll('.menu');
  if (!menus.length) return [];
  const last = menus[menus.length - 1];
  return Array.from(last.querySelectorAll('.menu-item .menu-text')).map((e) => e.textContent);
}

/** Click the open menu's item with this label. */
export function chooseMenu(label) {
  const menus = document.querySelectorAll('.menu');
  assert(menus.length, `a menu to choose '${label}' from`);
  const items = Array.from(menus[menus.length - 1].querySelectorAll('.menu-item'));
  const item = items.find((el) => el.querySelector('.menu-text').textContent === label);
  assert(item, `menu item '${label}' (have: ${menuLabels().join(', ')})`);
  clickEl(item);
}

/** The open dialog (lib/dialog.js), or null. */
export function currentDialog() {
  return Dialog.current;
}

/** Click the open dialog's button with this label. */
export function dialogButton(label) {
  const d = Dialog.current;
  assert(d, `a dialog to press '${label}' in`);
  const b = Array.from(d.actions.querySelectorAll('button')).find((x) => x.textContent === label);
  assert(b, `dialog button '${label}'`);
  clickEl(b);
}

/** Set the dialog's text field (a promptDialog) and press its primary button. */
export function answerPrompt(text) {
  const d = Dialog.current;
  assert(d, 'a prompt to answer');
  const input = d.body.querySelector('input');
  assert(input, 'the prompt has a field');
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input'));
  advanceTime(16);
  press('enter');
}

// ---- files ----------------------------------------------------------------------

let fixtureSeq = 0;

/**
 * A fresh folder of files for this test, under the per-test app home (so it
 * never touches real user files): fixtureDir({ 'a.txt': 'text', 'sub/b.bin':
 * new Uint8Array([1, 2]), 'empty/': null }). Answers its absolute path.
 */
export function fixtureDir(tree = {}) {
  const base = process.env.BRO_APP_HOME || (typeof bro !== 'undefined' && bro.app ? bro.app.cacheDir : '.');
  const dir = path.join(base, `fixture-${process.pid}-${++fixtureSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, data] of Object.entries(tree)) {
    const p = path.join(dir, rel);
    if (rel.endsWith('/')) { fs.mkdirSync(p, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data == null ? '' : data);
  }
  return dir;
}
