// The seam between broterm and bro's <terminal> element.
//
// The element grows while broterm is being written: today it has spawn /
// write / feed / kill, the text reads, title and cursor, and resize / exit
// events. Scrollback views, search, links, selection, title / cwd / bell /
// notification / prompt-mark events, palette and font APIs are on their way.
// Everything broterm wants from the element goes through this file, which
// uses the element's own API when it has one and a fallback otherwise, so a
// new capability is one place to wire up, not a hunt through the UI.

import { paletteSequence } from '../core/schemes.js';

const proto = typeof HTMLTerminalElement !== 'undefined' ? HTMLTerminalElement.prototype : null;

function has(name) {
    if (!proto) return false;
    try { return name in proto; } catch (e) { return false; }
}

function fn(name) {
    if (!proto) return false;
    try { return typeof proto[name] === 'function'; } catch (e) { return false; }
}

/// What this build of the element can do. Event-shaped capabilities also
/// switch on the first time the event is seen (see watch()).
export const caps = {
    element: !!proto,
    cwd: has('cwd'),
    palette: fn('setPalette') || has('palette'),
    scrollbackLimit: has('scrollbackLimit') || has('scrollbackLines'),
    search: fn('find') || fn('search'),
    scrollView: fn('scrollLines') || fn('scrollToBottom') || has('viewportOffset'),
    selection: fn('getSelection') || has('selectionText') || fn('selectionText'),
    clearScrollback: fn('clearScrollback') || fn('clear'),
    titleEvent: false,
    outputEvent: false,
    bellEvent: false,
    cwdEvent: false,
};

// Event names, the ones bro uses first. A listener for an event the element
// never fires costs nothing.
const EVENTS = {
    title: ['titlechange', 'title'],
    cwd: ['cwdchange', 'cwd'],
    bell: ['bell'],
    output: ['output', 'activity'],
    notification: ['notification', 'notify'],
    prompt: ['promptmark', 'prompt', 'semanticprompt'],
    clipboard: ['clipboard', 'osc52'],
};

/// Attach handlers: { title(e), cwd(e), bell(e), output(e), notification(e),
/// prompt(e), clipboard(e), exit(e), resize(e), focus(e), blur(e) }.
export function watch(el, handlers) {
    for (const [kind, names] of Object.entries(EVENTS)) {
        if (!handlers[kind]) continue;
        for (const name of names) {
            el.addEventListener(name, (e) => {
                if (kind === 'title') caps.titleEvent = true;
                if (kind === 'output') caps.outputEvent = true;
                if (kind === 'bell') caps.bellEvent = true;
                if (kind === 'cwd') caps.cwdEvent = true;
                handlers[kind](e);
            });
        }
    }
    for (const name of ['exit', 'resize', 'focus', 'blur', 'keydown']) {
        if (handlers[name]) el.addEventListener(name, handlers[name]);
    }
}

export function create() {
    const el = document.createElement('terminal');
    el.className = 'term';
    return el;
}

export function title(el) {
    try { return el.title || ''; } catch (e) { return ''; }
}

export function cwd(el) {
    if (!caps.cwd) return null;
    try { return el.cwd || null; } catch (e) { return null; }
}

/// A cheap fingerprint of what is on screen, for activity detection where
/// the element has no output event.
export function screenStamp(el) {
    let text = '';
    try { text = el.screenText(); } catch (e) { return ''; }
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    const c = el.cursor || {};
    return text.length + ':' + h + ':' + c.row + ':' + c.col;
}

export function applyPalette(el, scheme) {
    if (typeof el.setPalette === 'function') {
        el.setPalette(scheme);
        return;
    }
    el.feed(paletteSequence(scheme));
}

const CURSOR_CODES = { block: [1, 2], underline: [3, 4], bar: [5, 6] };

export function applyCursor(el, style, blink) {
    const codes = CURSOR_CODES[style] || CURSOR_CODES.block;
    if ('cursorStyle' in el && proto && has('cursorStyle')) {
        el.cursorStyle = style;
        if (has('cursorBlink')) el.cursorBlink = !!blink;
        return;
    }
    el.feed('\x1b[' + (blink === false ? codes[1] : codes[0]) + ' q');
}

export function applyScrollback(el, lines) {
    if (!caps.scrollbackLimit || !(lines > 0)) return false;
    if (has('scrollbackLimit')) el.scrollbackLimit = lines; else el.scrollbackLines = lines;
    return true;
}

/// Search the terminal's history. Returns the element's answer, or null when
/// the element has no search yet.
export function find(el, query, options) {
    if (typeof el.find === 'function') return el.find(query, options || {});
    if (typeof el.search === 'function') return el.search(query, options || {});
    return null;
}

/// Scroll the view by `lines` (negative: up), when the element can.
export function scrollLines(el, lines) {
    if (typeof el.scrollLines === 'function') { el.scrollLines(lines); return true; }
    return false;
}

export function clearScrollback(el) {
    if (typeof el.clearScrollback === 'function') { el.clearScrollback(); return true; }
    if (typeof el.clear === 'function') { el.clear(); return true; }
    el.feed('\x1b[3J');
    return true;
}
