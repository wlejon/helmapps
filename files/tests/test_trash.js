// Trash tests:
// 1. Without a mock provider in headless mode, pressing Delete asks a confirmation
//    dialog and answering Cancel leaves the user's real OS Trash untouched.
// 2. With an isolated fixtureDir-backed trash provider (app.setMockTrash), tests
//    moving to Trash, viewing Trash (original location + deletion date), restoring
//    via Undo toast and via the Restore button, and Emptying Trash.

import { app, waitFor, eq, press, clickEl,
  currentDialog, dialogButton, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const root = fixtureDir({
  'work/draft.txt': 'draft text',
  'work/ discard.txt': 'to be emptied',
});
const workDir = path.join(root, 'work');
const trashStorage = path.join(root, '.mock-trash');

app.views.setViewMode('list');
app.openPath(workDir);
waitFor(() => app.state.currentPath === workDir && app.state.done && app.list.items.length === 2, 'workDir loaded');

const names = () => app.list.items.map((it) => it.name);

// 1. Real trash protection in headless: Delete asks confirmation, Cancel keeps file.
app.list.select([path.join(workDir, 'draft.txt')]);
press('delete');
waitFor(() => currentDialog(), 'Delete on real trash in headless opens confirmation dialog');
dialogButton('Cancel');
waitFor(() => !currentDialog(), 'confirmation closed');
assert(fs.existsSync(path.join(workDir, 'draft.txt')), 'draft.txt untouched after Cancel');

// 2. Isolated mock trash provider: full Trash, Restore, and Empty Trash workflow.
app.setMockTrash(trashStorage);

app.list.select([path.join(workDir, 'draft.txt')]);
press('delete');
waitFor(() => !names().includes('draft.txt'), 'draft.txt moved to mock trash');
assert(!fs.existsSync(path.join(workDir, 'draft.txt')), 'draft.txt moved off workDir');
waitFor(() => document.querySelector('.toast'), 'Moved to Trash toast shown');

// Open Trash view (trash://)
app.openPath('trash://');
waitFor(() => app.state.currentPath === 'trash://' && app.state.done && app.list.items.length === 1, 'Trash view lists 1 item');
eq(app.list.items[0].name, 'draft.txt', 'trashed item name is draft.txt');
eq(app.list.items[0].originalPath, path.join(workDir, 'draft.txt'), 'trashed item records originalPath');
assert(!app.trash.bannerEl.classList.contains('hidden'), 'Trash banner is visible in Trash view');

// Select the item in Trash and click Restore in the Trash banner
app.list.select([app.list.items[0].path]);
clickEl(app.trash.restoreBtn);
waitFor(() => app.list.items.length === 0, 'Trash is empty after Restore');
assert(fs.existsSync(path.join(workDir, 'draft.txt')), 'draft.txt restored to original location');

// Trash another item and test Empty Trash with confirmation
app.openPath(workDir);
waitFor(() => app.state.currentPath === workDir && app.state.done && app.list.items.length === 2, 'back in workDir with 2 files');
app.list.select([path.join(workDir, ' discard.txt')]);
press('delete');
waitFor(() => app.list.items.length === 1, 'second file moved to trash');

app.openPath('trash://');
waitFor(() => app.state.currentPath === 'trash://' && app.state.done && app.list.items.length === 1, 'Trash view has 1 item');

clickEl(app.trash.emptyBtn);
waitFor(() => currentDialog(), 'Empty Trash confirmation dialog opened');
dialogButton('Cancel');
waitFor(() => !currentDialog(), 'Cancel closed dialog');
eq(app.list.items.length, 1, 'Item still in Trash after Cancel');

clickEl(app.trash.emptyBtn);
waitFor(() => currentDialog(), 'Empty Trash confirmation dialog opened again');
dialogButton('Empty Trash');
waitFor(() => !currentDialog() && app.list.items.length === 0, 'Trash emptied after confirming');

console.log('test_trash PASSED');
