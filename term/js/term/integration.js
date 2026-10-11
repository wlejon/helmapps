// Shell integration: helmterm's scripts loaded into a shell at launch, so it
// marks its prompts, commands and exit codes (OSC 133 A/B/C/D), reports its
// directory (OSC 7) and the command line (OSC 633;E) where it can. The
// user's own startup files are never edited; each shell is given ours by a
// route that still runs theirs:
//
//   pwsh, powershell  -NoExit -Command ". '<ui>/shell-integration/powershell/helmterm.ps1'"
//                     (the profile loads first, as usual, then ours)
//   bash              --init-file <ui>/shell-integration/bash/helmterm.bash, which
//                     sources ~/.bashrc (or, for a login shell, /etc/profile and
//                     the first of ~/.bash_profile, ~/.bash_login, ~/.profile)
//   zsh               ZDOTDIR=<ui>/shell-integration/zsh, whose files source the
//                     user's real ZDOTDIR files and then hand ZDOTDIR back
//   fish              <ui>/shell-integration/fish prepended to XDG_DATA_DIRS, so
//                     fish loads vendor_conf.d/helmterm.fish; it then removes
//                     itself from XDG_DATA_DIRS
//
// A profile turns this off with "shellIntegration": false. Nothing is
// injected into a command line given on its own (-- cmd ..., a session's
// commandline), into WSL (the scripts live on the Windows side), or into a
// shell whose arguments make it run a script or a command rather than a
// prompt.

import { host } from '../core/host.js';

function stem(p) { return String(p || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase(); }

/// Which integration a command takes: 'powershell' | 'bash' | 'zsh' | 'fish' | null.
export function shellKind(command) {
    const s = stem(command);
    if (s === 'pwsh' || s === 'pwsh-preview' || s === 'powershell') return 'powershell';
    if (s === 'bash') return 'bash';
    if (s === 'zsh') return 'zsh';
    if (s === 'fish') return 'fish';
    return null;
}

export function scriptsDir() {
    const ui = host.uiDir;
    return ui ? host.join(ui, 'shell-integration') : '';
}

function fwd(p) { return host.platform === 'win32' ? p.replace(/\\/g, '/') : p; }

const PS_NONINTERACTIVE = /^-(c|com|comm|comma|comman|command|f|fi|fil|file|e|ec|enc|encodedcommand|noni|noninteractive|commandwithargs|cwa)$/i;

function interactive(kind, args) {
    for (const a of args) {
        if (kind === 'powershell') { if (PS_NONINTERACTIVE.test(a)) return false; continue; }
        if (!a.startsWith('-')) return false;  // a script to run
        if (a === '--') return false;
        if (kind === 'bash' && (a === '-c' || a === '--rcfile' || a === '--init-file' || a === '--norc' || a === '--posix' || a === '-s')) return false;
        if (kind === 'zsh' && (a === '-c' || a === '-f' || a === '--no-rcs' || a === '-s')) return false;
        if (kind === 'fish' && (a === '-c' || a === '--command' || a === '-N' || a === '--no-config')) return false;
    }
    return true;
}

/// Load the integration into a launch spec (ProfileSet.resolve's answer).
/// Mutates launch.spawn and sets launch.integration to the kind, or null.
export function applyIntegration(launch, opts) {
    launch.integration = null;
    const o = opts || {};
    const p = launch.profile || {};
    if (launch.behaviour && launch.behaviour.shellIntegration === false) return launch;
    if (o.commandline && o.commandline.length) return launch;
    if (p.wsl) return launch;
    const spawn = launch.spawn;
    const kind = shellKind(spawn.command);
    const dir = scriptsDir();
    if (!kind || !dir || !host.isDir(dir)) return launch;
    const args = spawn.args.slice();
    if (!interactive(kind, args)) return launch;
    const env = spawn.env;
    env.HELMTERM_SHELL_INTEGRATION = '1';

    if (kind === 'powershell') {
        const script = host.join(dir, 'powershell', 'helmterm.ps1');
        if (!host.isFile(script)) return launch;
        spawn.args = [...args, '-NoExit', '-Command', ". '" + script.replace(/'/g, "''") + "'"];
    } else if (kind === 'bash') {
        const script = host.join(dir, 'bash', 'helmterm.bash');
        if (!host.isFile(script)) return launch;
        let login = false;
        const rest = [];
        for (const a of args) {
            if (a === '--login' || a === '-l') { login = true; continue; }
            if (/^-[a-z]+$/.test(a) && a.includes('l') && !a.startsWith('--')) {
                login = true;
                const left = a.replace(/l/g, '');
                if (left !== '-') rest.push(left);
                continue;
            }
            rest.push(a);
        }
        if (!rest.some((a) => /^-[a-z]*i[a-z]*$/.test(a))) rest.push('-i');
        if (login) env.HELMTERM_BASH_LOGIN = '1';
        // Long options before single-letter ones: bash insists.
        spawn.args = ['--init-file', fwd(script), ...rest];
    } else if (kind === 'zsh') {
        const zdir = host.join(dir, 'zsh');
        if (!host.isFile(host.join(zdir, '.zshrc'))) return launch;
        const userZ = env.ZDOTDIR || host.env('ZDOTDIR');
        if (userZ) env.HELMTERM_USER_ZDOTDIR = userZ;
        env.ZDOTDIR = zdir;
    } else if (kind === 'fish') {
        const fdir = host.join(dir, 'fish');
        if (!host.isFile(host.join(fdir, 'fish', 'vendor_conf.d', 'helmterm.fish'))) return launch;
        const prior = env.XDG_DATA_DIRS || host.env('XDG_DATA_DIRS');
        if (!prior) env.HELMTERM_XDG_DATA_DIRS_UNSET = '1';
        env.HELMTERM_FISH_DATA = fdir;
        env.XDG_DATA_DIRS = fdir + ':' + (prior || '/usr/local/share:/usr/share');
    }
    launch.integration = kind;
    return launch;
}
