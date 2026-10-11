// Profiles: what a new tab or pane runs, and how it looks.
//
// The list is the shells detected on this machine followed by the user's own
// (settings.profiles.list). A user profile whose name matches a detected one
// overrides that profile's fields instead of adding a second; `hidden: true`
// keeps a profile out of the menus. settings.profiles.defaults sits under
// every profile, and the top-level appearance settings under that.

import { host } from './host.js';
import { applyIntegration } from '../term/integration.js';

const APPEARANCE_KEYS = ['colorScheme', 'font', 'cursorStyle', 'cursorBlink', 'padding', 'scrollback', 'opacity'];

/// Behaviour every profile can override (defaults.js has what each means).
export const BEHAVIOUR_KEYS = ['copyOnSelect', 'middleClickPaste', 'scrollOnInput', 'boldIsBright', 'minimumContrast',
    'ligatures', 'wheelLines', 'clipboardWrite', 'clipboardRead', 'shellIntegration', 'suppressApplicationTitle',
    'bell', 'warnOnMultiLinePaste', 'trimPasteTrailingNewline', 'imageMemory'];

function profile(name, command, args, extra) {
    return { name, command, args: args || [], cwd: null, env: {}, source: 'detected', isShell: true, ...extra };
}

function detectWindows() {
    const out = [];
    const sysRoot = host.env('SystemRoot') || 'C:\\Windows';
    const programFiles = [host.env('ProgramFiles'), host.env('ProgramW6432'), host.env('ProgramFiles(x86)')]
        .filter(Boolean);

    // PowerShell 7 (and a preview, if that is all there is).
    let pwsh = '';
    for (const pf of programFiles) {
        for (const v of ['7', '7-preview']) {
            const p = host.join(pf, 'PowerShell', v, 'pwsh.exe');
            if (!pwsh && host.isFile(p)) pwsh = p;
        }
    }
    if (!pwsh) pwsh = host.which('pwsh.exe');
    if (pwsh) out.push(profile('PowerShell', pwsh, ['-NoLogo'], { id: 'pwsh', icon: 'pwsh' }));

    const winps = host.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (host.isFile(winps)) out.push(profile('Windows PowerShell', winps, ['-NoLogo'], { id: 'powershell', icon: 'powershell' }));

    const cmd = host.env('ComSpec') || host.join(sysRoot, 'System32', 'cmd.exe');
    if (host.isFile(cmd)) out.push(profile('Command Prompt', cmd, [], { id: 'cmd', icon: 'cmd' }));

    // Git Bash: bin/bash.exe is the launcher that sets MSYS up. CHERE_INVOKING
    // keeps a login shell in the directory it was started in.
    const gitRoots = [...programFiles.map((pf) => host.join(pf, 'Git')),
        host.join(host.env('LOCALAPPDATA') || '', 'Programs', 'Git')];
    for (const root of gitRoots) {
        const bash = host.join(root, 'bin', 'bash.exe');
        if (host.isFile(bash)) {
            out.push(profile('Git Bash', bash, ['--login', '-i'],
                { id: 'gitbash', icon: 'bash', env: { CHERE_INVOKING: '1', MSYSTEM: 'MINGW64' } }));
            break;
        }
    }

    // WSL distributions, from the registry (docker-desktop's are not shells).
    const wsl = host.join(sysRoot, 'System32', 'wsl.exe');
    if (host.isFile(wsl)) {
        for (const d of host.wslDistributions()) {
            if (!d || !d.name || /^docker-desktop/i.test(d.name)) continue;
            out.push(profile(d.name, wsl, ['-d', d.name], {
                id: 'wsl:' + d.name, icon: 'linux', wsl: true, wslDefault: !!d.isDefault,
            }));
        }
    }
    return out;
}

function shellsFromEtcShells() {
    const text = host.readText('/etc/shells') || '';
    return text.split('\n').map((l) => l.trim()).filter((l) => l && l[0] === '/');
}

function detectPosix() {
    const out = [];
    const seen = new Set();
    const loginArgs = host.platform === 'darwin' ? ['-l'] : [];
    const add = (name, path, extra) => {
        if (!path || seen.has(path) || !host.isFile(path)) return;
        seen.add(path);
        out.push(profile(name, path, loginArgs, { id: 'shell:' + host.basename(path), icon: host.basename(path), ...extra }));
    };

    const login = host.loginShell() || host.env('SHELL');
    if (login) add(host.basename(login), login, { loginShell: true });

    const candidates = new Map();  // basename -> first path found
    const dirs = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
    for (const p of shellsFromEtcShells()) {
        const b = host.basename(p);
        if (!candidates.has(b)) candidates.set(b, p);
    }
    for (const b of ['bash', 'zsh', 'fish']) {
        if (candidates.has(b) && host.isFile(candidates.get(b))) continue;
        for (const d of dirs) {
            const p = host.join(d, b);
            if (host.isFile(p)) { candidates.set(b, p); break; }
        }
    }
    const loginBase = login ? host.basename(login) : '';
    for (const b of ['bash', 'zsh', 'fish']) {
        if (b === loginBase) continue;  // already there as the login shell
        if (candidates.has(b)) add(b, candidates.get(b));
    }
    const def = host.defaultShell();
    if (def && !out.some((p) => host.basename(p.command) === host.basename(def))) add('Default shell', def);
    return out;
}

