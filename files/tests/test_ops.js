// Files operations: New Folder, Rename (with validation), Copy/Paste, Cut/Paste,
// Paste conflict (Keep Both), Undo/Redo, live filesystem watch, permanent delete
// confirmation, and graceful fallback when bro.vfs is disabled.

import { app, waitFor, settle, eq, press, rightClickEl, menuLabels, chooseMenu,
  currentDialog, dialogButton, answerPrompt, fixtureDir, mod } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const dir = fixtureDir({
  'note.txt': 'hello world',
  'keep.txt': 'stay here',
  'dest/existing.txt': 'original content',
});

app.views.setViewMode('list');
app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.done && app.list.items.length === 3, 'initial folder loaded');

const names = () => app.list.items.map((it) => it.name);

// 1. New Folder creates it on disk and selects it.
press(`${mod}+shift+n`);
waitFor(() => currentDialog(), 'New Folder prompt opened');
answerPrompt('CreatedFolder');
waitFor(() => !currentDialog() && names().includes('CreatedFolder'), 'CreatedFolder appears in view');
assert(fs.existsSync(path.join(dir, 'CreatedFolder')), 'CreatedFolder exists on disk');
eq(app.list.selectedItems().map((it) => it.name), ['CreatedFolder'], 'CreatedFolder is selected');

// 2. Rename changes it on disk, and an invalid name ('a/b') is refused.
app.list.select([path.join(dir, 'note.txt')]);
press('f2');
waitFor(() => currentDialog(), 'Rename prompt opened');

// Try invalid name with slash
const input = currentDialog().body.querySelector('input');
input.value = 'a/b';
input.dispatchEvent(new Event('input'));
advanceTime(16);
const renameBtn = Array.from(currentDialog().actions.querySelectorAll('button')).find((b) => b.textContent === 'Rename');
eq(renameBtn.disabled, true, 'Rename button disabled for invalid name with slash');

// Now provide a valid name
answerPrompt('renamed.txt');
waitFor(() => !currentDialog() && names().includes('renamed.txt'), 'renamed.txt in list');
assert(!fs.existsSync(path.join(dir, 'note.txt')), 'old name removed from disk');
assert(fs.existsSync(path.join(dir, 'renamed.txt')), 'new name exists on disk');
eq(app.list.selectedItems().map((it) => it.name), ['renamed.txt'], 'renamed file stays selected');

// 3. Copy then Paste into another folder: file exists in both.
app.list.select([path.join(dir, 'renamed.txt')]);
press(`${mod}+c`);
const destDir = path.join(dir, 'dest');
app.openPath(destDir);
waitFor(() => app.state.currentPath === destDir && app.state.done, 'opened dest folder');
press(`${mod}+v`);
waitFor(() => names().includes('renamed.txt'), 'copied file pasted into dest');
assert(fs.existsSync(path.join(dir, 'renamed.txt')), 'source file still in original folder');
assert(fs.existsSync(path.join(destDir, 'renamed.txt')), 'copied file in dest folder');

// 4. Paste onto an existing name asks conflict dialog, and Keep Both makes "name (2).ext".
press(`${mod}+v`);
waitFor(() => currentDialog(), 'conflict dialog appeared on second paste');
dialogButton('Keep Both');
waitFor(() => !currentDialog() && names().includes('renamed (2).txt'), 'renamed (2).txt created via Keep Both');
assert(fs.existsSync(path.join(destDir, 'renamed (2).txt')), 'renamed (2).txt exists on disk');

// 5. Cut then Paste moves the file, and Undo puts it back.
app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.done, 'back in root dir');
app.list.select([path.join(dir, 'keep.txt')]);
press(`${mod}+x`);
app.openPath(destDir);
waitFor(() => app.state.currentPath === destDir && app.state.done, 'in dest dir for cut-paste');
press(`${mod}+v`);
waitFor(() => names().includes('keep.txt'), 'keep.txt moved into dest');
assert(!fs.existsSync(path.join(dir, 'keep.txt')), 'keep.txt no longer in root dir');
assert(fs.existsSync(path.join(destDir, 'keep.txt')), 'keep.txt now in dest dir');

