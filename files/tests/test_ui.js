// UI regression tests for Files (helm.files):
// 1. Trash toast 'Undo' delegates through TransferManager.undo(), updating
//    canUndo()/canRedo() and allowing redo() without leaving stale undoStack entries.
// 2. Sorting (saveFolderSort) and toggling hidden files (showHidden) during an
//    active recursive search re-sort and filter the recursive search results
//    instead of reverting to the current folder's rawEntries.

import { app, waitFor, eq, press, type, clickEl, fixtureDir, mod } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const root = fixtureDir({
  'work/alpha.txt': 'alpha',
  'work/beta.txt': 'beta',
  'search_root/top_match.txt': '12',
  'search_root/other.md': 'other',
  'search_root/sub/deep_match.txt': '123456',
  'search_root/sub/.hidden_match.txt': '1',
});

const workDir = path.join(root, 'work');
const searchDir = path.join(root, 'search_root');
const trashStorage = path.join(root, '.mock-trash');

app.views.setViewMode('list');
app.setMockTrash(trashStorage);

// 1. Trash toast Undo -> TransferManager undo/redo synchronization
app.openPath(workDir);
waitFor(() => app.state.currentPath === workDir && app.state.done && app.list.items.length === 2, 'workDir loaded');

const names = () => app.list.items.map((it) => it.name);

app.transfer.undoStack = [];
app.transfer.redoStack = [];
eq(app.transfer.canUndo(), false, 'canUndo initially false');
eq(app.transfer.canRedo(), false, 'canRedo initially false');

app.list.select([path.join(workDir, 'alpha.txt')]);
press('delete');
waitFor(() => !names().includes('alpha.txt'), 'alpha.txt moved to mock trash');
eq(app.transfer.canUndo(), true, 'canUndo is true after trashing');
eq(app.transfer.canRedo(), false, 'canRedo is false after trashing');

const toastUndoBtn = () => document.querySelector('.toast[data-toast-key="trash"] button.btn.small');
waitFor(() => toastUndoBtn(), 'Trash toast with Undo button shown');
clickEl(toastUndoBtn());

waitFor(() => names().includes('alpha.txt'), 'clicking Trash toast Undo restores alpha.txt');
assert(fs.existsSync(path.join(workDir, 'alpha.txt')), 'alpha.txt exists on disk after toast Undo');
eq(app.transfer.canUndo(), false, 'canUndo is false after toast Undo popped undoStack');
eq(app.transfer.canRedo(), true, 'canRedo is true after toast Undo pushed redoStack');
eq(app.transfer.undoStack.length, 0, 'no stale entry left on undoStack');

// Redo re-trashes alpha.txt
app.transfer.redo();
waitFor(() => !names().includes('alpha.txt'), 'transfer.redo() re-trashes alpha.txt');
assert(!fs.existsSync(path.join(workDir, 'alpha.txt')), 'alpha.txt moved back to trash on redo');
eq(app.transfer.canUndo(), true, 'canUndo is true after redo');
eq(app.transfer.canRedo(), false, 'canRedo is false after redo');

// Undo again via keyboard shortcut (Mod+Z)
press(`${mod}+z`);
waitFor(() => names().includes('alpha.txt'), 'Mod+Z restores alpha.txt cleanly');

// 2. Recursive search preserves recursiveEntries across sort and showHidden toggles
app.openPath(searchDir);
waitFor(() => app.state.currentPath === searchDir && app.state.done && app.list.items.length === 3, 'searchDir loaded');

press(`${mod}+f`);
type('match');
press('enter');
waitFor(() => app.state.searchRecursive && !app.state.searching && app.list.items.length === 2,
  'recursive search found 2 non-hidden matches');
eq(names(), ['deep_match.txt', 'top_match.txt'], 'initial recursive results sorted by name asc');

// Changing sort order during recursive search re-sorts recursive results instead of reverting to rawEntries
app.model.saveFolderSort('name', -1);
eq(names(), ['top_match.txt', 'deep_match.txt'], 'saveFolderSort(name, -1) re-sorts recursive search results descending');
assert(!names().includes('other.md'), 'non-matching folder entry other.md does not leak into recursive search');

app.model.saveFolderSort('size', -1);
eq(names(), ['deep_match.txt', 'top_match.txt'], 'saveFolderSort(size, -1) sorts recursive results by size desc');

// Toggling showHidden during recursive search filters recursiveEntries rather than reverting to rawEntries
press(`${mod}+h`);
waitFor(() => app.list.items.length === 3, 'toggling showHidden=true reveals .hidden_match.txt in recursive results');
eq(names(), ['deep_match.txt', 'top_match.txt', '.hidden_match.txt'], 'all 3 recursive matches shown sorted by size desc');

press(`${mod}+h`);
waitFor(() => app.list.items.length === 2, 'toggling showHidden=false hides .hidden_match.txt again');
eq(names(), ['deep_match.txt', 'top_match.txt'], 'non-hidden recursive matches remain');

console.log('test_ui PASSED');