/// The shells found on this machine, in menu order.
export function detectProfiles() {
    const list = host.platform === 'win32' ? detectWindows() : detectPosix();
    if (!list.length) {
        const def = host.defaultShell();
        list.push(profile('Shell', def || '', [], { id: 'default' }));
    }
    return list;
}

function clean(raw) {
    const p = { ...raw };
    if (!Array.isArray(p.args)) p.args = typeof p.args === 'string' && p.args ? p.args.split(' ') : [];
    p.args = p.args.map(String);
    if (p.env == null || typeof p.env !== 'object') p.env = {};
    if (p.cwd === undefined && typeof p.startingDirectory === 'string') p.cwd = p.startingDirectory;
    return p;
}

export class ProfileSet {
    constructor(detected) {
        this.detected = detected || detectProfiles();
        this.list = [];
        this.settings = null;
    }

    /// Rebuild from settings (called on every settings load).
    apply(settings) {
        this.settings = settings;
        const user = (settings.profiles && Array.isArray(settings.profiles.list)) ? settings.profiles.list : [];
        const byName = new Map();
        const list = [];
        for (const d of this.detected) {
            const p = clean(d);
            byName.set(p.name, p);
            list.push(p);
        }
        for (const raw of user) {
            if (!raw || typeof raw.name !== 'string' || !raw.name) continue;
            const existing = byName.get(raw.name);
            if (existing) {
                Object.assign(existing, clean({ ...existing, ...raw }), { source: existing.source, overridden: true });
            } else {
                const p = clean({ ...raw, source: 'user', isShell: raw.isShell === true });
                byName.set(p.name, p);
                list.push(p);
            }
        }
        this.list = list;
        this.byName = byName;
        return this;
    }

    visible() { return this.list.filter((p) => !p.hidden); }

    get(name) { return name && this.byName ? this.byName.get(name) || null : null; }

    /// The profile new tabs open with.
    defaultProfile() {
        const s = this.settings || {};
        const named = this.get(s.defaultProfile);
        if (named) return named;
        const vis = this.visible();
        if (host.platform === 'win32') {
            return vis.find((p) => p.id === 'pwsh') || vis.find((p) => p.id === 'powershell') || vis[0] || this.list[0];
        }
        return vis.find((p) => p.loginShell) || vis[0] || this.list[0];
    }

    /// Everything a pane needs to start and draw a profile: the launch spec
    /// (command, args, cwd, env) and the appearance, with the per-profile
    /// defaults and the global settings filled in underneath.
    resolve(p, overrides) {
        const s = this.settings || {};
        const defs = (s.profiles && s.profiles.defaults) || {};
        const o = overrides || {};
        const pick = (k) => (p[k] !== undefined ? p[k] : defs[k] !== undefined ? defs[k] : s[k]);
        const appearance = {};
        for (const k of APPEARANCE_KEYS) appearance[k] = pick(k);
        appearance.font = { ...(s.font || {}), ...(defs.font || {}), ...(p.font || {}) };
        const behaviour = {};
        for (const k of BEHAVIOUR_KEYS) behaviour[k] = pick(k);

        let command = p.command || '';
        let args = p.args ? p.args.slice() : [];
        if (o.commandline && o.commandline.length) {
            command = o.commandline[0];
            args = o.commandline.slice(1);
        }
        let cwd = o.cwd || p.cwd || defs.cwd || null;
        if (cwd === '~') cwd = host.homeDir;
        else if (typeof cwd === 'string' && cwd.startsWith('~/')) cwd = host.join(host.homeDir, cwd.slice(2));
        if (p.wsl && !(o.commandline && o.commandline.length)) {
            // wsl.exe starts in the Linux home unless asked otherwise; an
            // explicit Windows directory is translated by WSL itself.
            if (!cwd) args.push('--cd', '~');
        }
        if (!cwd && !p.wsl) cwd = host.homeDir;

        const env = {
            TERM_PROGRAM: 'helmterm',
            TERM_PROGRAM_VERSION: host.version,
            COLORTERM: 'truecolor',
            ...(host.platform !== 'win32' ? { TERM: 'xterm-256color' } : {}),
            ...(s.environment || {}),
            ...(defs.env || {}),
            ...(p.env || {}),
            ...(o.env || {}),
        };
        for (const k of Object.keys(env)) env[k] = String(env[k]);
        const launch = {
            profile: p,
            spawn: { command, args, cwd: cwd || undefined, env },
            appearance,
            behaviour,
            // A title the tab keeps (the command line's -t, a restored
            // rename). The profile's tabTitle is not one: it is what the tab
            // shows until the program names itself (see term/titles.js).
            title: o.title || null,
        };
        return applyIntegration(launch, o);
    }

    /// A profile's own starting directory, if it names one.
    fixedCwd(p) {
        const defs = (this.settings && this.settings.profiles && this.settings.profiles.defaults) || {};
        return p.cwd || defs.cwd || null;
    }
}
