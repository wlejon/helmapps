// Disk Usage end to end: open a folder, the biggest entry first, walk in and
// back, sort by name, the context menu, copy a path, and the trash question
// (answered Cancel: a test never trashes, the Trash is the user's).

import { app, waitFor, eq, press, clickEl, dblClickEl, rightClickEl, menuLabels, chooseMenu,
  currentDialog, dialogButton, fixtureDir, mod } from '/lib/test.js';

const path = require('path');

const dir = fixtureDir({
  'small.txt': 'x'.repeat(100),
  'big/one.bin': new Uint8Array(50000),
  'big/two.bin': new Uint8Array(20000),
  'medium/three.bin': new Uint8Array(30000),
});

// Before a folder is chosen: the start state offers a choice.
assert(document.querySelector('.du-home .du-choose'), 'the start state offers Choose Folder');

app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.current && app.state.current.complete, 'the scan of the fixture');
waitFor(() => app.list.items.length === 3, 'the list to show the whole folder');
const names = () => app.list.items.map((n) => n.name);
eq(names(), ['big', 'medium', 'small.txt'], 'largest first');
eq(document.querySelector('.du-total').textContent, '97.8 KB', 'the folder total');
waitFor(() => document.querySelectorAll('.vlist-row').length === 3, 'three rows on screen');

// Walk into "big" by double-click, then back with the keyboard.
const rows = () => Array.from(document.querySelectorAll('.vlist-row'));
dblClickEl(rows().find((r) => r.textContent.includes('big')));
waitFor(() => path.basename(app.state.currentPath) === 'big', 'walking into big');
eq(names(), ['one.bin', 'two.bin'], 'big\'s files, largest first');
eq(Array.from(document.querySelectorAll('.crumb')).map((c) => c.textContent),
  [path.basename(dir), 'big'], 'breadcrumbs show the way down');
press('alt+left');
waitFor(() => app.state.currentPath === dir, 'Back');

// Sort by name from the column header.
clickEl(Array.from(document.querySelectorAll('.list-header .col')).find((c) => c.textContent.startsWith('Name')));
eq(names(), ['big', 'medium', 'small.txt'], 'name ascending');
clickEl(Array.from(document.querySelectorAll('.list-header .col')).find((c) => c.textContent.startsWith('Name')));
eq(names(), ['small.txt', 'medium', 'big'], 'name descending on a second click');

// Selection drives the status bar.
clickEl(rows().find((r) => r.textContent.includes('medium')));
eq(app.list.selectedItems().map((n) => n.name), ['medium'], 'click selects');
assert(document.querySelector('.statusbar').textContent.includes('1 item selected'), 'the status bar counts it');

// Context menu.
rightClickEl(rows().find((r) => r.textContent.includes('medium')));
const labels = menuLabels();
assert(labels.includes('Open Folder') && labels.includes('Copy Path'), 'context menu: ' + labels.join(', '));
chooseMenu('Copy Path');
waitFor(() => document.querySelector('.toast'), 'the copy toast');

// Trash asks first; Cancel keeps the folder. (Only where bro.vfs exists.)
if (typeof bro !== 'undefined' && bro.vfs && bro.vfs.available !== false) {
  press('delete');
  waitFor(() => currentDialog(), 'the trash question');
  dialogButton('Cancel');
  eq(names().includes('medium'), true, 'Cancel left it alone');
} else {
  console.log('test_ui: bro.vfs unavailable here, trash not exercised');
}

// Count Hidden Files is a toggle command with a persisted setting.
eq(app.settings.get('showHidden'), false, 'hidden files off by default');
press(`${mod}+h`);
eq(app.settings.get('showHidden'), true, 'Mod+H turns them on');

console.log('test_ui PASSED');
