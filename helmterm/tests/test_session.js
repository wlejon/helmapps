// Session restore: tabs, split layouts, titles, profiles and working
// directories written to session.json and rebuilt from it at start.

import { app, waitFor, eq, settle, childAvailable, requireApp, reportPath, readReport,
         writeSettings, childProfile, configDir } from './lib/harness.js';

const fs = require('fs');
const path = require('path');
const win = process.platform === 'win32';
const norm = (p) => { let r = fs.realpathSync(p); if (win) r = r.toLowerCase(); return r.replace(/[\\/]+$/, ''); };

if (requireApp() && !childAvailable()) {
    skipTest('helmterm-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;
    const dirA = path.join(configDir, 'proj a');
    const dirB = path.join(configDir, 'proj-b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const r1 = reportPath('s1'), r2 = reportPath('s2');
    writeSettings({
        confirmClose: 'never',
        restoreSession: true,
        profiles: { list: [childProfile('Child S1', r1), childProfile('Child S2', r2)] },
    });

    // Build a session: a renamed tab split in two (two profiles, two
    // directories), and a second plain tab, the first one active.
    const first = ws.tabs[0];
    const t1 = ws.openTab({ profile: 'Child S1', cwd: dirA });
    readReport(r1, 'S1');
    ws.splitPane({ profile: 'Child S2', cwd: dirB, direction: 'right' });
    readReport(r2, 'S2');
    t1.resize('left', 0.1);  // a ratio other than one half
    app.commands.run('renameTab', { title: 'restored' });
    const t2 = ws.openTab({});
    ws.closeTab(first);
    ws.activate(t1);
    eq(ws.tabs.length, 2, 'two tabs');

    // It is written on change; force the pending write and read it back.
    app.session.save.flush();
    const saved = JSON.parse(fs.readFileSync(app.session.path, 'utf-8'));
    eq(saved.tabs.length, 2, 'session.json has both tabs');
    eq(saved.active, 0, 'and which is active');
    eq(saved.tabs[0].title, 'restored', 'the tab title');
    eq(saved.tabs[0].layout.split, 'row', 'the split');
    assert(Math.abs(saved.tabs[0].layout.ratio - 0.4) < 0.01, 'the ratio: ' + saved.tabs[0].layout.ratio);
    eq(saved.tabs[0].layout.a.pane.profile, 'Child S1', 'the left pane\'s profile');
    eq(norm(saved.tabs[0].layout.b.pane.cwd), norm(dirB), 'the right pane\'s directory');
    const text = fs.readFileSync(app.session.path, 'utf-8');

    // Close everything (which is what quitting is), put the saved session
    // back as the previous run left it, and start again.
    ws.closeTab(t2);
    ws.closeTab(t1);
    eq(ws.tabs.length, 0, 'all tabs closed');
    assert(app.quitRequested, 'closing the last tab asks to quit');
    fs.writeFileSync(app.session.path, text);
    fs.unlinkSync(r1);
    fs.unlinkSync(r2);
    app.start([]);

    eq(ws.tabs.length, 2, 'two tabs restored');
    const back = ws.tabs[0];
    eq(back.title, 'restored', 'the title came back');
    eq(back.shape(), 'row(P,P)', 'the split came back');
    assert(ws.active === back, 'the active tab came back');
    const [pa, pb] = back.panes();
    eq(pa.profile.name, 'Child S1', 'left profile');
    eq(pb.profile.name, 'Child S2', 'right profile');
    eq(norm(readReport(r1, 'restored S1').cwd), norm(dirA), 'the left pane started in its directory');
    eq(norm(readReport(r2, 'restored S2').cwd), norm(dirB), 'the right pane started in its directory');
    const ratio = pa.root.getBoundingClientRect().width / back.el.getBoundingClientRect().width;
    assert(Math.abs(ratio - 0.4) < 0.03, 'the ratio came back: ' + ratio.toFixed(3));
    waitFor(() => ws.tabs[1].focused.running, 'the plain tab\'s shell');

    // --no-restore (and restoreSession: false) start fresh.
    const count = ws.tabs.length;
    app.start(['--no-restore']);
    eq(ws.tabs.length, count + 1, '--no-restore opens one new tab and restores nothing');
    settle(100);
    console.log('test_session: finished');
}
