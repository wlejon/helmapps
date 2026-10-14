// Acceptance tests for external file changes and crash recovery autosave:
//  - External write to a clean open file reloads it silently
//  - External write to a dirty open file shows the "Changed on disk" banner
//  - Modifying a document and advancing past the 5s autosave delay writes a
//    recovery file under bro.app.dataDir/recovery/, and checkRecovery() shows
//    the restore offer and restores the unsaved text.

import { app, waitFor, settle, eq, type, clickEl, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

waitFor(() => app.state && app.state.ready, 'app ready');

const dir = fixtureDir({
  'watched.txt': 'initial text\n',
  'recover.txt': 'saved baseline\n',
});

// 1. External write to a clean open file reloads it automatically
const watchedPath = path.join(dir, 'watched.txt');
app.openFile(watchedPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === watchedPath, 'watched.txt opened');
eq(app.activeTextarea().value, 'initial text\n', 'initial content loaded');

fs.writeFileSync(watchedPath, 'updated externally\n', 'utf-8');
// Allow watcher or explicit inspection to settle
app.session.inspectExternalState(app.activeDoc());
waitFor(() => app.activeTextarea().value === 'updated externally\n', 'clean open file reloaded automatically');
eq(app.activeDoc().dirty, false, 'reloaded file remains clean');

// 2. External write to a dirty open file shows the "Changed on disk" banner
const ta = app.activeTextarea();
ta.focus();
ta.setSelectionRange(ta.value.length, ta.value.length);
type('my local edit\n');
eq(app.activeDoc().dirty, true, 'document is now dirty');

fs.writeFileSync(watchedPath, 'conflicting disk write\n', 'utf-8');
app.session.inspectExternalState(app.activeDoc());
waitFor(() => {
  const b = document.querySelector('.te-external-banner');
  return b && !b.classList.contains('hidden');
}, 'external change banner shown for dirty file');

const extBanner = document.querySelector('.te-external-banner');
assert(extBanner.textContent.toLowerCase().includes('changed on disk'), `banner text: ${extBanner.textContent}`);

// Clicking "Keep mine" dismisses banner and preserves local edit
const keepBtn = Array.from(extBanner.querySelectorAll('button')).find((b) => b.textContent === 'Keep mine');
clickEl(keepBtn);
assert(extBanner.classList.contains('hidden'), 'external change banner hidden after Keep mine');
assert(app.activeTextarea().value.includes('my local edit'), 'local edit kept');

// 3. Crash recovery: make a change, advance past the 5s autosave delay,
//    check recovery file exists, then trigger recovery check and restore.
const recPath = path.join(dir, 'recover.txt');
app.openFile(recPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === recPath, 'recover.txt opened');

const recDoc = app.activeDoc();
const recTa = app.activeTextarea();
recTa.focus();
recTa.setSelectionRange(recTa.value.length, recTa.value.length);
type('unsaved crash text\n');
eq(recDoc.dirty, true, 'recover.txt is dirty');

// Advance virtual clock past the 5000ms idle autosave timer
advanceTime(5500);
settle(200);

const recFile = app.session.recoveryFileFor(recDoc);
waitFor(() => fs.existsSync(recFile), 'recovery file written to bro.app.dataDir/recovery/');

// Simulate restarting / checking recovery when the file on disk only has the baseline
const savedPayload = fs.readFileSync(recFile, 'utf-8');
app.closeTab(recDoc.id, { force: true });
waitFor(() => !app.tabs.findByPath(recPath), 'recover.txt closed');

// Re-seed recovery file as if left behind by a crash before close
fs.mkdirSync(path.dirname(recFile), { recursive: true });
fs.writeFileSync(recFile, savedPayload, 'utf-8');

app.checkRecovery();
waitFor(() => {
  const b = document.querySelector('.te-recovery-banner');
  return b && !b.classList.contains('hidden');
}, 'recovery restore banner offered');

const restoreBtn = Array.from(document.querySelectorAll('.te-recovery-banner button'))
  .find((b) => b.textContent === 'Restore');
clickEl(restoreBtn);

waitFor(() => app.activeDoc() && app.activeDoc().path === recPath, 'recovered document restored in tab');
eq(app.activeTextarea().value, 'saved baseline\nunsaved crash text\n', 'recovered text restored');
eq(app.activeDoc().dirty, true, 'restored document marked dirty');

console.log('test_recovery PASSED');
