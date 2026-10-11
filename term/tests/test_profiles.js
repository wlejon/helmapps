// Profiles launch exactly what they say: command, arguments (spaces and all),
// starting directory and environment, through every way a tab or pane is
// opened. The detected shells are there, hidden profiles stay out of the
// menus, and the exit behaviour follows closeOnExit.

import { app, waitFor, eq, press, mod, settle, CHILD, childAvailable, requireApp, reportPath, readReport,
         writeSettings, childProfile, configDir } from './lib/harness.js';

const fs = require('fs');
const path = require('path');

const win = process.platform === 'win32';
const norm = (p) => { let r = fs.realpathSync(p); if (win) r = r.toLowerCase(); return r.replace(/[\\/]+$/, ''); };

function launchAndReport(report, open) {
    if (fs.existsSync(report)) fs.unlinkSync(report);
    const result = open();
    return { result, data: readReport(report) };
}

if (requireApp() && !childAvailable()) {
    skipTest('term-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;

    // ── what was detected ──
    const detected = app.profiles.detected;
    assert(detected.length > 0, 'at least one shell detected');
    if (win) {
        const cmd = detected.find((p) => p.id === 'cmd');
        assert(cmd && /cmd\.exe$/i.test(cmd.command), 'Command Prompt detected: ' + (cmd && cmd.command));
        const ps = detected.find((p) => p.id === 'powershell');
        assert(ps && /powershell\.exe$/i.test(ps.command), 'Windows PowerShell detected');
        for (const d of app.host.wslDistributions()) {
            if (/^docker-desktop/i.test(d.name)) continue;
            const w = detected.find((p) => p.name === d.name);
            assert(w && w.args[0] === '-d' && w.args[1] === d.name, 'WSL distribution ' + d.name + ' has a profile');
        }
    } else {
        const login = app.host.loginShell();
        if (login) {
            const p = detected.find((x) => x.loginShell);
            assert(p && p.command === login, 'the login shell from passwd is a profile: ' + login);
            eq(app.profiles.defaultProfile().command, login, 'and the default');
        }
        for (const p of detected) assert(fs.existsSync(p.command), 'detected shell exists: ' + p.command);
    }

    // ── user profiles from settings.json ──
    const work = path.join(configDir, 'work dir');
    fs.mkdirSync(work, { recursive: true });
    const repA = reportPath('a');
    const repDefault = reportPath('default');
    const repExit = reportPath('exit');
    writeSettings({
        environment: { BRO_TERM_T_GLOBAL: 'g' },
        confirmClose: 'never',
        profiles: {
            defaults: { env: { BRO_TERM_T_DEFAULT: 'yes' } },
            list: [
                childProfile('Child A', repA, { args: ['alpha', 'two words', '--flag=x', ''], cwd: work,
                    env: { BRO_TERM_T_FOO: 'bar baz' } }),
                childProfile('Child Hidden', reportPath('hidden'), { hidden: true }),
                childProfile('Child Exit0', reportPath('exit0'), { env: { TESTCHILD_EXIT: '0' } }),
                childProfile('Child Exit3', repExit, { env: { TESTCHILD_EXIT: '3' } }),
                childProfile('Child Default', repDefault),
                { name: 'Missing', command: path.join(configDir, 'no-such-program' + (win ? '.exe' : '')) },
            ],
        },
    });
    const vis = app.profiles.visible().map((p) => p.name);
    assert(vis.includes('Child A') && !vis.includes('Child Hidden'), 'hidden profiles are not listed: ' + vis.join(', '));
    assert(app.profiles.get('Child Hidden'), 'but they exist');

    const expectA = (data, what) => {
        eq(data.argv, ['alpha', 'two words', '--flag=x', ''], what + ': argv');
        eq(norm(data.cwd), norm(work), what + ': cwd');
        eq(data.env.BRO_TERM_T_FOO, 'bar baz', what + ': profile env');
        eq(data.env.BRO_TERM_T_DEFAULT, 'yes', what + ': profiles.defaults env');
        eq(data.env.BRO_TERM_T_GLOBAL, 'g', what + ': global environment');
        eq(data.env.TERM_PROGRAM, 'bro-term', what + ': TERM_PROGRAM');
        eq(data.env.COLORTERM, 'truecolor', what + ': COLORTERM');
        if (!win) eq(data.env.TERM, 'xterm-256color', what + ': TERM');
    };

    // A new tab by profile name.
    let r = launchAndReport(repA, () => app.commands.run('newTab', { profile: 'Child A' }));
    expectA(r.data, 'newTab by name');
    eq(ws.activePane().profile.name, 'Child A', 'the active pane runs Child A');
    waitFor(() => ws.activePane().el.screenText().includes('ARG1=two words'), 'the child\'s own report on screen');

    // The same through ctrl+shift+<n>, the profile's position in the menu.
    const idx = app.profiles.visible().findIndex((p) => p.name === 'Child A');
    if (idx < 9) {
        r = launchAndReport(repA, () => press(mod + '+shift+' + (idx + 1)));
        expectA(r.data, 'ctrl+shift+' + (idx + 1));
    }

    // A split with a profile.
    r = launchAndReport(repA, () => app.commands.run('splitPane', { profile: 'Child A', direction: 'down' }));
    expectA(r.data, 'splitPane with a profile');
    eq(ws.active.shape(), 'column(P,P)', 'it split the tab');

    // The palette's "New tab: <profile>" entry.
    r = launchAndReport(repA, () => {
        app.commands.run('commandPalette');
        app.palette.filter('New tab: Child A');
        app.palette.runSelected();
    });
    expectA(r.data, 'the palette');

    // A command line in place of the profile's command keeps its environment.
    r = launchAndReport(repA, () => ws.openTab({ profile: 'Child A', commandline: [CHILD, 'x y', 'z'] }));
    eq(r.data.argv, ['x y', 'z'], 'commandline override: argv');
    eq(r.data.env.BRO_TERM_T_FOO, 'bar baz', 'commandline override keeps the profile env');

    // defaultProfile decides what a plain new tab runs.
    app.settings.set('defaultProfile', 'Child Default');
    r = launchAndReport(repDefault, () => press(mod + '+shift+t'));
    eq(r.data.argv, [], 'the default profile ran with no arguments');
    eq(ws.activePane().profile.name, 'Child Default', 'ctrl+shift+t opened the default profile');

    // closeOnExit: graceful closes a clean exit, keeps a failure on screen.
    const n = ws.tabs.length;
    ws.openTab({ profile: 'Child Exit0' });
    waitFor(() => ws.tabs.length === n, 'a clean exit closes its tab');
    const t3 = ws.openTab({ profile: 'Child Exit3' });
    const p3 = t3.focused;
    waitFor(() => p3.exited, 'the failing child to exit');
    eq(p3.exitCode, 3, 'its exit code');
    assert(ws.tabs.includes(t3), 'a failure stays open');
    assert(p3.root.classList.contains('has-banner') && /code 3/.test(p3.banner.textContent), 'with a banner: ' + p3.banner.textContent);
    // Enter restarts it, as a new process.
    fs.unlinkSync(repExit);
    p3.focus();
    advanceTime(16);
    press('enter');
    readReport(repExit, 'the restarted child');
    app.settings.set('closeOnExit', 'never');
    const t0 = ws.openTab({ profile: 'Child Exit0' });
    waitFor(() => t0.focused.exited, 'a clean exit under closeOnExit never');
    settle(200);
    assert(ws.tabs.includes(t0), 'closeOnExit never keeps it');

    // A command that does not exist: the pane says so instead of vanishing.
    const tm = ws.openTab({ profile: 'Missing' });
    waitFor(() => tm.focused.startError || tm.focused.exited, 'the missing program to fail');
    assert(tm.focused.root.classList.contains('has-banner'), 'a missing program leaves a banner');
    console.log('test_profiles: finished');
}
