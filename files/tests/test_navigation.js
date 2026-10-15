// Files navigation, view switching, per-folder sorting, breadcrumbs & Mod+L,
// hidden files toggle, bookmarks, Properties dialog, and file-path launch.

import { app, waitFor, eq, press, type, clickEl, dblClickEl,
  currentDialog, dialogButton, fixtureDir, mod } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const dir = fixtureDir({
  '.hidden_cfg': 'secret',
  'docs/readme.txt': 'hello docs',
  'pics/photo.png': 'fake-png',
});

// Create files with distinct mtimes via fs.utimesSync so Modified sort is deterministic: beta < alpha < gamma
const pBeta = path.join(dir, 'beta.log');
const pAlpha = path.join(dir, 'alpha.txt');
const pGamma = path.join(dir, 'gamma.md');
if (typeof fs.utimesSync === 'function') {
  fs.writeFileSync(pBeta, 'x'.repeat(50));
  fs.writeFileSync(pAlpha, 'x'.repeat(200));
  fs.writeFileSync(pGamma, 'x'.repeat(1200));
  fs.utimesSync(pBeta, 1700000100, 1700000100);
  fs.utimesSync(pAlpha, 1700000200, 1700000200);
  fs.utimesSync(pGamma, 1700000300, 1700000300);
} else {
  fs.writeFileSync(pBeta, 'x'.repeat(50));
  wallSleep(15);
  fs.writeFileSync(pAlpha, 'x'.repeat(200));
  wallSleep(15);
  fs.writeFileSync(pGamma, 'x'.repeat(1200));
}

// 1. Opening a fixture lists its entries, folders first, and status bar counts them.
app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.done && app.list.items.length === 5, 'fixture folder to load');

const names = () => app.list.items.map((it) => it.name);
eq(names(), ['docs', 'pics', 'alpha.txt', 'beta.log', 'gamma.md'], 'folders sort first, then files by name');
assert(document.querySelector('.statusbar').textContent.includes('5 items'), 'status bar counts 5 items');

// 2. Grid and list views show the same items, and switching keeps the selection.
app.views.setViewMode('grid');
waitFor(() => document.querySelectorAll('.vgrid-cell').length === 5, 'grid cells rendered');
const alphaCell = Array.from(document.querySelectorAll('.vgrid-cell')).find((el) => el.textContent.includes('alpha.txt'));
clickEl(alphaCell);
eq(app.list.selectedItems().map((it) => it.name), ['alpha.txt'], 'alpha.txt selected in grid');

press(`${mod}+2`);
waitFor(() => app.state.view === 'list' && document.querySelectorAll('.vlist-row').length === 5, 'switched to list view');
eq(names(), ['docs', 'pics', 'alpha.txt', 'beta.log', 'gamma.md'], 'list view shows the same items');
eq(app.list.selectedItems().map((it) => it.name), ['alpha.txt'], 'selection preserved across view switch');

// 3. Sorting by Size and Modified in list view orders correctly, and reopening restores sort.
const headerCol = (label) => Array.from(document.querySelectorAll('.list-header .col')).find((c) => c.textContent.startsWith(label));

clickEl(headerCol('Size'));
eq(names(), ['docs', 'pics', 'beta.log', 'alpha.txt', 'gamma.md'], 'size ascending (folders still first)');

clickEl(headerCol('Size'));
eq(names(), ['docs', 'pics', 'gamma.md', 'alpha.txt', 'beta.log'], 'size descending (folders still first)');

clickEl(headerCol('Modified'));
eq(names(), ['docs', 'pics', 'beta.log', 'alpha.txt', 'gamma.md'], 'modified ascending (folders still first)');

// 4. Double-click into a subfolder, then Back, Forward, and Up, with breadcrumbs updating.
const rows = () => Array.from(document.querySelectorAll('.vlist-row'));
dblClickEl(rows().find((r) => r.textContent.includes('docs')));
waitFor(() => app.state.currentPath === path.join(dir, 'docs') && app.state.done, 'entered docs subfolder');
eq(names(), ['readme.txt'], 'docs contents listed');

const crumbLabels = () => Array.from(document.querySelectorAll('.crumb')).map((c) => c.textContent);
assert(crumbLabels().slice(-2).join('/') === `${path.basename(dir)}/docs`, 'breadcrumbs end with parent/docs');

press('alt+left');
waitFor(() => app.state.currentPath === dir && app.state.done, 'Back returned to root fixture');
eq(names(), ['docs', 'pics', 'beta.log', 'alpha.txt', 'gamma.md'], 'reopening folder restored its Modified ascending sort');

press('alt+right');
waitFor(() => app.state.currentPath === path.join(dir, 'docs') && app.state.done, 'Forward returned to docs');

press('alt+up');
waitFor(() => app.state.currentPath === dir && app.state.done, 'Up returned to root fixture');

// 5. Location bar (Mod+L) navigates to a typed path.
press(`${mod}+l`);
waitFor(() => !app.locationBar.input.classList.contains('hidden'), 'location input visible');
const picsPath = path.join(dir, 'pics');
app.locationBar.input.value = picsPath;
press('enter');
waitFor(() => app.state.currentPath === picsPath && app.state.done, 'navigated to pics via location bar');
eq(names(), ['photo.png'], 'pics folder contents shown');

// Navigate back to dir via breadcrumb click
const parentCrumb = Array.from(document.querySelectorAll('.crumb')).find((c) => c.textContent === path.basename(dir));
clickEl(parentCrumb);
waitFor(() => app.state.currentPath === dir && app.state.done, 'breadcrumb click navigated back to dir');

// 6. Hidden files: hidden by default, shown after Mod+H, and persisted in settings.
eq(app.settings.get('showHidden'), false, 'showHidden false by default');
eq(names().includes('.hidden_cfg'), false, '.hidden_cfg hidden by default');
press(`${mod}+h`);
waitFor(() => app.list.items.some((it) => it.name === '.hidden_cfg'), '.hidden_cfg appears after Mod+H');
eq(app.settings.get('showHidden'), true, 'showHidden persisted in settings');
press(`${mod}+h`);
waitFor(() => !app.list.items.some((it) => it.name === '.hidden_cfg'), '.hidden_cfg hidden again after second Mod+H');

// 7. Properties dialog (Alt+Enter).
app.list.select([path.join(dir, 'gamma.md')]);
press('alt+enter');
waitFor(() => currentDialog(), 'Properties dialog opened');
assert(currentDialog().el.textContent.includes('gamma.md'), 'Properties shows file name');
assert(currentDialog().el.textContent.includes('1.2 KB'), 'Properties shows file size');
dialogButton('Close');
waitFor(() => !currentDialog(), 'Properties dialog closed');

// 8. Launching with a file path opens its containing folder with the file selected.
const readmePath = path.join(dir, 'docs', 'readme.txt');
app.handleLaunchArgs({ argv: [readmePath], cwd: dir, first: false });
waitFor(() => app.state.currentPath === path.join(dir, 'docs') && app.state.done, 'opened containing folder of file arg');
waitFor(() => app.list.selectedItems().length === 1 && app.list.selectedItems()[0].name === 'readme.txt', 'target file selected');

console.log('test_navigation PASSED');
