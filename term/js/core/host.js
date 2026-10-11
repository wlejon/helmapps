// The host: what bro's runtime gives the UI. term is a folder app run by
// the stock bro binary, so everything here is a standard bro API: bro.app
// (identity, argv, per-app directories, the single-instance hand-off,
// spawning another instance), bro.window (the desktop), bro.terminal, and
// brokit's Node modules.

const fs = require('fs');
const path = require('path');
const os = require('os');

const app = (typeof bro !== 'undefined' && bro.app) ? bro.app : null;

const platform = process.platform;  // 'win32' | 'linux' | 'darwin'

function env(name) {
    const v = process.env[name];
    return typeof v === 'string' ? v : '';
}

function ensureDir(dir) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* reported on first write */ }
    return dir;
}

// The configuration directory: bro.app.configDir (keyed by bro.json's id).
// The first run brings over settings left by broterm, the native app this
// one replaced, so nobody's profiles and keybindings vanish.
function configDir() {
    const dir = ensureDir(app ? app.configDir : path.join(os.homedir(), '.bro-term'));
    try {
        if (env('BRO_APP_HOME') || fs.existsSync(path.join(dir, 'settings.json'))) return dir;
        let old;
        if (platform === 'win32') old = path.join(env('APPDATA') || os.homedir(), 'broterm');
        else if (platform === 'darwin') old = path.join(os.homedir(), 'Library', 'Application Support', 'broterm');
        else {
            const xdg = env('XDG_CONFIG_HOME');
            old = path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.config'), 'broterm');
        }
        for (const name of ['settings.json', 'keybindings.json']) {
            const from = path.join(old, name);
            if (fs.existsSync(from)) fs.writeFileSync(path.join(dir, name), fs.readFileSync(from, 'utf-8'), 'utf-8');
        }
    } catch (e) {
        console.error('term: cannot bring over broterm settings: ' + e.message);
    }
    return dir;
}

function loginShell() {
    try {
        const info = os.userInfo();
        return info && typeof info.shell === 'string' ? info.shell : '';
    } catch (e) {
        return '';
    }
}

// A headless run (tests, scripted use) has the driver's globals. The app
// never quits the process there: the script that drives it decides.
const headless = typeof advanceTime === 'function' && typeof flush === 'function';

export const host = {
    platform,
    headless,
    id: app ? app.id : 'helm.term',
    // The window's title when no tab names one (bro.json's name).
    name: app && app.name ? app.name : 'Terminal',
    version: app && app.version ? app.version : '0.0.0-dev',
    argv: app && Array.isArray(app.argv) ? app.argv.slice() : [],
    configDir: configDir(),
    exePath: app ? app.exePath : (process.execPath || ''),
    homeDir: os.homedir(),
    // The app's folder (shell-integration scripts live under it).
    uiDir: app ? app.dir : (typeof bro !== 'undefined' && bro.appDir ? bro.appDir : ''),
    pathSep: path.sep,
    env,

    loginShell,
    wslDistributions() {
        if (typeof bro === 'undefined' || !bro.terminal || typeof bro.terminal.wslDistributions !== 'function') return [];
        try { return bro.terminal.wslDistributions() || []; } catch (e) { return []; }
    },
    /// Another launch's command line and working directory, handed over
    /// because bro.json declares singleInstance. bro raises the window.
    onInstance(fn) {
        if (app && typeof app.addEventListener === 'function') {
            app.addEventListener('instance', (e) => fn(e.argv, e.cwd));
        }
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
    // A second term process (bypassing the single-instance hand-off):
    // what "new window" is until bro can open a second top-level window that
    // hosts the same application.
    spawnSelf(args) {
        if (!app || typeof app.spawn !== 'function' || headless) return false;
        try {
            return app.spawn(args || [], { newInstance: true });
        } catch (e) {
            console.error('term: new window failed: ' + e.message);
            return false;
        }
    },

    // ── the clipboard ──
    // What term itself copies (a command's output, a command line) and
    // reads (answering a program's OSC 52 request). Headless keeps it in the
    // process, as bro's <terminal> does, so a test never touches the user's
    // clipboard.
    clipboard: {
        local: '',
        write(text) {
            const t = String(text == null ? '' : text);
            if (headless || typeof navigator === 'undefined' || !navigator.clipboard) { this.local = t; return Promise.resolve(true); }
            return navigator.clipboard.writeText(t).then(() => true, (e) => {
                console.error('term: clipboard write: ' + (e && e.message));
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
    // focus. bro.window provides them natively in the engine (a notification
    // is a toast on Windows, the notification center on macOS, D-Bus on
    // Linux, under the app's own id and name). Headless records
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
                console.error('term: bro.window ' + kind + ': ' + e.message);
            }
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
            if (w && typeof w.on === 'function') w.on('error', (err) => console.error('term: watch: ' + err.message));
            return w;
        } catch (e) {
            console.error('term: cannot watch ' + dir + ': ' + e.message);
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
