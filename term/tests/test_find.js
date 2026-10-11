// The find bar drives the element's search: typing searches, the count and
// the current match come back from the element, Enter / Shift+Enter / F3
// move through the matches, the toggles set case, whole-word and regex
// matching, a bad regex says so, and Escape closes the bar and clears the
// highlights.

import { app, waitFor, eq, press, mod, type, clickEl, CHILD, childAvailable, requireApp, writeSettings } from './lib/harness.js';

if (requireApp() && !childAvailable()) {
    skipTest('helmterm-testchild is not built beside the headless binary');
} else if (app) {
    writeSettings({ confirmClose: 'never' });
    const ws = app.workspace;
    const tab = ws.openTab({ commandline: [CHILD] });
    const pane = tab.focused;
    const el = pane.el;
    waitFor(() => el.screenText().includes('TESTCHILD READY'), 'the child');
    el.feed('alpha beta\r\nAlpha\r\nalphabet soup\r\nerror 42\r\nerror 7\r\n');
    waitFor(() => el.screenText().includes('error 7'), 'the text to search');
    pane.focus();

    press(mod + '+shift+f');
    const bar = () => document.querySelector('.findbar');
    assert(bar() && app.findbar.open, 'Ctrl+Shift+F opens the find bar');
    const input = bar().querySelector('.find-input');
    assert(document.activeElement === input, 'its query box has the focus');
    const status = () => bar().querySelector('.find-status').textContent;
    const st = () => el.searchStatus;

    type('alpha');
    waitFor(() => st().active && st().complete && st().count === 3, 'smart case finds alpha, Alpha and alphabet: ' + JSON.stringify(st()));
    eq(st().pattern, 'alpha', 'the element searches what was typed');
    waitFor(() => status() === '3 matches', 'the bar shows the count: ' + status());

    press('enter');
    waitFor(() => st().current === 0, 'Enter goes to the first match');
    eq(status(), '1 / 3', 'and the bar says which');
    press('enter');
    eq(st().current, 1, 'Enter again: the next');
    press('shift+enter');
    press('shift+enter');
    eq(st().current, 2, 'Shift+Enter goes back, wrapping');
    eq(status(), '3 / 3', 'the bar follows');
    press('f3');
    eq(st().current, 0, 'F3 is next too');

    // Match case.
    clickEl(bar().querySelector('[data-option="caseSensitive"]'));
    waitFor(() => st().complete && st().count === 2, 'match case: alpha and alphabet only: ' + JSON.stringify(st()));
    assert(bar().querySelector('[data-option="caseSensitive"]').classList.contains('on'), 'the toggle shows it');
    // Whole word.
    clickEl(bar().querySelector('[data-option="wholeWord"]'));
    waitFor(() => st().complete && st().count === 1, 'whole word: just alpha: ' + JSON.stringify(st()));
    clickEl(bar().querySelector('[data-option="caseSensitive"]'));
    clickEl(bar().querySelector('[data-option="wholeWord"]'));
    waitFor(() => st().complete && st().count === 3, 'toggles off: three again');

    // A regular expression, and a broken one.
    clickEl(bar().querySelector('[data-option="regex"]'));
    input.value = '';
    input.focus();
    type('error\\s+\\d+');
    waitFor(() => st().complete && st().count === 2 && st().pattern === 'error\\s+\\d+', 'regex finds both errors: ' + JSON.stringify(st()));
    type('(');
    waitFor(() => bar().dataset.state === 'error', 'a bad pattern is reported: ' + status());
    eq(status(), 'Invalid pattern', 'as an invalid pattern');
    clickEl(bar().querySelector('[data-option="regex"]'));
    waitFor(() => bar().dataset.state !== 'error', 'the same text as plain text is fine');

    // Buttons.
    input.value = '';
    input.focus();
    type('error');
    waitFor(() => st().complete && st().count === 2, 'two errors');
    clickEl(bar().querySelector('.find-next'));
    eq(st().current, 0, 'the down arrow is next');
    clickEl(bar().querySelector('.find-prev'));
    eq(st().current, 1, 'the up arrow is previous');

    // Escape closes and clears.
    input.focus();
    press('escape');
    assert(!app.findbar.open && !bar(), 'Escape closes the bar');
    waitFor(() => !st().active, 'and clears the search');
    waitFor(() => document.activeElement === el, 'the terminal has the keyboard back');

    // The palette and commands reach it too.
    app.commands.run('find', { query: 'beta' });
    waitFor(() => st().active && st().complete && st().count === 1, 'find with a query');
    app.commands.run('findNext');
    eq(st().current, 0, 'findNext');
    app.findbar.close();
    console.log('test_find: finished');
}
