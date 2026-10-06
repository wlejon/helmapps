// The seam between broterm and bro's <terminal> element.
//
// Everything broterm asks of the element goes through this file. It uses the
// element's own API where this build has it and degrades where it does not,
// so a new capability is one place to wire up, not a hunt through the UI.
//
// The element today (bro's T2a) has events for titles, directories, the bell,
// notifications, progress, OSC 52, OSC 133 marks, links, scrolling and
// search; `options` and `theme`; a scrollback view, selection and search.
// T2b followed: inline images with a per-terminal memory quota, persistent
// (bromux) sessions, and the foreground process; each is detected, so an
// older bro without them still works. Still to come: an output/activity
// event.

import { normalizeColor } from '../core/schemes.js';

const proto = typeof HTMLTerminalElement !== 'undefined' ? HTMLTerminalElement.prototype : null;

function has(name) {
    if (!proto) return false;
    try { return name in proto; } catch (e) { return false; }
}

function fn(name) {
    if (!proto) return false;
    try { return typeof proto[name] === 'function'; } catch (e) { return false; }
}

/// What this build of the element can do.
export const caps = {
    element: !!proto,
    theme: has('theme'),
    options: has('options'),
    viewport: has('viewport') && fn('scrollLines'),
    search: fn('search') && has('searchStatus'),
    selection: fn('select') && fn('selectionText'),
    selectOutput: fn('selectOutput'),
    commands: has('commands'),
    scrollToPrompt: fn('scrollToPrompt'),
    links: fn('linkAt'),
    clipboardAnswer: fn('answerClipboard'),
    paste: fn('paste'),
    metrics: has('metrics'),
    // Inline images (kitty graphics, sixel, iTerm2), with a memory quota
    // in options.imageMemoryLimit and what is held in `images`.
    images: has('images'),
    // T2b, not on bro's main yet: detected by the shapes it is expected to
    // take, and used only once present.
    persistent: fn('attach') && fn('detach') && typeof bro !== 'undefined' && !!bro.terminal &&
        bro.terminal.persistentAvailable === true,
    foreground: has('foregroundProcess') || has('foreground'),
    // No output event yet: activity in background tabs is the one thing
    // still polled (see Workspace.pollActivity).
    outputEvent: false,
};

/// Attach listeners. `handlers` maps event names to functions; names the
/// element never fires cost nothing. The foreground-process event is
/// registered under every name T2b might give it.
export function watch(el, handlers) {
    for (const [name, h] of Object.entries(handlers)) {
        if (!h) continue;
        if (name === 'foreground') {
            for (const n of ['foregroundchange', 'processchange', 'foregroundprocess']) el.addEventListener(n, h);
            continue;
        }
        if (name === 'output') {
            for (const n of ['output', 'activity']) {
                el.addEventListener(n, (e) => { caps.outputEvent = true; h(e); });
            }
            continue;
        }
        el.addEventListener(name, h);
    }
}

export function create() {
    const el = document.createElement('terminal');
    el.className = 'term';
    return el;
}

function safe(f, fallback) {
    try { const v = f(); return v === undefined ? fallback : v; } catch (e) { return fallback; }
}

export function title(el) { return safe(() => el.title || '', ''); }

/// OSC 7 reports a file:// URI; the element may hand it over as the URI or
/// as a path. Either way the answer is a local path: percent escapes
/// decoded, the host dropped, "/C:/x" made "C:/x", and on Windows an MSYS
/// path ("/c/Users/x", what Git Bash's $PWD looks like) made "C:/Users/x".
export function uriToPath(uri, platform) {
    if (!uri || typeof uri !== 'string') return null;
    let p = uri;
    const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(p);
    if (m) {
        p = m[2] || '/';
        try { p = decodeURIComponent(p); } catch (e) { /* keep it raw */ }
    }
    if (/^\/[A-Za-z]:([\\/]|$)/.test(p)) p = p.slice(1);
    if ((platform || process.platform) === 'win32') {
        const msys = /^\/([A-Za-z])(\/.*)?$/.exec(p);
        if (msys) p = msys[1].toUpperCase() + ':' + (msys[2] || '/');
        const cyg = /^\/cygdrive\/([A-Za-z])(\/.*)?$/.exec(p);
        if (cyg) p = cyg[1].toUpperCase() + ':' + (cyg[2] || '/');
        if (/^[A-Za-z]:$/.test(p)) p += '/';
    }
    return p;
}

