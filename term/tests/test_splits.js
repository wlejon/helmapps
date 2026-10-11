// Splits: right and down, the running processes untouched by a split, the
// grid following each pane's share, focus moving by direction, resizing by
// key and by dragging a divider, zoom, and closing a pane folding its split.

import { app, waitFor, eq, press, mod, settle, clickEl, requireApp } from './lib/harness.js';

function rect(el) { return el.getBoundingClientRect(); }

if (requireApp()) {
    const ws = app.workspace;
    app.settings.set('confirmClose', 'never');
    waitFor(() => ws.activePane() && ws.activePane().running, 'the first shell');
    const tab = ws.active;
    const first = tab.focused;
    const pid = first.pid;
    const fullCols = first.el.cols;
    assert(fullCols > 60, 'a full-width pane has a wide grid (' + fullCols + ' cols)');

    // Split right: two panes side by side, the new one focused.
    press('alt+shift+=');
    eq(tab.shape(), 'row(P,P)', 'alt+shift+= splits right');
    const right = tab.focused;
    assert(right !== first, 'the new pane is focused');
    waitFor(() => right.running, 'the new pane\'s shell');
    waitFor(() => document.activeElement === right.el, 'keyboard focus on the new pane');
    waitFor(() => first.el.cols < fullCols * 0.6, 'the first pane\'s grid to shrink to its half');
    assert(first.running && first.pid === pid, 'splitting did not disturb the first pane\'s process');
    const a = rect(first.root), b = rect(right.root);
    assert(Math.abs(a.width - b.width) < 8 && a.right <= b.left + 1, 'halves side by side: ' + a.width + ' / ' + b.width);

    // Split down in the right pane.
    app.commands.run('splitPane', { direction: 'down' });
    eq(tab.shape(), 'row(P,column(P,P))', 'splitting the right pane down');
    const bottom = tab.focused;
    waitFor(() => bottom.running, 'the third shell');
    assert(rect(bottom.root).top >= rect(right.root).bottom - 1, 'the new pane is below');

    // Focus by direction.
    press('alt+up');
    assert(tab.focused === right, 'alt+up moves to the pane above');
    waitFor(() => document.activeElement === right.el, 'keyboard focus follows');
    press('alt+left');
    assert(tab.focused === first, 'alt+left moves to the left pane');
    press('alt+right');
    assert(tab.focused === right || tab.focused === bottom, 'alt+right moves back to the right column');
    const was = tab.focused;
    app.commands.run('moveFocus', { direction: 'next' });
    assert(tab.focused !== was, 'moveFocus next cycles panes');
    clickEl(bottom.el);
    assert(tab.focused === bottom, 'clicking a pane focuses it');

    // Resize by key: the bottom pane grows upward.
    const before = rect(bottom.root).height;
    press('alt+shift+up');
    press('alt+shift+up');
    advanceTime(16);
    assert(rect(bottom.root).height > before + 10, 'alt+shift+up grows the bottom pane: ' + before + ' -> ' + rect(bottom.root).height);

    // Resize by dragging the vertical divider to the left.
    const divider = tab.el.querySelector('.divider.row');
    assert(divider, 'a column divider exists');
    const d = rect(divider);
    const leftBefore = rect(first.root).width;
    mouseDown(d.left + 2, d.top + 100);
    mouseMove(d.left - 100, d.top + 100);
    mouseMove(d.left - 200, d.top + 100);
    mouseUp(d.left - 200, d.top + 100);
    advanceTime(16);
    const leftAfter = rect(first.root).width;
    assert(leftAfter < leftBefore - 150, 'dragging the divider narrows the left pane: ' + leftBefore + ' -> ' + leftAfter);
    waitFor(() => first.el.cols < fullCols * 0.45, 'its grid to follow');

    // Zoom the focused pane over the whole tab, and back.
    ws.focusPane(right);
    press(mod + '+shift+z');
    assert(tab.zoomed === right, 'ctrl+shift+z zooms');
    const z = rect(right.root), t = rect(tab.el);
    assert(Math.abs(z.width - t.width) < 2 && Math.abs(z.height - t.height) < 2, 'the zoomed pane covers the tab');
    assert(getComputedStyle(first.root).visibility === 'hidden', 'the others are hidden');
    press(mod + '+shift+z');
    assert(!tab.zoomed, 'pressing it again unzooms');
    assert(getComputedStyle(first.root).visibility !== 'hidden', 'everything is visible again');

    // Closing a pane folds its split; its sibling takes the space.
    ws.focusPane(bottom);
    press(mod + '+shift+w');
    waitFor(() => tab.shape() === 'row(P,P)', 'closing the bottom pane');
    assert(!document.body.contains(bottom.el), 'its terminal left the document');
    assert(tab.focused === right, 'focus moved to its sibling');
    assert(Math.abs(rect(right.root).height - rect(tab.el).height) < 2, 'the sibling fills the column');
    app.commands.run('closePane');
    waitFor(() => tab.shape() === 'P', 'closing the right pane');
    waitFor(() => Math.abs(rect(first.root).width - rect(tab.el).width) < 2, 'the first pane fills the tab');
    assert(first.running && first.pid === pid, 'the first pane ran through all of it');
    settle(100);
    console.log('test_splits: finished');
}
