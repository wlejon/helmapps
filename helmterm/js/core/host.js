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

export const host = {
    platform,
    headless,
    native: !!native,
    version: native ? native.version : '0.0.0-dev',
    argv: native && Array.isArray(native.argv) ? native.argv.slice() : [],
    configDir: ensureDir(native ? native.configDir : fallbackConfigDir()),
    exePath: native ? native.exePath : (process.execPath || ''),
    homeDir: native && native.homeDir ? native.homeDir : os.homedir(),
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
        if (native && typeof native.setWindowTitle === 'function') native.setWindowTitle(String(title));
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
