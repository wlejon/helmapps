// The single-instance hand-off: bro.json declares singleInstance, so a second
// `bro term ...` hands its command line and working directory to the
// running process (bro.app's 'instance' event) instead of opening a window.
// Here the event is simulated in-process; bro's own tests/app cover the
// real two-process hand-off.

import { app, waitFor, eq, childAvailable, requireApp, reportPath, readReport,
         writeSettings, childProfile, configDir, CHILD } from './lib/harness.js';

const fs = require('fs');
const path = require('path');
const win = process.platform === 'win32';
const norm = (p) => { let r = fs.realpathSync(p); if (win) r = r.toLowerCase(); return r.replace(/[\\/]+$/, ''); };

// The manifest is what bro read.
eq(bro.app.id, 'helm.term', 'the app id from bro.json');
eq(bro.app.manifest.singleInstance, true, 'singleInstance from bro.json');
eq(norm(app.settings.dir), norm(bro.app.configDir), 'settings live in bro.app.configDir');

if (requireApp() && !childAvailable()) {
    skipTest('term-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;
    const from = path.join(configDir, 'launched from');
    const sub = path.join(from, 'sub dir');
    fs.mkdirSync(sub, { recursive: true });
    const rep = reportPath('instance');
    writeSettings({ confirmClose: 'never', profiles: { list: [childProfile('Child I', rep)] } });

    // A second launch from `from`: -d relative to where it ran, a profile,
    // a title and a command whose arguments survive as given.
    const n = ws.tabs.length;
    bro.app._simulateInstance(['-p', 'Child I', '-d', 'sub dir', '-t', 'handed over', '--', CHILD, 'a b', ''], from);
    flush();
    waitFor(() => ws.tabs.length === n + 1, 'the hand-off to open a tab');
    const data = readReport(rep, 'the handed-over child');
    eq(data.argv, ['a b', ''], 'the arguments, spaces and empty ones included');
    eq(norm(data.cwd), norm(sub), '-d resolved against the launch\'s directory');
    eq(ws.active.title, 'handed over', 'the -t title');

    // A bare second launch: a plain new tab.
    bro.app._simulateInstance([], from);
    flush();
    waitFor(() => ws.tabs.length === n + 2, 'a bare launch to open a tab');
}
