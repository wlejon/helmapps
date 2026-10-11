// Shell integration, per shell found on this machine (PowerShell 7, Windows
// PowerShell and Git Bash on Windows; bash, zsh and fish elsewhere): the
// shell starts with term's script loaded and the user's own startup files
// still run; prompts are marked; each command's line, exit code and
// duration are known; the directory is reported; marks show beside prompts.
// A profile with shellIntegration: false gets none of it.

import { app, waitFor, eq, requireApp, writeSettings } from './lib/harness.js';
import { shellProfiles, makeHome, homeEnv, script, run, waitPrompt, norm, WIN } from './lib/shells.js';

const fs = require('fs');
const path = require('path');

function check(profile, kind, tag) {
    const ws = app.workspace;
    const home = makeHome(tag);
    const start = path.join(home, 'start dir');
    const sub = path.join(home, 'sub dir');
    fs.mkdirSync(start, { recursive: true });
    fs.mkdirSync(sub, { recursive: true });
    const s = script(kind);
    const tab = ws.openTab({ profile: profile.name, cwd: start, env: kind === 'powershell' ? {} : homeEnv(home) });
    const pane = tab.focused;
    const what = profile.name + ' (' + kind + ')';
    eq(pane.launch.integration, kind, what + ': the integration was loaded');
    waitPrompt(pane, what);

    // The user's own startup files still ran.
    if (kind !== 'powershell') {
        const login = pane.launch.spawn.env.BRO_TERM_BASH_LOGIN === '1';
        run(pane, s.show('BRO_TERM_T_RC'), what + ' rc check');
        waitFor(() => pane.el.screenText().includes('BRO_TERM_T_RC=' + kind + 'rc'),
            what + ': the user\'s rc file ran: ' + pane.el.screenText().slice(-300));
        if (login) {
            run(pane, s.show('BRO_TERM_T_LOGIN'));
            waitFor(() => pane.el.screenText().includes('BRO_TERM_T_LOGIN=bash_profile'), what + ': a login shell ran ~/.bash_profile');
        }
        // Nothing of term's leaks into what the shell's programs inherit.
        run(pane, s.show('BRO_TERM_SHELL_INTEGRATION'));
        waitFor(() => pane.el.screenText().includes('BRO_TERM_SHELL_INTEGRATION=\n') ||
            /BRO_TERM_SHELL_INTEGRATION=\s*$/m.test(pane.el.screenText()), what + ': the marker variable is unset');
        if (kind === 'zsh') {
            run(pane, 'echo "Z=${ZDOTDIR-unset}"');
            waitFor(() => pane.el.screenText().includes('Z=unset'), what + ': ZDOTDIR handed back');
        }
        if (kind === 'fish') {
            run(pane, 'echo "X=$XDG_DATA_DIRS"');
            waitFor(() => /X=/.test(pane.el.screenText()) && !pane.el.screenText().includes('shell-integration'),
                what + ': XDG_DATA_DIRS without term\'s directory');
        }
    }

    // A command that succeeds and one that fails.
    const ok = run(pane, s.ok, what + ' ok');
    eq(ok.exitCode, 0, what + ': exit code 0');
    assert(ok.commandLine.includes('echo term-one'), what + ': the command line: ' + JSON.stringify(ok.commandLine));
    assert(typeof pane.commandLog.duration(ok) === 'number', what + ': a duration was measured');
    const bad = run(pane, s.fail, what + ' failing');
    eq(bad.exitCode, s.failCode, what + ': the failing command\'s exit code');

    // The directory, from OSC 7.
    waitFor(() => pane.reportedCwd && norm(pane.reportedCwd) === norm(start), what + ': the starting directory reported: ' + pane.reportedCwd);
    run(pane, s.cd(sub), what + ' cd');
    waitFor(() => pane.reportedCwd && norm(pane.reportedCwd) === norm(sub), what + ': the new directory reported: ' + pane.reportedCwd);

    // Marks beside the prompts: a failure in red.
    waitFor(() => pane.root.querySelector('.cmd-mark.failed') && pane.root.querySelector('.cmd-mark.ok'),
        what + ': command marks for a success and a failure');
    app.workspace.closeTab(tab);
}

if (requireApp()) {
    writeSettings({ confirmClose: 'never', closeOnExit: 'never' });
    const found = shellProfiles();
    const ran = [];
    let n = 0;
    for (const kind of ['powershell', 'bash', 'zsh', 'fish']) {
        for (const p of found[kind]) {
            check(p, kind, 'i' + (++n));
            ran.push(p.name);
        }
    }
    console.log('test_integration: checked ' + (ran.join(', ') || 'no shells'));

    // Turned off per profile: the shell runs as configured, unmarked.
    const any = found.bash[0] || found.powershell[0] || found.zsh[0] || found.fish[0];
    if (any) {
        app.setProfileSetting(any.name, 'shellIntegration', false);
        waitFor(() => app.profiles.get(any.name).shellIntegration === false, 'the override to load');
        const t = app.workspace.openTab({ profile: any.name });
        eq(t.focused.launch.integration, null, 'shellIntegration: false loads nothing');
        eq(t.focused.launch.spawn.args, app.profiles.get(any.name).args, 'and the arguments are the profile\'s own');
    }
    if (!ran.length) skipTest('no shell that term integrates is installed');
    else if (!WIN && !found.zsh.length) console.log('test_integration: zsh is not installed here');
}