// Undo the move
press(`${mod}+z`);
waitFor(() => !names().includes('keep.txt'), 'Undo removed keep.txt from dest');
assert(fs.existsSync(path.join(dir, 'keep.txt')), 'Undo restored keep.txt to root dir');

// 6. Live updates via bro.vfs.watch: external file creation and deletion.
const watchedFile = path.join(destDir, 'live_added.txt');
fs.writeFileSync(watchedFile, 'watched');
waitFor(() => names().includes('live_added.txt'), 'externally created file appears automatically via watch');

fs.unlinkSync(watchedFile);
waitFor(() => !names().includes('live_added.txt'), 'externally deleted file disappears automatically via watch');

// 7. Delete permanently (Shift+Delete) asks first, and Cancel keeps the file.
app.list.select([path.join(destDir, 'existing.txt')]);
press('shift+delete');
waitFor(() => currentDialog(), 'Delete Permanently confirmation dialog opened');
dialogButton('Cancel');
waitFor(() => !currentDialog(), 'confirmation dialog closed');
assert(fs.existsSync(path.join(destDir, 'existing.txt')), 'Cancel kept existing.txt on disk');
eq(names().includes('existing.txt'), true, 'existing.txt still in view');

// 8. Missing bro.vfs fallback: app still browses with fs, and operation commands are disabled.
app.setDisableVfs(true);
app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.done, 'browsed to dir with vfs disabled');
assert(names().includes('renamed.txt') && names().includes('keep.txt'), 'fs fallback lists directory entries');
eq(app.commands.isEnabled('new-folder'), false, 'new-folder disabled without vfs');
eq(app.commands.isEnabled('rename'), false, 'rename disabled without vfs');
eq(app.commands.isEnabled('cut'), false, 'cut disabled without vfs');
eq(app.commands.isEnabled('paste'), false, 'paste disabled without vfs');
eq(app.commands.isEnabled('undo'), false, 'undo disabled without vfs');
assert(!document.querySelector('.files-banner').classList.contains('hidden'), 'read-only banner visible when vfs is missing');

app.setDisableVfs(false);
settle(50);

// 9. Archive integration: Compress to .zip, context menu items, and Extract Here.
const keepRow = Array.from(document.querySelectorAll('.vlist-row')).find((el) => el.textContent.includes('keep.txt'));
assert(keepRow, 'keep.txt row exists');
rightClickEl(keepRow);
assert(menuLabels().includes('Compress to .zip…'), 'context menu offers Compress to .zip…');
chooseMenu('Compress to .zip…');
waitFor(() => currentDialog(), 'Compress to .zip prompt opened');
answerPrompt('bundled.zip');
waitFor(() => !currentDialog() && names().includes('bundled.zip'), 'bundled.zip created and listed');
assert(fs.existsSync(path.join(dir, 'bundled.zip')), 'bundled.zip exists on disk');

const zipRow = Array.from(document.querySelectorAll('.vlist-row')).find((el) => el.textContent.includes('bundled.zip'));
assert(zipRow, 'bundled.zip row exists');
rightClickEl(zipRow);
assert(menuLabels().includes('Open in Archive Manager'), 'context menu for .zip offers Open in Archive Manager');
assert(menuLabels().includes('Extract Here'), 'context menu for .zip offers Extract Here');
chooseMenu('Extract Here');
waitFor(() => names().includes('bundled') && fs.existsSync(path.join(dir, 'bundled', 'keep.txt')),
  'Extract Here extracted bundled.zip into bundled/ subfolder');
eq(fs.readFileSync(path.join(dir, 'bundled', 'keep.txt'), 'utf8'), 'stay here', 'extracted keep.txt content matches');

console.log('test_ops PASSED');
