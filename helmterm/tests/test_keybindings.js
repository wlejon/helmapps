// Keybindings: the key grammar, keybindings.json reloaded live (additions,
// "-command" removals, chords, when clauses), bound keys kept from the
// program in the pane, and recording a binding in the settings UI.

import { app, waitFor, eq, press, mod, type, settle, clickEl, CHILD, childAvailable, requireApp,
         writeKeybindings } from './lib/harness.js';
import { normalizePress, parseKeySequence, compileWhen, Keymap } from '../js/core/keys.js';

// ── the grammar (pure) ──
eq(normalizePress('Shift+Ctrl+T'), 'ctrl+shift+t', 'modifier order and case');
eq(normalizePress('cmd+,'), 'meta+,', 'cmd is meta');
eq(normalizePress('alt+shift+plus'), 'shift+alt+=', 'plus names the = key');
eq(normalizePress('ctrl++'), 'ctrl+=', 'ctrl++');
eq(normalizePress('ctrl+PageDown'), 'ctrl+pagedown', 'named keys');
eq(normalizePress('ctrl+foo+x'), null, 'an unknown modifier is refused');
eq(parseKeySequence('ctrl+k  ctrl+s'), ['ctrl+k', 'ctrl+s'], 'a chord');
eq(compileWhen('a && !b')({ a: true, b: false }), true, 'when: && and !');
eq(compileWhen('a && !b')({ a: true, b: true }), false, 'when: negation');
eq(compileWhen('x == "y" || z')({ x: 'y' }), true, 'when: == and ||');
eq(compileWhen('(a || b) && c')({ b: true, c: true }), true, 'when: parentheses');
eq(compileWhen('a &&')({ a: true }), false, 'a broken clause is never true');
const km = new Keymap([
    { key: 'ctrl+a', command: 'one' },
    { key: 'ctrl+a', command: 'two' },
    { key: 'ctrl+b', command: 'three' },
    { key: 'ctrl+b', command: '-three' },
    { key: 'ctrl+k ctrl+c', command: 'chord' },
    { key: 'nonsense+key+here', command: 'bad' },
]);
eq(km.press('ctrl+a', {}).binding.command, 'two', 'the last binding of a key wins');
eq(km.press('ctrl+b', {}), null, '"-command" removes');
eq(km.press('ctrl+k', {}).action, 'pending', 'a chord waits');
eq(km.press('ctrl+c', {}).binding.command, 'chord', 'and completes');
km.press('ctrl+k', {});
eq(km.press('x', {}).action, 'cancel', 'a wrong second key cancels');
eq(km.problems.length, 1, 'a bad key is reported: ' + km.problems.join('; '));

if (requireApp()) {
    const ws = app.workspace;
    waitFor(() => ws.activePane() && ws.activePane().running, 'the first shell');

    writeKeybindings([
        { key: 'ctrl+shift+e', command: 'splitPane', args: { direction: 'right' } },
        { key: mod + '+shift+t', command: '-newTab' },
        { key: 'ctrl+k ctrl+n', command: 'newTab' },
        { key: 'ctrl+shift+y', command: 'renameTab', args: { title: 'renamed by key' }, when: 'terminalFocus' },
        { key: 'ctrl+shift+u', command: 'renameTab', args: { title: 'never' }, when: 'paletteOpen' },
    ]);

    // A new binding.
    const tab = ws.active;
    press('ctrl+shift+e');
    eq(tab.shape(), 'row(P,P)', 'ctrl+shift+e (user binding) split the pane');
    press(mod + '+shift+w');
    waitFor(() => tab.shape() === 'P', 'closing it again');

    // A removed default: mod+shift+t no longer opens a tab.
    const n = ws.tabs.length;
    press(mod + '+shift+t');
    eq(ws.tabs.length, n, '-newTab removed ' + mod + '+shift+t');
    // The default remains on the palette's other keys.
    eq(app.keymap.keyFor('newTab'), 'ctrl+k ctrl+n', 'newTab is now on the chord');

    // A chord.
    press('ctrl+k');
    assert(document.body.classList.contains('chord'), 'the first key of a chord is shown as pending');
    press('ctrl+n');
    eq(ws.tabs.length, n + 1, 'ctrl+k ctrl+n opened a tab');
    press('ctrl+k');
    press('x');
    eq(ws.tabs.length, n + 1, 'ctrl+k x does nothing');
    assert(!document.body.classList.contains('chord'), 'and ends the chord');

    // when clauses.
    ws.activePane().focus();
    advanceTime(16);
    press('ctrl+shift+u');
    assert(ws.active.title !== 'never', 'a binding whose when is false does not run');
    press('ctrl+shift+y');
    eq(ws.active.title, 'renamed by key', 'a binding whose when holds runs');

    // A bound key never reaches the program; unbound typing does.
    if (childAvailable()) {
        const t = ws.openTab({ commandline: [CHILD] });
        const p = t.focused;
        waitFor(() => p.el.screenText().includes('TESTCHILD READY'), 'the child');
        p.focus();
        advanceTime(16);
        press('ctrl+shift+y');
        eq(t.title, 'renamed by key', 'the binding ran in the child\'s pane');
        type('hello');
        press('enter');
        waitFor(() => /TESTCHILD GOT /.test(p.el.screenText()), 'the child to echo its input');
        const line = /TESTCHILD GOT (.*)/.exec(p.el.screenText())[1];
        eq(line.trim(), 'hello', 'the child got exactly the unbound typing');
    }

    // Record a binding in the settings UI.
    app.commands.run('openSettings', { page: 'keys' });
    const row = document.querySelector('.keys-row[data-command="about"]');
    assert(row, 'the About command is listed');
    clickEl(row.querySelector('.keys-record'));
    press('ctrl+alt+b');
    waitFor(() => app.settings.userKeybindings.some((b) => b.key === 'ctrl+alt+b' && b.command === 'about'), 'the recorded binding saved');
    eq(app.keymap.keyFor('about'), 'ctrl+alt+b', 'and live');
    app.settingsUI.close();
    press('ctrl+alt+b');
    assert(app.overlays.isOpen('about'), 'the recorded key opens About');
    press('escape');
    assert(!app.overlays.isOpen(), 'Escape closes it');
    settle(100);
    console.log('test_keybindings: finished');
}
