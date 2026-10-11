// Events from the program, as the element raises them: titles (with the
// executable-path rule, tabTitle and suppressApplicationTitle), the theme
// surviving a program's palette reset (OSC 104 / 111), the bell, desktop
// notifications (OSC 9 / 777) and progress (OSC 9;4) on the tab.

import { app, waitFor, settle, eq, CHILD, childAvailable, requireApp, reportPath, writeSettings,
         childProfile } from './lib/harness.js';
import * as term from '../js/term/adapter.js';

const tabEl = (t) => document.querySelector('#tabs .tab[data-tab-id="' + t.id + '"]');
const lower = (c) => String(c || '').toLowerCase();

if (requireApp() && !childAvailable()) {
    skipTest('helmterm-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;
    writeSettings({
        confirmClose: 'never',
        closeOnExit: 'never',
        profiles: { list: [
            childProfile('Child T', reportPath('t'), { env: { TESTCHILD_TITLE: 'set by the child' } }),
            childProfile('Child Plain', reportPath('p')),
            childProfile('Child Fixed', reportPath('f'), { tabTitle: 'Fixed title', suppressApplicationTitle: true }),
            childProfile('Child Named', reportPath('n'), { tabTitle: 'Starts named' }),
        ] },
    });

    // ── titles ──
    const t1 = ws.openTab({ profile: 'Child T' });
    const p1 = t1.focused;
    waitFor(() => t1.title === 'set by the child', 'the child\'s own OSC 2 title: ' + t1.title);
    waitFor(() => tabEl(t1).querySelector('.tab-title').textContent === 'set by the child', 'the strip shows it');

    // An executable's path (what ConPTY titles a console with) is not a title.
    p1.el.feed('\x1b]2;C:\\Program Files\\PowerShell\\7\\pwsh.exe\x07');
    waitFor(() => t1.title === 'Child T', 'an .exe path becomes the profile name: ' + t1.title);
    p1.el.feed('\x1b]0;' + CHILD + '\x07');
    settle(100);
    eq(t1.title, 'Child T', 'the path of the program itself is not a title either');
    p1.el.feed('\x1b]2;C:\\WINDOWS\\system32\\cmd.exe - ping example.com\x07');
    waitFor(() => t1.title === 'Child T - ping example.com', 'cmd.exe\'s "exe - command" keeps the command: ' + t1.title);
    p1.el.feed('\x1b]2;vim notes.txt\x07');
    waitFor(() => t1.title === 'vim notes.txt', 'an ordinary title is used as it is: ' + t1.title);
    eq(document.title, 'vim notes.txt', 'and the window\'s title follows');

    // tabTitle: what the tab says until the program names itself.
    const t2 = ws.openTab({ profile: 'Child Named' });
    eq(t2.title, 'Starts named', 'tabTitle before the program sets one');
    t2.focused.el.feed('\x1b]2;renamed by the program\x07');
    waitFor(() => t2.title === 'renamed by the program', 'the program\'s title replaces tabTitle');

    // suppressApplicationTitle keeps the profile's.
    const t3 = ws.openTab({ profile: 'Child Fixed' });
    t3.focused.el.feed('\x1b]2;ignored\x07');
    settle(150);
    eq(t3.title, 'Fixed title', 'suppressApplicationTitle ignores the program\'s title');

    // A user's rename beats everything.
    ws.renameTab(t2, 'mine');
    t2.focused.el.feed('\x1b]2;another\x07');
    settle(100);
    eq(t2.title, 'mine', 'a rename sticks');

    // ── the theme survives the program resetting its palette ──
    // The colour in effect is the colour of a cell painted with palette
    // entry 1 (SGR 41). (An OSC 4 query cannot be used: ConPTY drops the
    // terminal's OSC replies before they reach a Windows program.)
    const scheme = app.schemeFor(app.settings.values.colorScheme);
    const el = p1.el;
    eq(lower(el.theme.ansi[1]), lower(scheme.red), 'the scheme is the theme (red)');
    eq(lower(el.theme.background), lower(scheme.background), 'the scheme is the theme (background)');
    eq(lower(p1.palette.ansi[1]), lower(scheme.red), 'p1.palette has theme red');
    eq(lower(term.palette(el).background), lower(scheme.background), 'term.palette has theme background');
    ws.activate(t1);
    el.feed('\x1b[H\x1b[2J\x1b[41m      \x1b[0m');
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const cell = () => {
        const r = el.getBoundingClientRect();
        const m = el.metrics;
        const pad = parseFloat(el.style.padding) || 0;
        return hex(getPixel(r.left + pad + 2.5 * m.cellWidth, r.top + pad + 0.5 * m.cellHeight));
    };
    const shows = (want, what) => {
        const end = Date.now() + 8000;
        let got = '';
        while (Date.now() < end && (got = cell()) !== lower(want)) { advanceTime(16); wallSleep(10); }
        eq(got, lower(want), what);
    };
    shows(scheme.red, 'colour 1 in effect is the scheme\'s');
    el.feed('\x1b]4;1;#123456\x1b\\');
    shows('#123456', 'the program\'s OSC 4 takes effect');
    waitFor(() => lower(p1.palette.ansi[1]) === '#123456', 'p1.palette reflects OSC 4 override');
    eq(lower(term.palette(el).ansi[1]), '#123456', 'term.palette reflects OSC 4 override');

    // OSC 10 (foreground) and OSC 11 (background) overrides
    el.feed('\x1b]10;#112233\x1b\\\x1b]11;#445566\x1b\\');
    waitFor(() => lower(p1.palette.foreground) === '#112233', 'p1.palette reflects OSC 10 foreground override');
    eq(lower(p1.palette.background), '#445566', 'p1.palette reflects OSC 11 background override');
    el.feed('\x1b]110\x1b\\\x1b]111\x1b\\');
    waitFor(() => lower(p1.palette.foreground) === lower(scheme.foreground), 'OSC 110 resets foreground');
    eq(lower(p1.palette.background), lower(scheme.background), 'OSC 111 resets background');

    el.feed('\x1b]104\x1b\\');
    shows(scheme.red, 'OSC 104 returns to the scheme, not to bropty\'s own palette');
    eq(lower(p1.palette.ansi[1]), lower(scheme.red), 'palette resets to scheme red');
    // A scheme change in settings reaches running terminals, and a reset keeps it.
    app.settings.set('colorScheme', 'Dracula');
    const dracula = app.schemeFor('Dracula');
    waitFor(() => lower(el.theme.ansi[1]) === lower(dracula.red), 'a new scheme reaches the terminal');
    shows(dracula.red, 'the cell takes the new scheme');
    eq(lower(p1.palette.ansi[1]), lower(dracula.red), 'p1.palette updates with new scheme');
    el.feed('\x1b]4;1;#654321\x1b\\\x1b]104\x1b\\');
    shows(dracula.red, 'and a reset after it keeps the new scheme');
    eq(lower(p1.palette.ansi[1]), lower(dracula.red), 'p1.palette resets to Dracula red');

    // ── the bell ──
    ws.activate(t1);
    el.feed('\x07');
    waitFor(() => app.attention.log.some((e) => e.kind === 'bell' && e.pane === p1.id), 'the bell event');
    const bg = t2.focused;
    app.commands.run('switchToTab', { index: ws.tabs.indexOf(t1) });
    bg.el.feed('\x07');
    waitFor(() => t2.bell && tabEl(t2).classList.contains('bell'), 'a bell in a background tab marks it');
    app.settings.set('bell', 'audible');
    const beeps = () => app.host.desktopLog.filter((e) => e.kind === 'beep').length;
    const before = beeps();
    el.feed('\x07');
    waitFor(() => beeps() > before, 'an audible bell asks the desktop for its sound');
    app.settings.set('bell', 'none');
    const n = app.attention.log.length;
    el.feed('\x07');
    settle(150);
    eq(app.attention.log.length, n, 'bell: none ignores it');

    // ── notifications ──
    bg.el.feed('\x1b]777;notify;Build;all 12 targets done\x07');
    waitFor(() => app.attention.log.some((e) => e.kind === 'notification' && e.title === 'Build'), 'OSC 777 notification');
    const note = app.attention.log.filter((e) => e.kind === 'notification').pop();
    eq(note.body, 'all 12 targets done', 'its body');
    assert(note.desktop, 'an unseen tab\'s notification goes to the desktop');
    assert(app.host.desktopLog.some((e) => e.kind === 'notify' && e.args[0] === 'Build'), 'the desktop was asked');
    assert(tabEl(t2).classList.contains('notified'), 'the tab is marked');
    assert([...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('all 12 targets done')), 'and a toast shows it');
    el.feed('\x1b]9;plain osc 9\x07');
    waitFor(() => app.attention.log.some((e) => e.kind === 'notification' && e.body === 'plain osc 9'), 'OSC 9 notification');
    assert(!app.attention.log.filter((e) => e.kind === 'notification').pop().desktop,
        'the active tab\'s notification stays in the app (desktopNotifications: unfocused)');

    // ── progress ──
    bg.el.feed('\x1b]9;4;1;40\x07');
    waitFor(() => tabEl(t2).dataset.progress === 'normal', 'OSC 9;4 progress on the tab');
    eq(tabEl(t2).querySelector('.tab-progress-bar').style.width, '40%', 'at 40%');
    bg.el.feed('\x1b]9;4;2;70\x07');
    waitFor(() => tabEl(t2).dataset.progress === 'error', 'the error state');
    eq(tabEl(t2).querySelector('.tab-progress-bar').style.width, '70%', 'at 70%');
    assert(app.host.desktopLog.some((e) => e.kind === 'progress' && e.args[0] === 2 && e.args[1] === 70),
        'the taskbar shows it too: ' + JSON.stringify(app.host.desktopLog.filter((e) => e.kind === 'progress')));
    bg.el.feed('\x1b]9;4;0;0\x07');
    waitFor(() => !tabEl(t2).classList.contains('has-progress'), 'progress cleared');

    // ── cwd reporting as clean filesystem path ──
    const targetUri = process.platform === 'win32' ? 'file:///C:/temp/helmterm%20cwd%20test' : 'file://localhost/tmp/helmterm%20cwd%20test';
    bg.el.feed('\x1b]7;' + targetUri + '\x07');
    waitFor(() => t2.focused.cwd && t2.focused.cwd.includes('helmterm cwd test'), 'cwd updated via OSC 7');
    const cwdVal = t2.focused.cwd;
    assert(!cwdVal.startsWith('file://'), 'cwd is not a URI: ' + cwdVal);
    assert(!cwdVal.includes('%20'), 'cwd is percent-decoded: ' + cwdVal);
    eq(term.cwd(bg.el), cwdVal, 'term.cwd(el) matches pane.cwd');
    eq(bg.el.cwdUri, targetUri, 'cwdUri holds raw URI');

    // Fallback when el.cwd is empty
    const mockEl = { cwd: '', cwdUri: 'file:///usr/share/doc' };
    eq(term.cwd(mockEl), '/usr/share/doc', 'term.cwd falls back to cwdUri when cwd is empty');

    console.log('test_events: finished');
}
