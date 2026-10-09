// Keybindings in VS Code's shape: { key, command, args?, when? }.
//
//   key   "ctrl+shift+t", a chord "ctrl+k ctrl+s" (space-separated presses).
//         Modifiers: ctrl, shift, alt, meta (aliases cmd/win/super/option).
//         Key names: a-z, 0-9, f1-f24, punctuation as itself ("=", "-", ",",
//         "/", "[", ...), plus/minus as names, and up down left right home
//         end pageup pagedown insert delete backspace tab enter escape space.
//   when  a context expression: names, !, &&, ||, == / != against a quoted
//         string. Unknown names are false.
//   A command prefixed with "-" removes the bindings of that command (on that
//   key, if one is given) made before it, which is how keybindings.json takes
//   a default away.
//
// This is a deliberately small dispatcher. brokeys has the full engine (when
// clauses, chords, import/export to other applications' formats) as a C++
// library; helmterm moves to it once it has a JS binding.

const MOD_ALIASES = { ctrl: 'ctrl', control: 'ctrl', shift: 'shift', alt: 'alt', option: 'alt', opt: 'alt',
    meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta', super: 'meta' };
const KEY_ALIASES = { plus: '=', minus: '-', esc: 'escape', return: 'enter', del: 'delete', ins: 'insert',
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', pgup: 'pageup', pgdn: 'pagedown',
    comma: ',', period: '.', slash: '/', backslash: '\\', semicolon: ';', quote: "'", backquote: '`',
    bracketleft: '[', bracketright: ']', equal: '=', ' ': 'space', spacebar: 'space' };
const MOD_ORDER = ['ctrl', 'shift', 'alt', 'meta'];

const CODE_KEYS = {
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'space', Enter: 'enter', Tab: 'tab',
    Escape: 'escape', Backspace: 'backspace', Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end',
    PageUp: 'pageup', PageDown: 'pagedown', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    NumpadAdd: 'numpad_add', NumpadSubtract: 'numpad_subtract', NumpadMultiply: 'numpad_multiply',
    NumpadDivide: 'numpad_divide', NumpadEnter: 'enter', NumpadDecimal: 'numpad_decimal',
};
// Shifted punctuation on a US layout, so a key reported as its shifted
// character (e.key "+" or "!") still names the physical key.
const UNSHIFT = { '+': '=', '_': '-', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8',
    '(': '9', ')': '0', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`' };

function normalizeKeyName(k) {
    const lower = k.toLowerCase();
    return KEY_ALIASES[lower] || lower;
}

/// "Ctrl+Shift+T" -> "ctrl+shift+t" (one press, canonical order). Null when
/// it does not parse.
export function normalizePress(text) {
    const parts = String(text).trim().split('+');
    // "ctrl++" is ctrl and the + key.
    const tokens = [];
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '' && i === parts.length - 1 && tokens.length) tokens.push('+');
        else if (parts[i] !== '') tokens.push(parts[i]);
    }
    if (!tokens.length) return null;
    const mods = new Set();
    for (const t of tokens.slice(0, -1)) {
        const m = MOD_ALIASES[t.toLowerCase()];
        if (!m) return null;
        mods.add(m);
    }
    const last = tokens[tokens.length - 1];
    if (MOD_ALIASES[last.toLowerCase()]) return null;
    const key = last === '+' ? '=' : normalizeKeyName(last);
    return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

/// "ctrl+k ctrl+s" -> ["ctrl+k", "ctrl+s"]; null when any press is bad.
export function parseKeySequence(text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const presses = text.trim().split(/\s+/).map(normalizePress);
    return presses.every(Boolean) ? presses : null;
}

/// The canonical press for a KeyboardEvent, or null for a lone modifier.
export function pressFromEvent(e) {
    let key = null;
    const code = e.code || '';
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^Numpad[0-9]$/.test(code)) key = 'numpad' + code.slice(6);
    else if (/^F[0-9]{1,2}$/.test(code)) key = code.toLowerCase();
    else if (CODE_KEYS[code]) key = CODE_KEYS[code];
    if (!key) {
        const k = e.key || '';
        if (!k || ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Super', 'Hyper'].includes(k)) return null;
        if (k.length === 1) key = UNSHIFT[k] || k.toLowerCase();
        else key = normalizeKeyName(k.replace(/^Arrow/, ''));
    }
    if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta') return null;
    const mods = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.shiftKey) mods.push('shift');
    if (e.altKey) mods.push('alt');
    if (e.metaKey) mods.push('meta');
    return [...mods, key].join('+');
}

// ── when clauses ──

function tokenizeWhen(src) {
    const out = [];
    const re = /\s*(&&|\|\||==|!=|!|\(|\)|'[^']*'|"[^"]*"|[A-Za-z_][\w.]*)/y;
    let m;
    re.lastIndex = 0;
    while (re.lastIndex < src.length && (m = re.exec(src))) out.push(m[1]);
    return out;
}

/// Compile a when clause into (ctx) => boolean. A clause that does not parse
/// is never true.
export function compileWhen(src) {
    if (!src || typeof src !== 'string') return () => true;
    const t = tokenizeWhen(src);
    let i = 0;
    const peek = () => t[i];
    const next = () => t[i++];
    function primary() {
        const tok = next();
        if (tok === '!') { const f = primary(); return (c) => !f(c); }
        if (tok === '(') { const f = or(); if (next() !== ')') throw new Error(')'); return f; }
        if (!tok || !/^[A-Za-z_]/.test(tok)) throw new Error('name');
        if (peek() === '==' || peek() === '!=') {
            const op = next();
            const lit = next() || '';
            const v = lit.replace(/^['"]|['"]$/g, '');
            return op === '==' ? (c) => String(c[tok]) === v : (c) => String(c[tok]) !== v;
        }
        return (c) => !!c[tok];
    }
    function and() {
        let f = primary();
        while (peek() === '&&') { next(); const a = f, b = primary(); f = (c) => a(c) && b(c); }
        return f;
    }
    function or() {
        let f = and();
        while (peek() === '||') { next(); const a = f, b = and(); f = (c) => a(c) || b(c); }
        return f;
    }
    try {
        const f = or();
        if (i !== t.length) throw new Error('trailing');
        return f;
    } catch (e) {
        return () => false;
    }
}

// ── the keymap ──

export class Keymap {
    /// `list` is the effective binding list (defaults, then the user's).
    constructor(list) {
        this.bindings = [];
        this.problems = [];
        for (const raw of list || []) this._add(raw);
        this.pending = null;  // presses so far of a chord
    }

    _add(raw) {
        if (!raw || typeof raw.command !== 'string') { this.problems.push('a binding has no command'); return; }
        if (raw.command.startsWith('-')) {
            const cmd = raw.command.slice(1);
            const seq = raw.key ? parseKeySequence(raw.key) : null;
            this.bindings = this.bindings.filter((b) => !(b.command === cmd && (!seq || b.key === seq.join(' '))));
            return;
        }
        const seq = parseKeySequence(raw.key);
        if (!seq) { this.problems.push('"' + raw.key + '" is not a key (' + raw.command + ')'); return; }
        this.bindings.push({ key: seq.join(' '), presses: seq, command: raw.command, args: raw.args,
            when: compileWhen(raw.when), whenText: raw.when || '' });
    }

    /// Feed one press. Returns { action: 'run', binding } | { action: 'pending' }
    /// | { action: 'cancel' } (a chord that went nowhere: swallow the press)
    /// | null (not ours).
    press(press, ctx) {
        if (!press) return null;
        const seq = this.pending ? [...this.pending, press] : [press];
        const live = this.bindings.filter((b) => b.when(ctx || {}));
        // The last matching binding wins, as in VS Code.
        let exact = null;
        let prefix = false;
        for (const b of live) {
            if (b.presses.length === seq.length && b.presses.every((p, i) => p === seq[i])) exact = b;
            else if (b.presses.length > seq.length && seq.every((p, i) => b.presses[i] === p)) prefix = true;
        }
        // A press that starts a longer chord waits for the rest, even when it
        // is also bound on its own.
        if (prefix) {
            this.pending = seq;
            return { action: 'pending', sequence: seq.join(' ') };
        }
        const hadPending = !!this.pending;
        this.pending = null;
        if (exact) return { action: 'run', binding: exact };
        return hadPending ? { action: 'cancel' } : null;
    }

    /// The first key bound to `command` (with matching args, when given), for
    /// menus and the palette. '' when unbound.
    keyFor(command, args) {
        // No args asked for: a binding without args, if there is one.
        const want = JSON.stringify(args === undefined ? {} : args);
        const mine = this.bindings.filter((b) => b.command === command);
        const exact = mine.find((b) => JSON.stringify(b.args === undefined ? {} : b.args) === want);
        if (exact) return exact.key;
        return args === undefined && mine.length ? mine[0].key : '';
    }
}

/// A key as people read it: "ctrl+shift+t" -> "Ctrl+Shift+T".
export function displayKey(key) {
    if (!key) return '';
    return key.split(' ').map((press) => press.split('+').map((p) => {
        if (p === 'meta') return typeof process !== 'undefined' && process.platform === 'darwin' ? 'Cmd' : 'Meta';
        if (p.length === 1) return p.toUpperCase();
        return p[0].toUpperCase() + p.slice(1);
    }).join('+')).join(' ');
}