export function cwd(el) {
    return uriToPath(safe(() => el.cwd, ''), process.platform) || null;
}

export function viewport(el) {
    return caps.viewport ? safe(() => el.viewport, null) : null;
}

export function commands(el) {
    return caps.commands ? safe(() => el.commands, []) || [] : [];
}

export function metrics(el) {
    return caps.metrics ? safe(() => el.metrics, null) : null;
}

/// The foreground process, once the element reports one: { pid, name,
/// path, args }, whatever shape T2b gives it, normalised. Null otherwise.
export function foreground(el) {
    if (!caps.foreground) return null;
    const raw = safe(() => (el.foregroundProcess !== undefined ? el.foregroundProcess : el.foreground), null);
    if (!raw || typeof raw !== 'object') return null;
    const args = Array.isArray(raw.args) ? raw.args : Array.isArray(raw.argv) ? raw.argv.slice(1)
        : typeof raw.commandLine === 'string' ? raw.commandLine.split(/\s+/).slice(1) : [];
    const path = raw.path || raw.executable || (Array.isArray(raw.argv) ? raw.argv[0] : '') || '';
    let name = raw.name || path.split(/[\\/]/).pop() || '';
    name = name.replace(/\.exe$/i, '');
    return { pid: raw.pid || 0, name, path, args: args.map(String) };
}

// ── persistent (bromux) sessions ──

/// The session an element shows, null for a local process.
export function sessionId(el) {
    if (!caps.persistent) return null;
    const id = safe(() => el.sessionId, null);
    return typeof id === 'number' && id > 0 ? id : null;
}

/// The bromux server's sessions ([] when none is running). `server` names
/// a server; null or empty is the per-user default.
export function sessions(server) {
    if (!caps.persistent) return [];
    return safe(() => (server ? bro.terminal.sessions(server) : bro.terminal.sessions()), []) || [];
}

export function sessionRunning(id, server) {
    return !!id && sessions(server).some((s) => s.id === id && s.running);
}

/// Kill a session's program and drop it from the server.
export function closeSession(id, server) {
    if (!caps.persistent || !id) return false;
    return !!safe(() => (server ? bro.terminal.closeSession(id, server) : bro.terminal.closeSession(id)), false);
}

// ── appearance ──

function rgba(hex, alpha) {
    const h = normalizeColor(hex);
    if (!h) return null;
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return 'rgba(' + n(1) + ', ' + n(3) + ', ' + n(5) + ', ' + alpha + ')';
}

const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'];

/// A colour scheme as the element's `theme`: script-set base colours, which
/// a program's own OSC 104 / 110 / 111 / 112 resets return to.
export function themeFromScheme(scheme) {
    const sel = scheme.selectionBackground || scheme.foreground;
    return {
        foreground: scheme.foreground,
        background: scheme.background,
        cursor: scheme.cursorColor || scheme.foreground,
        selection: rgba(sel, 0.45),
        match: rgba(scheme.yellow || '#E0AF68', 0.4),
        currentMatch: rgba(scheme.brightYellow || scheme.yellow || '#FFC777', 0.75),
        ansi: ANSI_KEYS.map((k) => scheme[k]),
    };
}

export function applyTheme(el, scheme) {
    if (!scheme) return false;
    if (caps.theme) {
        try { el.theme = themeFromScheme(scheme); return true; } catch (e) {
            console.error('broterm: theme: ' + e.message);
        }
    }
    // An element without `theme`: the CSS custom properties it reads.
    el.style.setProperty('--terminal-foreground', scheme.foreground);
    el.style.setProperty('--terminal-background', scheme.background);
    ANSI_KEYS.forEach((k, i) => el.style.setProperty('--terminal-color-' + i, scheme[k]));
    return false;
}

