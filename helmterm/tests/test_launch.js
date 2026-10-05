// The command line (broterm [-p profile] [-d dir] [-t title] [-- command
// args...]) and closing with something still running (the in-app
// confirmation, never a native dialog).

import { app, waitFor, eq, press, settle, clickEl, CHILD, childAvailable, requireApp, reportPath,
         readReport, writeSettings, childProfile, configDir } from './lib/harness.js';
import { parseArgs } from '../ui/js/core/cli.js';

const fs = require('fs');
const path = require('path');
const win = process.platform === 'win32';
const norm = (p) => { let r = fs.realpathSync(p); if (win) r = r.toLowerCase(); return r.replace(/[\\/]+$/, ''); };

// ── parsing (pure) ──
const a = parseArgs(['-p', 'Ubuntu', '--directory=/tmp', '-t', 'logs', '--', 'tail', '-f', 'x.log']);
eq([a.profile, a.cwd, a.title, a.commandline], ['Ubuntu', '/tmp', 'logs', ['tail', '-f', 'x.log']], 'all the options');
eq(parseArgs(['vim', '-p', 'file']).commandline, ['vim', '-p', 'file'], 'the first non-option starts the command');
eq(parseArgs(['--profile']).errors, ['--profile needs a value'], 'a missing value is an error');
eq(parseArgs(['--bogus']).errors, ['unknown option --bogus'], 'an unknown option is an error');
eq(parseArgs(['--no-restore']).noRestore, true, '--no-restore');
eq(parseArgs([]).commandline, null, 'nothing asked');

if (requireApp() && !childAvailable()) {
    skipTest('broterm-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;
    if (app.host.native) eq(app.host.argv, bro.broterm.argv, 'the UI sees the native command line');

    // A start with a profile, a directory, a title and a command.
    const dir = path.join(configDir, 'cli dir');
    fs.mkdirSync(dir, { recursive: true });
    const rep = reportPath('cli');
    writeSettings({ confirmClose: 'running', profiles: { list: [childProfile('Child CLI', rep)] } });
    const n = ws.tabs.length;
    app.start(['-p', 'Child CLI', '-d', dir, '-t', 'from the command line', '--', CHILD, 'one', 'two three']);
    eq(ws.tabs.length, n + 1, 'start() opened the asked-for tab');
    const data = readReport(rep, 'the child started from the command line');
    eq(data.argv, ['one', 'two three'], 'the command\'s arguments');
    eq(norm(data.cwd), norm(dir), 'the -d directory');
    eq(ws.active.title, 'from the command line', 'the -t title');
    eq(ws.activePane().profile.name, 'Child CLI', 'the -p profile (its environment came along)');

    // An unknown profile falls back to the default and says so.
    app.start(['-p', 'No Such Profile']);
    eq(ws.activePane().profile.name, app.profiles.defaultProfile().name, 'an unknown -p uses the default');
    assert([...document.querySelectorAll('.toast')].some((t) => /No Such Profile/.test(t.textContent)), 'and says so');

    // ── closing with something running ──
    const childTab = ws.tabs.find((t) => t.focused.profile.name === 'Child CLI');
    ws.activate(childTab);
    press('ctrl+shift+w');
    assert(app.overlays.isOpen('dialog'), 'closing a running program asks first');
    assert(document.querySelector('.dialog').textContent.includes('still running'), 'and says why');
    clickEl(document.getElementById('dialog-cancel'));
    assert(!app.overlays.isOpen(), 'Cancel closes the question');
    assert(ws.tabs.includes(childTab) && childTab.focused.running, '... and keeps the pane');
    press('ctrl+shift+w');
    clickEl(document.getElementById('dialog-confirm'));
    waitFor(() => !ws.tabs.includes(childTab), 'Close to close it');

    // A shell at its prompt is not "running" anything.
    const shellTab = ws.openTab({});
    waitFor(() => shellTab.focused.running, 'a shell');
    settle(300);
    app.commands.run('closeTab');
    waitFor(() => !ws.tabs.includes(shellTab), 'an idle shell closes without asking');
    assert(!app.overlays.isOpen('dialog'), 'no question was asked');

    // confirmClose: always asks for any live process; Enter confirms.
    app.settings.set('confirmClose', 'always');
    const t = ws.openTab({});
    waitFor(() => t.focused.running, 'another shell');
    app.commands.run('closeTab');
    assert(app.overlays.isOpen('dialog'), 'confirmClose always asks for a shell too');
    press('enter');
    waitFor(() => !ws.tabs.includes(t), 'Enter confirms');
    settle(100);
    console.log('test_launch: finished');
}
