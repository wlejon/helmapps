// The host: what broterm's native side and bro's runtime give the UI.
//
// bro.broterm is installed by broterm's own executable (src/host_bindings.cpp).
// Running the UI under a stock bro / bro-headless (no bro.broterm) still
// works: the configuration directory falls back to the same platform rule,
// and the platform probes answer "nothing found".

const fs = require('fs');
const path = require('path');
const os = require('os');

const native = (typeof bro !== 'undefined' && bro.broterm) ? bro.broterm : null;

const platform = process.platform;  // 'win32' | 'linux' | 'darwin'

function env(name) {
    const v = process.env[name];
    return typeof v === 'string' ? v : '';
}

function fallbackConfigDir() {
    if (env('BROTERM_CONFIG_DIR')) return env('BROTERM_CONFIG_DIR');
    if (platform === 'win32') return path.join(env('APPDATA') || os.homedir(), 'broterm');
    if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'broterm');
    const xdg = env('XDG_CONFIG_HOME');
    return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config'), 'broterm');
}

function ensureDir(dir) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* reported on first write */ }
    return dir;
}

// A headless run (tests, scripted use) has the driver's globals. The app
// never quits the process there: the script that drives it decides.
const headless = typeof advanceTime === 'function' && typeof flush === 'function';

let notifier;  // the notify-send / osascript path, found once
function notifyByCommand(title, body) {
    if (platform === 'win32') return false;
    try {
        const cp = require('child_process');
        if (notifier === undefined) {
            notifier = null;
            for (const d of (env('PATH') || '').split(':')) {
                if (platform === 'darwin' && fs.existsSync(path.join(d, 'osascript'))) { notifier = path.join(d, 'osascript'); break; }
                if (platform !== 'darwin' && fs.existsSync(path.join(d, 'notify-send'))) { notifier = path.join(d, 'notify-send'); break; }
            }
        }
        if (!notifier) return false;
        const args = platform === 'darwin'
            ? ['-e', 'display notification ' + JSON.stringify(body) + ' with title ' + JSON.stringify(title || 'broterm')]
            : ['--app-name=broterm', title || 'broterm', body];
        cp.spawn(notifier, args, { detached: true, stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

export const host = {
    platform,
    headless,
    native: !!native,
    version: native ? native.version : '0.0.0-dev',
    argv: native && Array.isArray(native.argv) ? native.argv.slice() : [],
    configDir: ensureDir(native ? native.configDir : fallbackConfigDir()),
    exePath: native ? native.exePath : (process.execPath || ''),
    homeDir: native && native.homeDir ? native.homeDir : os.homedir(),
    // The bundled UI's directory (shell-integration scripts live under it).
    uiDir: typeof bro !== 'undefined' && bro.appDir ? bro.appDir : '',
    pathSep: path.sep,
    env,

    loginShell() {
        return native && typeof native.loginShell === 'function' ? native.loginShell() : '';
    },
    wslDistributions() {
        if (!native || typeof native.wslDistributions !== 'function') return [];
        try { return native.wslDistributions() || []; } catch (e) { return []; }
    },
    setWindowTitle(title) {
        if (typeof bro !== 'undefined' && bro.window && typeof bro.window.setTitle === 'function') {
            bro.window.setTitle(String(title));
        } else if (typeof document !== 'undefined') {
            document.title = String(title);
        }
    },
    terminalAvailable() {
        return typeof bro !== 'undefined' && bro.terminal && bro.terminal.available === true;
    },
    defaultShell() {
        return typeof bro !== 'undefined' && bro.terminal ? (bro.terminal.defaultShell || '') : '';
    },
    quit() {
        if (headless) return false;
        if (typeof bro !== 'undefined' && typeof bro.quit === 'function') { bro.quit(); return true; }
        return false;
    },
    // A second broterm process: what "new window" is until bro can open a
    // second top-level window that hosts the same application.
    spawnSelf(args) {
        if (!this.exePath || headless) return false;
        try {
            require('child_process').spawn(this.exePath, args || [], { detached: true, stdio: 'ignore' });
            return true;
        } catch (e) {
            console.error('broterm: new window failed: ' + e.message);
            return false;
        }
    },

    // ── the clipboard ──
    // What broterm itself copies (a command's output, a command line) and
    // reads (answering a program's OSC 52 request). Headless keeps it in the
    // process, as bro's <terminal> does, so a test never touches the user's
    // clipboard.
    clipboard: {
        local: '',
        write(text) {
            const t = String(text == null ? '' : text);
            if (headless || typeof navigator === 'undefined' || !navigator.clipboard) { this.local = t; return Promise.resolve(true); }
            return navigator.clipboard.writeText(t).then(() => true, (e) => {
                console.error('broterm: clipboard write: ' + (e && e.message));
                return false;
            });
        },
        read() {
            if (headless || typeof navigator === 'undefined' || !navigator.clipboard) return Promise.resolve(this.local);
            return navigator.clipboard.readText().then((t) => t || '', () => '');
        },
    },

    // ── the desktop ──
    // Notifications, taskbar attention and progress, the bell sound, window
    // focus. bro.window provides them natively in the engine. Headless records
    // what was asked in `desktopLog`, which is what the tests read.
    desktopLog: [],
    desktop(kind, ...args) {
        if (headless) { this.desktopLog.push({ kind, args }); return false; }
        if (typeof bro !== 'undefined' && bro.window) {
            try {
                if (kind === 'notify' && typeof bro.window.notify === 'function') {
                    return bro.window.notify(String(args[0] || ''), String(args[1] || ''));
                }
                if (kind === 'attention' && typeof bro.window.requestAttention === 'function') {
                    return bro.window.requestAttention(!!args[0]);
                }
                if (kind === 'progress' && typeof bro.window.setProgress === 'function') {
                    return bro.window.setProgress(args[0] | 0, args[1] | 0);
                }
                if (kind === 'beep' && typeof bro.window.beep === 'function') {
                    return bro.window.beep();
                }
            } catch (e) {
                console.error('broterm: bro.window ' + kind + ': ' + e.message);
            }
        }
        if (kind === 'notify') {
            return notifyByCommand(String(args[0] || ''), String(args[1] || ''));
        }
        return false;
    },
    /// Whether the window has the keyboard: bro.window.focused, else the
    /// page's visibility (bro hides the page when the window loses focus).
    windowFocused() {
        if (typeof bro !== 'undefined' && bro.window && typeof bro.window.focused === 'boolean') {
            return bro.window.focused;
        }
        if (typeof document !== 'undefined' && document.visibilityState) return document.visibilityState !== 'hidden';
        return true;
    },

    // ── files ──
    exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } },
    isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } },
    isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } },
    readText(p) { try { return fs.readFileSync(p, 'utf-8'); } catch (e) { return null; } },
    writeText(p, text) {
        ensureDir(path.dirname(p));
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, text, 'utf-8');
        try { fs.renameSync(tmp, p); } catch (e) { fs.writeFileSync(p, text, 'utf-8'); try { fs.unlinkSync(tmp); } catch (_) {} }
    },
    join(...parts) { return path.join(...parts); },
    basename(p, ext) { return path.basename(p, ext); },
    dirname(p) { return path.dirname(p); },
    resolve(...parts) { return path.resolve(...parts); },
    isAbsolute(p) { return path.isAbsolute(p); },
    cwd() { try { return process.cwd(); } catch (e) { return this.homeDir; } },
    watchDir(dir, onChange) {
        try {
            const w = fs.watch(dir, {}, (event, filename) => onChange(event, filename || ''));
            if (w && typeof w.on === 'function') w.on('error', (err) => console.error('broterm: watch: ' + err.message));
            return w;
        } catch (e) {
            console.error('broterm: cannot watch ' + dir + ': ' + e.message);
            return null;
        }
    },
    // The first match for `exe` on PATH (with PATHEXT on Windows), or ''.
    which(exe) {
        const dirs = env(platform === 'win32' ? 'Path' : 'PATH') || env('PATH');
        if (!dirs) return '';
        const exts = platform === 'win32' && !/\.[a-z0-9]+$/i.test(exe)
            ? (env('PATHEXT') || '.EXE;.CMD;.BAT').split(';') : [''];
        for (const d of dirs.split(path.delimiter)) {
            if (!d) continue;
            for (const ext of exts) {
                const p = path.join(d, exe + ext.toLowerCase());
                if (this.isFile(p)) return p;
                if (ext) {
                    const q = path.join(d, exe + ext);
                    if (this.isFile(q)) return q;
                }
            }
        }
        return '';
    },
};