const OPTION_KEYS = ['copyOnSelect', 'middleClickPaste', 'scrollOnInput', 'boldIsBright', 'minimumContrast',
    'ligatures', 'wheelLines', 'clipboard', 'imageMemoryLimit'];

const MIB = 1024 * 1024;
const DEFAULT_IMAGE_MIB = 320;   // the element's own default (docs/terminal-api.js)

/// The element's behaviour switches from resolved settings (see
/// ProfileSet.resolve: appearance + behaviour). Values out of range are
/// clamped here rather than thrown at.
export function optionsFrom(b) {
    const o = {};
    if (typeof b.copyOnSelect === 'boolean') o.copyOnSelect = b.copyOnSelect;
    if (typeof b.middleClickPaste === 'boolean') o.middleClickPaste = b.middleClickPaste;
    if (typeof b.scrollOnInput === 'boolean') o.scrollOnInput = b.scrollOnInput;
    if (typeof b.boldIsBright === 'boolean') o.boldIsBright = b.boldIsBright;
    if (typeof b.ligatures === 'boolean') o.ligatures = b.ligatures;
    const mc = Number(b.minimumContrast);
    if (Number.isFinite(mc)) o.minimumContrast = Math.max(1, Math.min(21, mc));
    const wl = Number(b.wheelLines);
    if (Number.isFinite(wl)) o.wheelLines = Math.max(1, Math.min(100, Math.round(wl)));
    // OSC 52: reads reach the page unless the profile denies them (the page
    // then allows or asks); writes unless clipboardWrite is off.
    const read = b.clipboardRead === 'deny' ? false : true;
    o.clipboard = read ? 'read-write' : (b.clipboardWrite === false ? 'deny' : 'write');
    // imageMemory is in MiB (0 turns images off); null is bro's default.
    const im = b.imageMemory === null || b.imageMemory === undefined || b.imageMemory === '' ? DEFAULT_IMAGE_MIB : Number(b.imageMemory);
    if (caps.images) o.imageMemoryLimit = Math.max(0, Math.min(4096, Math.round(Number.isFinite(im) ? im : DEFAULT_IMAGE_MIB))) * MIB;
    return o;
}

export function applyOptions(el, b) {
    if (!caps.options) return false;
    const o = optionsFrom(b);
    try { el.options = o; return true; } catch (e) {
        // One bad key should not lose the rest.
        for (const k of OPTION_KEYS) {
            if (!(k in o)) continue;
            try { el.options = { [k]: o[k] }; } catch (_) { console.error('broterm: option ' + k + ': ' + _.message); }
        }
        return false;
    }
}

const CURSOR_CODES = { block: [1, 2], underline: [3, 4], bar: [5, 6] };

/// The cursor shape: DECSCUSR fed to the emulator (a program can change it,
/// and RIS puts it back to the terminal's default).
export function applyCursor(el, style, blink) {
    const codes = CURSOR_CODES[style] || CURSOR_CODES.block;
    el.feed('\x1b[' + (blink === false ? codes[1] : codes[0]) + ' q');
}

export function applyScrollback(el, lines) {
    if (!(lines > 0)) return false;
    if (has('scrollbackLimit')) { el.scrollbackLimit = lines; return true; }
    if (has('scrollbackLines')) { el.scrollbackLines = lines; return true; }
    return false;
}

export function clearScrollback(el) {
    if (typeof el.clearScrollback === 'function') { el.clearScrollback(); return true; }
    el.feed('\x1b[3J');
    return true;
}

/// The cell under a point in client coordinates, or null off the grid.
export function cellAt(el, x, y) {
    const m = metrics(el);
    const v = viewport(el);
    if (!m || !v || !(m.cellWidth > 0) || !(m.cellHeight > 0)) return null;
    const r = el.getBoundingClientRect();
    const cs = safe(() => getComputedStyle(el), null);
    const padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
    const padT = cs ? parseFloat(cs.paddingTop) || 0 : 0;
    const col = Math.floor((x - r.left - padL) / m.cellWidth);
    const line = Math.floor((y - r.top - padT) / m.cellHeight);
    if (col < 0 || line < 0 || line >= v.rows) return null;
    return { row: v.topRow + line, col };
}
