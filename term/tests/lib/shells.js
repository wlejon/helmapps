// Real shells for the shell-integration tests: which exist on this machine,
// a private home for each run (so the user's own startup files are neither
// read nor touched), and how to drive one at its prompt.

import { app, waitFor } from './harness.js';

const fs = require('fs');
const path = require('path');

export const WIN = process.platform === 'win32';

function shellKind(command) {
    const s = String(command || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
    if (s === 'pwsh' || s === 'pwsh-preview' || s === 'powershell') return 'powershell';
    return ['bash', 'zsh', 'fish'].includes(s) ? s : null;
}

/// The detected profiles that run an integrated shell, by kind:
/// { powershell: [...], bash: [...], zsh: [...], fish: [...] }.
export function shellProfiles() {
    const out = { powershell: [], bash: [], zsh: [], fish: [] };
    for (const p of app.profiles.detected) {
        if (p.wsl) continue;
        const k = shellKind(p.command);
        if (k) out[k].push(p);
    }
    return out;
}

/// A fresh home with startup files that leave marks, for bash, zsh and fish.
export function makeHome(tag) {
    const home = path.join(app.settings.dir, 'home-' + tag);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, '.bashrc'), 'export BRO_TERM_T_RC=bashrc\n');
    fs.writeFileSync(path.join(home, '.bash_profile'), 'export BRO_TERM_T_LOGIN=bash_profile\n. "$HOME/.bashrc"\n');
    fs.writeFileSync(path.join(home, '.zshrc'), 'export BRO_TERM_T_RC=zshrc\nPS1="zsh> "\n');
    fs.mkdirSync(path.join(home, '.config', 'fish'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'fish', 'config.fish'), 'set -gx BRO_TERM_T_RC fishrc\n');
    return home;
}

/// Environment that points a shell at that home.
export function homeEnv(home) {
    return { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), HISTFILE: path.join(home, '.hist') };
}

/// The command lines each shell needs for the tests.
export function script(kind) {
    if (kind === 'powershell') {
        return {
            ok: 'echo term-one',
            fail: WIN ? 'cmd /c exit 3' : "bash -c 'exit 3'",
            failCode: 3,
            show: (v) => 'echo "' + v + '=$env:' + v + '"',
            cd: (d) => "Set-Location -LiteralPath '" + d.replace(/'/g, "''") + "'",
            sleep: (s) => 'Start-Sleep -Seconds ' + s,
            lines: (n) => '1..' + n + ' | ForEach-Object { "line $_" }',
        };
    }
    const sh = {
        ok: 'echo term-one',
        fail: '(exit 3)',
        failCode: 3,
        show: (v) => 'echo "' + v + '=$' + v + '"',
        cd: (d) => "cd '" + d.replace(/\\/g, '/') + "'",
        sleep: (s) => 'sleep ' + s,
        lines: (n) => 'for i in $(seq 1 ' + n + '); do echo "line $i"; done',
    };
    if (kind === 'fish') {
        sh.fail = 'bash -c "exit 3"';
        sh.show = (v) => 'echo "' + v + '=$' + v + '"';
        sh.lines = (n) => 'for i in (seq 1 ' + n + '); echo "line $i"; end';
    }
    return sh;
}

export function finished(pane) { return pane.commands().filter((c) => c.finished); }

/// Type a command line and wait until it has finished and the next prompt
/// is up. Returns the finished record.
export function run(pane, line, what) {
    const before = finished(pane).length;
    pane.el.write(line + '\r');
    waitFor(() => finished(pane).length > before && pane.shellState === 'prompt',
        (what || line) + ' to finish: ' + JSON.stringify(pane.commands().slice(-2)), 30000);
    return finished(pane).pop();
}

export function waitPrompt(pane, what) {
    waitFor(() => pane.commandLog.integrated && pane.commands().length >= 1 && pane.shellState === 'prompt',
        (what || 'the shell') + '\'s first marked prompt: ' + JSON.stringify(pane.el.screenText().slice(-400)), 40000);
}

export const norm = (p) => {
    let r = p;
    try { r = fs.realpathSync(p); } catch (e) { /* keep it */ }
    r = r.replace(/\\/g, '/').replace(/\/+$/, '');
    return WIN ? r.toLowerCase() : r;
};
