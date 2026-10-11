// Persistent sessions, where bro has them (bromux): with persistentSessions
// a pane's program runs in a session that outlives term. Quitting
// releases it and the restored session attaches to the same program, with
// its screen; closing a tab ends it; a program that exits takes its finished
// session off the server. Without the setting, panes run local processes.

import { app, waitFor, eq, childAvailable, requireApp, writeSettings, reportPath, childProfile } from './lib/harness.js';
import * as term from '../js/term/adapter.js';

const SERVER = 'term-test-' + process.pid;

if (requireApp() && !childAvailable()) {
    skipTest('term-testchild is not built beside the headless binary');
} else if (app && !term.caps.persistent) {
    skipTest('this build has no persistent terminal sessions');
} else if (app) {
    const ws = app.workspace;
    writeSettings({
        confirmClose: 'never',
        persistentSessions: true,
        // A server of the test's own, never the user's default one.
        persistentServer: SERVER,
        profiles: { list: [childProfile('Kept Child', reportPath('k'))] },
    });
    const list = () => term.sessions(SERVER);
    const running = (id) => list().some((s) => s.id === id && s.running);

    const tab = ws.openTab({ profile: 'Kept Child' });
    const pane = tab.focused;
    waitFor(() => pane.el.screenText().includes('TESTCHILD READY'), 'the child in a session', 20000);
    const id = pane.sessionId;
    assert(typeof id === 'number' && id > 0, 'the pane runs in a session: ' + id);
    const listed = list().find((s) => s.id === id);
    eq(pane.server, SERVER, 'on the configured server');
    assert(listed && listed.running, 'the server lists it running');
    eq(listed.name, 'term: Kept Child', 'named after the profile');
    pane.el.write('before-quit\r');
    waitFor(() => pane.el.screenText().includes('TESTCHILD GOT before-quit'), 'it answers input');

    // Quitting: the session is saved and released, the program runs on.
    const saved = app.workspace.snapshot();
    eq(saved.tabs[saved.tabs.length - 1].layout.pane.session, id, 'the saved session names it');
    assert(pane.release(), 'release detaches');
    eq(pane.exited, false, 'a release is not an exit');
    assert(running(id), 'the program still runs');
    ws.closeTab(tab);   // the element is gone; its session was already let go
    // closeTab disposes, which closes a session the pane still shows: a
    // released pane shows none.
    waitFor(() => running(id), 'still running after the tab went');

    // The next start restores the tab and attaches to the same program.
    const n = app.session.restoreTab(saved.tabs[saved.tabs.length - 1]);
    assert(n, 'the tab was restored');
    const back = ws.tabs[ws.tabs.length - 1].focused;
    waitFor(() => back.sessionId === id, 'attached to the same session: ' + back.sessionId);
    assert(back.attached, 'by attaching, not spawning');
    waitFor(() => back.el.screenText().includes('TESTCHILD GOT before-quit'), 'with the screen it had: ' + back.el.screenText());
    back.el.write('after-restore\r');
    waitFor(() => back.el.screenText().includes('TESTCHILD GOT after-restore'), 'and the same program answering');

    // A saved session that no longer runs starts a fresh process instead.
    const stale = JSON.parse(JSON.stringify(saved.tabs[saved.tabs.length - 1]));
    stale.layout.pane.session = 999999;
    app.session.restoreTab(stale);
    const fresh = ws.tabs[ws.tabs.length - 1].focused;
    waitFor(() => fresh.el.screenText().includes('TESTCHILD READY'), 'a session that is gone: a new one');
    assert(!fresh.attached && fresh.sessionId && fresh.sessionId !== id, 'spawned anew');

    // Closing a tab ends its session.
    const fid = fresh.sessionId;
    ws.closeTab(ws.tabs[ws.tabs.length - 1]);
    waitFor(() => !list().some((s) => s.id === fid), 'closing the tab closed its session');

    // A program that exits leaves no finished session behind.
    back.el.write('q\r');
    waitFor(() => back.exited, 'the child exits');
    waitFor(() => !list().some((s) => s.id === id), 'its finished session was closed');

    // Without the setting, a local process.
    app.settings.set('persistentSessions', false);
    const local = ws.openTab({ profile: 'Kept Child' }).focused;
    waitFor(() => local.el.screenText().includes('TESTCHILD READY'), 'a local child');
    eq(local.sessionId, null, 'no session');
    bro.terminal.killServer(SERVER);
    console.log('test_persistent: finished');
}
