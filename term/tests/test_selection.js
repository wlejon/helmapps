// Selection, the clipboard settings and links: every element option comes
// from settings (and per profile); copy-on-select copies a mouse selection
// and a middle click pastes it into the program; select all and copy; a
// link under the pointer shows what Ctrl+click opens, and Ctrl+click
// activates it.

import { app, waitFor, settle, eq, CHILD, childAvailable, requireApp, writeSettings, reportPath,
         childProfile } from './lib/harness.js';

const SDLK_LCTRL = 0x400000E0;
const SDLK_LGUI = 0x400000E3;
const MAC = process.platform === 'darwin';

function cellPoint(el, col, line) {
    const r = el.getBoundingClientRect();
    const m = el.metrics;
    const pad = parseFloat(el.style.padding) || 0;
    return [r.left + pad + (col + 0.5) * m.cellWidth, r.top + pad + (line + 0.5) * m.cellHeight];
}

if (requireApp() && !childAvailable()) {
    skipTest('helmterm-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;
    writeSettings({
        confirmClose: 'never',
        copyOnSelect: true,
        middleClickPaste: true,
        boldIsBright: true,
        minimumContrast: 4.5,
        ligatures: true,
        wheelLines: 7,
        scrollOnInput: false,
        profiles: { list: [
            childProfile('Sel Child', reportPath('s')),
            childProfile('Wheel Child', reportPath('w'), { wheelLines: 11, copyOnSelect: false }),
        ] },
    });

    // ── options from settings, and per profile ──
    const t = ws.openTab({ profile: 'Sel Child' });
    const pane = t.focused;
    const el = pane.el;
    waitFor(() => el.screenText().includes('TESTCHILD READY'), 'the child');
    const o = el.options;
    eq([o.copyOnSelect, o.middleClickPaste, o.boldIsBright, o.minimumContrast, o.ligatures, o.wheelLines, o.scrollOnInput],
        [true, true, true, 4.5, true, 7, false], 'the element\'s options follow settings.json');
    eq(o.clipboard, 'read-write', 'clipboard reads reach helmterm (which asks)');
    const t2 = ws.openTab({ profile: 'Wheel Child' });
    eq([t2.focused.el.options.wheelLines, t2.focused.el.options.copyOnSelect], [11, false], 'a profile overrides them');
    app.settings.set('wheelLines', 4);
    waitFor(() => el.options.wheelLines === 4, 'a settings change reaches running terminals');
    eq(t2.focused.el.options.wheelLines, 11, 'but not past a profile\'s own value');
    ws.activate(t);

    // ── copy on select, middle click pastes ──
    el.feed('\x1b[H\x1b[2Jpick-me-word and more\r\n');
    waitFor(() => el.frameText().startsWith('pick-me-word'), 'the text to select');
    const top = el.viewport.topRow;
    const [x0, y0] = cellPoint(el, 0, 0);
    const [x1] = cellPoint(el, 11, 0);
    mouseDown(x0 - 2, y0);
    mouseMove((x0 + x1) / 2, y0);
    mouseMove(x1 + 2, y0);
    mouseUp(x1 + 2, y0);
    advanceTime(16);
    waitFor(() => el.selectionText() === 'pick-me-word', 'a drag selects: ' + JSON.stringify(el.selectionText()));
    eq(el.selection.startRow, top, 'on the first row');
    // The middle click pastes what copy-on-select copied, into the program.
    el.feed('\x1b[5;1H');
    click(...cellPoint(el, 5, 3), 1);
    advanceTime(16);
    el.write('\r');
    waitFor(() => el.screenText().includes('TESTCHILD GOT pick-me-word'), 'the middle click pasted the selection: ' + el.screenText());

    // Without copy-on-select a selection stays out of the clipboard. On
    // Linux a middle click pastes the primary selection, which every
    // selection sets, so there it pastes the new selection instead.
    const LINUX = process.platform === 'linux';
    app.settings.set('copyOnSelect', false);
    waitFor(() => el.options.copyOnSelect === false, 'copyOnSelect off');
    el.feed('\x1b[H\x1b[2Jsecond-word here\r\n');
    waitFor(() => el.frameText().startsWith('second-word'), 'new text');
    const [a0, b0] = cellPoint(el, 0, 0);
    const [a1] = cellPoint(el, 10, 0);
    mouseDown(a0 - 2, b0);
    mouseMove(a1 + 2, b0);
    mouseUp(a1 + 2, b0);
    advanceTime(16);
    waitFor(() => el.selectionText() === 'second-word', 'selected');
    el.feed('\x1b[5;1H');
    click(...cellPoint(el, 5, 3), 1);
    advanceTime(16);
    el.write('\r');
    if (LINUX) {
        waitFor(() => el.screenText().includes('TESTCHILD GOT second-word'), 'the middle click pasted the primary selection');
    } else {
        waitFor(() => (el.screenText().match(/TESTCHILD GOT pick-me-word/g) || []).length >= 1,
            'the clipboard still holds the first word: ' + el.screenText());
        assert(!el.screenText().includes('TESTCHILD GOT second-word'), 'nothing new was copied');
    }

    // Select all, and helmterm's copy command.
    app.commands.run('selectAll');
    assert(el.selection !== null, 'select all selects');
    app.commands.run('copy');
    assert(app.lastCopied && app.lastCopied.includes('second-word here'), 'copy takes the selection: ' + JSON.stringify(app.lastCopied));
    app.commands.run('clearSelection');
    eq(el.selection, null, 'and clear selection clears it');

    // ── links ──
    el.feed('\x1b[H\x1b[2Jvisit https://example.com/docs today\r\n');
    waitFor(() => el.frameText().startsWith('visit'), 'a line with a URL');
    const hint = pane.root.querySelector('.pane-hint');
    mouseMove(...cellPoint(el, 12, 0));
    advanceTime(16);
    waitFor(() => hint.classList.contains('shown'), 'hovering a link shows the hint');
    assert(/click to open the link: https:\/\/example\.com\/docs/.test(hint.textContent), 'naming the link: ' + hint.textContent);
    mouseMove(...cellPoint(el, 1, 0));
    advanceTime(16);
    waitFor(() => !hint.classList.contains('shown'), 'off the link the hint goes');
    const key = MAC ? SDLK_LGUI : SDLK_LCTRL;
    keyDown(key, 0, MAC ? 0x0400 : 0x0040);
    click(...cellPoint(el, 14, 0));
    keyUp(key, 0, 0);
    advanceTime(16);
    waitFor(() => app.lastLink && app.lastLink.uri === 'https://example.com/docs', 'Ctrl+click activates the link: ' + JSON.stringify(app.lastLink));
    eq(app.lastLink.kind, 'url', 'a URL');
    console.log('test_selection: finished');
}
