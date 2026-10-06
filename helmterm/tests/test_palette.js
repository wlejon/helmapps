// The command palette and the new-tab menu: fuzzy search over commands,
// profiles, tabs and schemes, keyboard navigation, and running the choice.

import { app, waitFor, eq, press, mod, type, settle, clickEl, requireApp } from './lib/harness.js';
import { fuzzyMatch, fuzzyFilter } from '../ui/js/core/fuzzy.js';

// ── the matcher (pure) ──
assert(fuzzyMatch('spr', 'Pane: Split right'), 'subsequence across words');
assert(!fuzzyMatch('xyz', 'Pane: Split right'), 'no match');
const ranked = fuzzyFilter('st', ['Tab: Rename tab', 'Pane: Split pane', 'Settings'], (s) => s).map((r) => r.item);
eq(ranked[0], 'Settings', 'a prefix match ranks first: ' + ranked.join(' | '));
eq(fuzzyMatch('nt', 'New tab').positions, [0, 4], 'word starts are preferred');

if (requireApp()) {
    const ws = app.workspace;
    waitFor(() => ws.activePane() && ws.activePane().running, 'the first shell');

    // Open by key; the input has the focus.
    press(mod + '+shift+p');
    assert(app.palette.open, 'ctrl+shift+p opens the palette');
    const input = document.querySelector('.palette-input');
    assert(input && document.activeElement === input, 'the query box has the focus');
    const all = app.palette.labels();
    for (const want of ['Tab: New tab', 'Pane: Split pane', 'Preferences: Settings', 'View: Command palette']) {
        assert(all.includes(want), 'lists ' + want);
    }
    assert(all.some((l) => l.startsWith('New tab: ')), 'lists profiles');
    assert(all.some((l) => l.startsWith('Color scheme: ')), 'lists schemes');
    assert(all.some((l) => l.startsWith('Switch to tab: ')), 'lists open tabs');
    assert(document.querySelector('.palette-row .palette-key'), 'shows key bindings beside commands');

    // Typing filters; the top hit runs on Enter.
    type('splright');
    advanceTime(16);
    const hits = app.palette.labels();
    assert(hits.length > 0 && /Split right/.test(hits[0]), 'fuzzy "splright": ' + hits.slice(0, 3).join(' | '));
    assert(document.querySelectorAll('.palette-row .match').length > 0, 'matched characters are highlighted');
    const tab = ws.active;
    press('enter');
    assert(!app.palette.open, 'Enter closes the palette');
    eq(tab.shape(), 'row(P,P)', 'and ran Split right');

    // Arrow keys move the selection.
    press(mod + '+shift+p');
    type('tab');
    advanceTime(16);
    const first = app.palette.index;
    press('down');
    press('down');
    eq(app.palette.index, first + 2, 'down moves the selection');
    press('up');
    eq(app.palette.index, first + 1, 'up moves it back');
    assert(document.querySelectorAll('.palette-row')[first + 1].classList.contains('selected'), 'the row is marked');
    press('escape');
    assert(!app.palette.open, 'Escape closes without running anything');

    // A scheme entry changes the setting.
    press(mod + '+shift+p');
    type('scheme nord');
    advanceTime(16);
    eq(app.palette.labels()[0], 'Color scheme: Nord', 'the scheme entry');
    press('enter');
    eq(app.settings.values.colorScheme, 'Nord', 'choosing it sets colorScheme');

    // Switching tabs through the palette, with a click.
    ws.openTab({});
    app.commands.run('renameTab', { title: 'palette target' });
    ws.activateIndex(0);
    press(mod + '+shift+p');
    type('palette target');
    advanceTime(16);
    clickEl(document.querySelectorAll('.palette-row')[0]);
    eq(ws.active.title, 'palette target', 'clicking "Switch to tab" switched');

    // Nothing matches: says so.
    press(mod + '+shift+p');
    type('qqqqzzzz');
    advanceTime(16);
    assert(document.querySelector('.palette-empty'), 'an empty result says so');
    press('escape');

    // The new-tab dropdown lists the profiles and opens one.
    clickEl(document.getElementById('new-tab-menu'));
    assert(app.overlays.isOpen('menu'), 'the dropdown opens');
    const items = [...document.querySelectorAll('.menu-item .menu-label')].map((e) => e.textContent);
    for (const p of app.profiles.visible()) assert(items.includes(p.name), 'the menu lists ' + p.name);
    assert(items.includes('Settings') && items.includes('About broterm'), 'and the app entries');
    const n = ws.tabs.length;
    clickEl(document.querySelectorAll('.menu-item')[0]);
    eq(ws.tabs.length, n + 1, 'choosing a profile opens a tab');
    eq(ws.activePane().profile.name, app.profiles.visible()[0].name, 'with that profile');
    assert(!app.overlays.isOpen(), 'and closes the menu');

    // The about box.
    app.commands.run('about');
    assert(document.querySelector('.dialog.about'), 'About opens');
    assert(document.querySelector('.dialog.about').textContent.includes(app.host.version), 'it shows the version');
    press('escape');
    settle(100);
    console.log('test_palette: finished');
}
