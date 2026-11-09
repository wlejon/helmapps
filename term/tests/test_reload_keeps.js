// A reload (an update to term, F5) keeps the shells: each running one is
// parked with the engine in pagehide and taken back by the reloaded page,
// the same process with its state and screen, in the same tabs and splits.

import { app, waitFor, eq, writeSettings, requireApp } from './lib/harness.js';

if (process.platform === 'win32') {
    skipTest('the shell steps are POSIX sh');
} else if (requireApp()) {
    writeSettings({ confirmClose: 'never', profiles: { list: [{ name: 'Sh', command: '/bin/sh', args: [] }] } });
    const ws = app.workspace;
    const first = ws.tabs[0];
    const t1 = ws.openTab({ profile: 'Sh' });
    const left = t1.panes()[0];
    ws.splitPane({ profile: 'Sh', direction: 'right' });
    const right = t1.panes()[1];
    ws.closeTab(first);
    eq(ws.tabs.length, 1, 'one tab, split in two');
    left.el.write('X=41; echo READY-$X\r');
    right.el.write('Y=7; echo READY-$Y\r');
    waitFor(() => left.el.screenText().includes('READY-41') && right.el.screenText().includes('READY-7'), 'both shells up');
    const pids = [left.el.pid, right.el.pid];
    assert(pids[0] > 0 && pids[1] > 0 && pids[0] !== pids[1], 'two shells: ' + pids);

    // The windowed frame loop (runFrames) is where a reload commits.
    const before = window.term;
    location.reload();
    for (let i = 0; i < 40 && window.term === before; i++) runFrames(5, { stepMs: 16 });
    const term = window.term;
    assert(term && term !== before, 'the page reloaded');

    const w2 = term.workspace;
    waitFor(() => w2.tabs.length === 1 && w2.tabs[0].panes().length === 2, 'the same tab and split back');
    const [l2, r2] = w2.tabs[0].panes();
    eq([l2.el.pid, r2.el.pid], pids, 'the same two shells');
    assert(l2.el.screenText().includes('READY-41'), 'with what they showed');
    l2.el.write('echo SUM-$((X+1))\r');
    r2.el.write('echo SUM-$((Y+1))\r');
    waitFor(() => l2.el.screenText().includes('SUM-42') && r2.el.screenText().includes('SUM-8'), 'and their state');
    runFrames(200, { stepMs: 16 });   // past the engine's grace for unadopted sessions
    for (const pid of pids) {
        let alive = true;
        try { process.kill(pid, 0); } catch (_) { alive = false; }
        assert(alive, 'shell ' + pid + ' still runs');
    }
    eq(w2.tabs.length, 1, 'no extra tab opened by the reload');
    console.log('test_reload_keeps PASSED');
}
