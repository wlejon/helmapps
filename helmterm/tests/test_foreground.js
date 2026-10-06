// Titles from the foreground process, where the element reports it: a
// program started from the shell names the tab while it runs, and the
// shell's own title comes back when it exits.

import { app, waitFor, eq, CHILD, childAvailable, requireApp, writeSettings } from './lib/harness.js';
import { shellProfiles, makeHome, homeEnv, waitPrompt } from './lib/shells.js';
import * as term from '../ui/js/term/adapter.js';

if (requireApp() && !childAvailable()) {
    skipTest('broterm-testchild is not built beside the headless binary');
} else if (app && !term.caps.foreground) {
    skipTest('this build\'s <terminal> does not report the foreground process');
} else if (app) {
    const found = shellProfiles();
    const kind = ['bash', 'powershell', 'zsh', 'fish'].find((k) => found[k].length);
    if (!kind) {
        skipTest('no shell that broterm integrates is installed');
    } else {
        writeSettings({ confirmClose: 'never' });
        const profile = found[kind][0];
        const home = makeHome('fg');
        const tab = app.workspace.openTab({ profile: profile.name, cwd: home, env: kind === 'powershell' ? {} : homeEnv(home) });
        const pane = tab.focused;
        waitPrompt(pane, profile.name);
        waitFor(() => { const f = pane.el.foregroundProcess; return f && term.foreground(pane.el); }, 'the shell is in front', 10000);
        const shellTitle = tab.title;
        assert(!/testchild/.test(shellTitle), 'the shell\'s title first: ' + shellTitle);

        const child = CHILD.replace(/\\/g, '/');
        pane.el.write((kind === 'powershell' ? "& '" + child + "'" : "'" + child + "'") + '\r');
        waitFor(() => pane.el.screenText().includes('TESTCHILD READY'), 'the child runs from the shell');
        waitFor(() => /broterm-testchild/.test((pane.el.foregroundProcess || {}).name || ''),
            'the element reports it in front: ' + JSON.stringify(pane.el.foregroundProcess), 10000);
        waitFor(() => tab.title === 'broterm-testchild', 'the tab is named after it: ' + tab.title, 10000);
        const fg = term.foreground(pane.el);
        eq(fg.name, 'broterm-testchild', 'the adapter\'s name, without .exe');
        assert(fg.pid > 0 && /broterm-testchild/.test(fg.path), 'with its pid and path: ' + JSON.stringify(fg));

        pane.el.write('q\r');
        waitFor(() => !/testchild/.test(tab.title), 'when it exits the shell\'s title is back: ' + tab.title, 10000);
        console.log('test_foreground: finished (' + profile.name + ')');
    }
}
