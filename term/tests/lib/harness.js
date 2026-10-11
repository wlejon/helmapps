// Shared helpers for helmterm's headless UI tests. Each test runs the real app
// under the stock bro-headless with fresh per-app directories (BRO_APP_HOME,
// set by scripts/run_tests.sh), real processes and the real file watcher.

const fs = require('fs');
const path = require('path');

export const app = window.helmterm;

/// Pump frames and give real threads (PTYs, the watcher) wall time until
/// `pred()` holds. Fails the test when it never does.
export function waitFor(pred, what, ms) {
    const end = Date.now() + (ms || 15000);
    while (Date.now() < end) {
        advanceTime(16);
        let ok = false;
        try { ok = !!pred(); } catch (e) { ok = false; }
        if (ok) return true;
        wallSleep(10);
    }
    let ok = false;
    try { ok = !!pred(); } catch (e) { ok = false; }
    assert(ok, 'timed out waiting for ' + what);
    return ok;
}

/// Let `ms` of wall time pass while pumping.
export function settle(ms) {
    const end = Date.now() + (ms || 200);
    while (Date.now() < end) { advanceTime(16); wallSleep(10); }
}

export function eq(actual, expected, what) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    assert(a === e, what + ': got ' + a + ', want ' + e);
}

/// The test child beside the headless binary (HELMTERM_TESTCHILD overrides).
export const CHILD = process.env.HELMTERM_TESTCHILD || path.join(path.dirname(process.execPath),
    process.platform === 'win32' ? 'helmterm-testchild.exe' : 'helmterm-testchild');

export function childAvailable() { return fs.existsSync(CHILD); }

export const configDir = app ? app.settings.dir : '';

let reportSeq = 0;
/// A fresh path for a test child's report file.
export function reportPath(tag) {
    return path.join(configDir, 'report-' + (tag || 'child') + '-' + (++reportSeq) + '.json');
}

export function readReport(file, what) {
    waitFor(() => fs.existsSync(file), (what || 'the child') + ' to write ' + file, 20000);
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/// Write settings.json and wait for the watcher to load it.
export function writeSettings(obj) {
    const gen = app.settings.generation;
    fs.writeFileSync(app.settings.settingsPath, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
    waitFor(() => app.settings.generation > gen, 'settings.json to reload', 10000);
}

export function writeKeybindings(list) {
    const gen = app.settings.generation;
    fs.writeFileSync(app.settings.keybindingsPath, JSON.stringify(list, null, 2));
    waitFor(() => app.settings.generation > gen, 'keybindings.json to reload', 10000);
}

// ── keys, as SDL delivers them ──

export const mod = process.platform === 'darwin' ? 'cmd' : 'ctrl';
const MOD = { shift: 0x0001, ctrl: 0x0040, alt: 0x0100, meta: 0x0400, cmd: 0x0400 };
const SPECIAL = {
    enter: [13, 40], escape: [27, 41], backspace: [8, 42], tab: [9, 43], space: [32, 44],
    right: [0x4000004f, 79], left: [0x40000050, 80], down: [0x40000051, 81], up: [0x40000052, 82],
    pageup: [0x4000004b, 75], pagedown: [0x4000004e, 78], home: [0x4000004a, 74], end: [0x4000004d, 77],
    delete: [127, 76], insert: [0x40000049, 73],
    '-': [45, 45], '=': [61, 46], '[': [91, 47], ']': [93, 48], '\\': [92, 49], ';': [59, 51],
    "'": [39, 52], '`': [96, 53], ',': [44, 54], '.': [46, 55], '/': [47, 56],
};

function sdlKey(name) {
    if (SPECIAL[name]) return SPECIAL[name];
    if (/^[a-z]$/.test(name)) return [name.charCodeAt(0), 4 + name.charCodeAt(0) - 97];
    if (/^[1-9]$/.test(name)) return [name.charCodeAt(0), 30 + Number(name) - 1];
    if (name === '0') return [48, 39];
    const f = /^f(\d{1,2})$/.exec(name);
    if (f) { const n = Number(f[1]); return [0x4000003a + n - 1, 58 + n - 1]; }
    throw new Error('no SDL key for ' + name);
}

/// Press a key chord like "ctrl+shift+t" through the engine's input path.
export function press(chord) {
    const parts = chord.split('+');
    const key = parts.pop() || '+';
    let mod = 0;
    for (const m of parts) mod |= MOD[m] || 0;
    const [code, scan] = sdlKey(key);
    keyDown(code, scan, mod);
    const printable = key.length === 1 && !(mod & (MOD.ctrl | MOD.alt | MOD.meta));
    if (printable) textInput(mod & MOD.shift ? key.toUpperCase() : key);
    keyUp(code, scan, mod);
    advanceTime(16);
}

/// Type text into whatever has the focus.
export function type(text) {
    textInput(text);
    advanceTime(16);
}

export function center(el) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
}

export function clickEl(el) {
    if (typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
        advanceTime(16);
    }
    const [x, y] = center(el);
    click(x, y);
    advanceTime(16);
}

/// A profile entry that runs the test child, reporting to `report`.
export function childProfile(name, report, extra) {
    const p = { name, command: CHILD, args: [], env: { TESTCHILD_REPORT: report } };
    if (extra) {
        for (const [k, v] of Object.entries(extra)) {
            if (k === 'env') Object.assign(p.env, v); else p[k] = v;
        }
    }
    return p;
}

export function requireApp() {
    if (!app) { assert(false, 'window.helmterm is missing: the UI did not start'); return false; }
    if (!bro.terminal || !bro.terminal.available) {
        skipTest('<terminal> is compiled out of this build');
        return false;
    }
    return true;
}
