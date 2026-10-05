// Tabs: open, switch, close, reorder (by command and by dragging), rename
// (by command and by double-click), per-tab titles from the terminal, and the
// activity and bell marks on tabs in the background.

import { app, waitFor, settle, eq, press, clickEl, CHILD, childAvailable, requireApp } from './lib/harness.js';

if (requireApp()) {
    const ws = app.workspace;
    waitFor(() => ws.tabs.length === 1 && ws.activePane().running, 'the first tab\'s shell');
    eq(document.querySelectorAll('#tabs .tab').length, 1, 'one tab in the strip');

    // New tabs by command and by key.
    app.commands.run('newTab');
    press('ctrl+shift+t');
    eq(ws.tabs.length, 3, 'three tabs');
    eq(ws.tabs.indexOf(ws.active), 2, 'the newest tab is active');
    eq(document.querySelectorAll('#tabs .tab').length, 3, 'three tabs in the strip');
    assert(document.querySelector('.tab-content.active') === ws.active.el, 'the active tab\'s content is shown');

    // Switch.
    press('ctrl+alt+1');
    eq(ws.tabs.indexOf(ws.active), 0, 'ctrl+alt+1 selects the first tab');
    press('ctrl+tab');
    eq(ws.tabs.indexOf(ws.active), 1, 'ctrl+tab goes to the next');
    press('ctrl+shift+tab');
    press('ctrl+shift+tab');
    eq(ws.tabs.indexOf(ws.active), 2, 'ctrl+shift+tab wraps backwards');
    clickEl(document.querySelectorAll('#tabs .tab')[1]);
    eq(ws.tabs.indexOf(ws.active), 1, 'clicking a tab selects it');
    waitFor(() => document.activeElement === ws.activePane().el, 'the selected tab\'s pane to take focus');

    // Reorder by command.
    const second = ws.active;
    app.commands.run('moveTab', { direction: 'right' });
    eq(ws.tabs.indexOf(second), 2, 'moveTab right');
    eq(document.querySelectorAll('#tabs .tab')[2].dataset.tabId, String(second.id), 'the strip follows the order');

    // Reorder by dragging the last tab to the front.
    const strip = document.querySelectorAll('#tabs .tab');
    const from = strip[2].getBoundingClientRect();
    const to = strip[0].getBoundingClientRect();
    mouseDown(from.left + 30, from.top + 10);
    mouseMove(from.left + 10, from.top + 10);
    mouseMove(to.left + 40, to.top + 10);
    mouseMove(to.left + 5, to.top + 10);
    mouseUp(to.left + 5, to.top + 10);
    advanceTime(16);
    eq(ws.tabs.indexOf(second), 0, 'dragging a tab to the front moves it there');

    // Rename by command, then by double-click on the strip.
    app.commands.run('renameTab', { title: 'build' });
    eq(ws.tabs[0].title, 'build', 'renameTab sets the title');
    eq(document.querySelectorAll('#tabs .tab-title')[0].textContent, 'build', 'the strip shows it');
    const titleEl = document.querySelectorAll('#tabs .tab')[0];
    const r = titleEl.getBoundingClientRect();
    click(r.left + 40, r.top + 12);
    click(r.left + 40, r.top + 12);
    advanceTime(16);
    const input = document.querySelector('.tab-rename');
    assert(input, 'double-clicking a tab opens the rename field');
    if (input) {
        input.value = 'logs';
        press('enter');
        eq(ws.tabs[0].title, 'logs', 'Enter commits the new title');
        assert(!document.querySelector('.tab-rename'), 'the rename field is gone');
    }
    app.commands.run('resetTabTitle');

    // The program's title becomes the tab's title.
    if (childAvailable()) {
        const t = ws.openTab({ commandline: [CHILD], title: null });
        const p = t.focused;
        waitFor(() => p.el.screenText().includes('TESTCHILD READY'), 'the child');
        p.el.feed('\x1b]2;compiling broterm\x07');
        waitFor(() => t.title === 'compiling broterm', 'the tab to take the program\'s title');
        waitFor(() => document.querySelector('#tabs .tab.active .tab-title').textContent === 'compiling broterm', 'the strip to show it');
        eq(document.title, 'compiling broterm', 'the window title follows the active tab');

        // Activity and bell on a background tab.
        app.commands.run('switchToTab', { index: 0 });
        settle(400);
        p.el.feed('more output\r\n');
        waitFor(() => t.activity, 'activity on the background tab');
        const mark = () => document.querySelector('#tabs .tab[data-tab-id="' + t.id + '"]');
        assert(mark().classList.contains('activity'), 'the strip marks it');
        p.ring();
        assert(t.bell && mark().classList.contains('bell'), 'a bell marks the background tab');
        ws.activate(t);
        assert(!t.activity && !t.bell, 'selecting the tab clears its marks');
        assert(!mark().classList.contains('activity') && !mark().classList.contains('bell'), 'and the strip\'s');
    }

    // Close by command and by the close button.
    let n = ws.tabs.length;
    app.settings.set('confirmClose', 'never');
    app.commands.run('closeTab');
    waitFor(() => ws.tabs.length === n - 1, 'closeTab');
    n = ws.tabs.length;
    const closeBtn = document.querySelector('#tabs .tab.active .tab-close');
    clickEl(closeBtn);
    waitFor(() => ws.tabs.length === n - 1, 'the close button');
    eq(document.querySelectorAll('#tabs .tab').length, ws.tabs.length, 'the strip matches');
    assert(ws.active && ws.tabs.includes(ws.active), 'a remaining tab is active');
    eq(document.querySelectorAll('terminal').length, ws.allPanes().length, 'closed panes left the document');
    console.log('test_tabs: finished with ' + ws.tabs.length + ' tabs');
}
