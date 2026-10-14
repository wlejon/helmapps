// UI & workflow tests for Archive Manager (helm.archives):
// 1. Opening an archive in the UI and verifying root entries.
// 2. Navigating into nested folders via double-click and breadcrumbs, plus Back/Up.
// 3. Sorting columns via header clicks.
// 4. Searching/filtering entries via Mod+F and clearing via Escape.
// 5. Inspecting & previewing a text entry in the Inspector pane.
// 6. Adding a file to the open archive.
// 7. Deleting an entry via confirmation dialog (Delete key + dialog button).
// 8. Extracting selected & all entries to a fixture folder.
// 9. CLI launch modes (--extract-here and --create).

import {
  app, waitFor, eq, press, type, mod,
  clickEl, dblClickEl, currentDialog, dialogButton, fixtureDir,
} from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const srcDir = fixtureDir({
  'alpha.txt': 'Alpha file contents for preview test',
  'beta.json': '{"hello": "world", "count": 42}',
  'docs/guide.md': '# User Guide\nStep by step instructions.',
  'docs/nested/deep.txt': 'Deep inside docs/nested',
});

const workDir = fixtureDir({
  'added.txt': 'Freshly added file via UI action',
});

const zipPath = path.join(workDir, 'project.zip');

// 1. Create and open archive in UI
app.createArchiveFromPaths(zipPath, [
  path.join(srcDir, 'alpha.txt'),
  path.join(srcDir, 'beta.json'),
  path.join(srcDir, 'docs'),
]);

waitFor(() => app.state.done && app.state.archivePath === zipPath && app.list.items.length === 3,
  'archive created and opened in UI');

const rowNames = () => app.list.items.map((it) => it.name);
eq(rowNames(), ['docs', 'alpha.txt', 'beta.json'], 'folders first, then files sorted by name');

// 2. Select a text entry and verify Inspector metadata + inline text preview
const alphaRow = Array.from(document.querySelectorAll('.vlist-row'))
  .find((el) => el.textContent.includes('alpha.txt'));
assert(alphaRow, 'alpha.txt row rendered');
clickEl(alphaRow);

waitFor(() => app.inspector.currentEntry && app.inspector.currentEntry.name === 'alpha.txt' &&
  app.inspector.previewText.includes('Alpha file contents'),
  'inspector loaded text preview for alpha.txt');

const previewBox = document.querySelector('.inspector-preview-box');
assert(previewBox && previewBox.textContent.includes('Alpha file contents for preview test'),
  'inspector preview box shows decoded UTF-8 text');

// 3. Sort by Size descending by clicking Size column header
const colHeader = (label) => Array.from(document.querySelectorAll('.list-header .col'))
  .find((el) => el.textContent.includes(label));
assert(colHeader('Size'), 'Size column header exists');
clickEl(colHeader('Size')); // ascending
clickEl(colHeader('Size')); // descending
eq(app.state.sort.id, 'size', 'sorted by size column');
eq(app.state.sort.dir, -1, 'sorted descending');

// Restore Name ascending sort
clickEl(colHeader('Name'));
eq(app.state.sort.id, 'name', 'restored name sort');

// 4. Navigate into nested folder 'docs' by double-clicking its row
const docsRow = Array.from(document.querySelectorAll('.vlist-row'))
  .find((el) => el.textContent.includes('docs'));
assert(docsRow, 'docs folder row exists');
dblClickEl(docsRow);

waitFor(() => app.state.currentDir === 'docs' && app.list.items.length === 2,
  'navigated into docs folder');
eq(rowNames(), ['nested', 'guide.md'], 'docs folder contents shown');

// Navigate deeper into 'docs/nested'
const nestedRow = Array.from(document.querySelectorAll('.vlist-row'))
  .find((el) => el.textContent.includes('nested'));
dblClickEl(nestedRow);
waitFor(() => app.state.currentDir === 'docs/nested' && app.list.items.length === 1,
  'navigated into docs/nested');
eq(rowNames(), ['deep.txt'], 'deep.txt shown inside docs/nested');

// Navigate back to root using breadcrumb click
const rootCrumb = document.querySelector('.crumbs .crumb');
assert(rootCrumb, 'root breadcrumb exists');
clickEl(rootCrumb);
waitFor(() => app.state.currentDir === '' && app.list.items.length === 3,
  'breadcrumb navigated back to archive root');

// 5. Filter / search entries using Mod+F
press(`${mod}+f`);
eq(document.activeElement, app.searchInput, 'Mod+F focused search input');
type('guide');
waitFor(() => app.list.items.length === 1 && app.list.items[0].name === 'guide.md',
  'search filtered archive entries to guide.md');

press('escape');
waitFor(() => app.state.searchQuery === '' && app.list.items.length === 3,
  'Escape cleared search and restored root entries');

// 6. Add a file to the open archive
let addedDone = false;
app.addFilesToArchive([path.join(workDir, 'added.txt')]).then(() => { addedDone = true; });
waitFor(() => addedDone && app.list.items.length === 4, 'added.txt added to root of archive');
assert(rowNames().includes('added.txt'), 'added.txt appears in list');

// 7. Delete an entry via confirmation dialog
const betaRow = Array.from(document.querySelectorAll('.vlist-row'))
  .find((el) => el.textContent.includes('beta.json'));
clickEl(betaRow);
press('delete');
waitFor(() => currentDialog() !== null, 'Delete confirmation dialog opened');
dialogButton('Delete');
waitFor(() => currentDialog() === null && app.list.items.length === 3 && !rowNames().includes('beta.json'),
  'beta.json deleted after confirming dialog');

// 8. Extract archive to a fixture destination folder
const extractTarget = path.join(workDir, 'extracted-ui');
let extractDone = false;
app.extractAllTo(extractTarget).then(() => { extractDone = true; });
waitFor(() => extractDone, 'extractAllTo completed');
eq(fs.readFileSync(path.join(extractTarget, 'alpha.txt'), 'utf8'),
  'Alpha file contents for preview test', 'extracted alpha.txt matches');
eq(fs.readFileSync(path.join(extractTarget, 'added.txt'), 'utf8'),
  'Freshly added file via UI action', 'extracted added.txt matches');
eq(fs.readFileSync(path.join(extractTarget, 'docs', 'nested', 'deep.txt'), 'utf8'),
  'Deep inside docs/nested', 'extracted nested file matches');

// 9. CLI launch modes: --create and --extract-here
const cliArchive = path.join(workDir, 'cli-created.tar.gz');
let cliCreateDone = false;
app.handleLaunchArgs({
  argv: ['--create', cliArchive, path.join(srcDir, 'alpha.txt'), path.join(srcDir, 'docs')],
  cwd: workDir,
}).then(() => { cliCreateDone = true; });
waitFor(() => cliCreateDone && app.state.archivePath === cliArchive, '--create built and opened tar.gz archive');
assert(fs.existsSync(cliArchive), 'cli-created.tar.gz exists on disk');

let cliExtractDone = false;
app.handleLaunchArgs({
  argv: ['--extract-here', cliArchive],
  cwd: workDir,
}).then(() => { cliExtractDone = true; });
const expectedExtractHereDir = path.join(workDir, 'cli-created');
waitFor(() => cliExtractDone && fs.existsSync(path.join(expectedExtractHereDir, 'alpha.txt')),
  '--extract-here extracted archive into stem subfolder');

console.log('test_ui PASSED');
