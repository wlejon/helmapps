// UI regression tests for Text Editor (helm.texteditor):
//  1. Zooming / changing fontSize updates entry.lineHeightPx and keeps virtualized
//     syncGutter firstLine & translateY offset calculations synchronized.
//  2. Editing the buffer or reloading from disk while FindBar is open recomputes
//     match offsets and count, and replaceAll() keeps doc.text / lineCount in sync.
//  3. Clicking "Keep mine" on a deleted-on-disk file clears doc.deletedOnDisk,
//     marks the document dirty, and hides #external-banner.

import {
  app,
  waitFor,
  eq,
  press,
  clickEl,
  fixtureDir,
} from '/lib/test.js';

const fs = require('fs');
const path = require('path');

waitFor(() => app.state && app.state.ready, 'app ready');

const manyLines = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} content`).join('\n');
const dir = fixtureDir({
  'long.txt': manyLines,
  'search_edit.txt': 'alpha token\nbeta token\n',
  'ephemeral.txt': 'keep this buffer\n',
});

// 1. Gutter line-height synchronization on zoom / fontSize change
const longPath = path.join(dir, 'long.txt');
app.openFile(longPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === longPath, 'long.txt opened');

const entry = app.editorView.activeEntry();
eq(entry.lineHeightPx, Math.round(14 * 1.55), 'initial lineHeightPx is 22 for 14px font');

// Zoom in to 24px -> lineHeightPx = Math.round(24 * 1.55) = 37
app.settings.set('fontSize', 24);
eq(entry.lineHeightPx, 37, 'changing fontSize to 24 updates entry.lineHeightPx to 37');
eq(entry.textarea.style.lineHeight, '37px', 'textarea lineHeight is 37px');
eq(entry.gutter.style.lineHeight, '37px', 'gutter lineHeight is 37px');

// Simulate scrolling to 370px (10 lines at 37px/line -> firstLine = max(1, 10 - 5) = 5)
entry.textarea.scrollTop = 370;
app.editorView.syncGutter(entry);
const firstRenderedLine = Number(entry.gutterInner.textContent.split('\n')[0]);
eq(firstRenderedLine, 5, 'syncGutter uses updated 37px lineHeightPx to compute firstLine=5');
eq(entry.gutterInner.style.transform, `translateY(${(5 - 1) * 37 - 370}px)`, 'gutterInner translateY matches 37px lineHeight');

// Reset zoom with Mod+0
press('mod+0');
eq(entry.lineHeightPx, 22, 'Mod+0 resets entry.lineHeightPx to 22');

// 2. FindBar recomputes match offsets on document edit and disk reload
const searchPath = path.join(dir, 'search_edit.txt');
app.openFile(searchPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === searchPath, 'search_edit.txt opened');

app.findBar.open({ replace: true });
app.findBar.setQuery('token', { replaceWith: 'item' });
eq(app.findBar.matches.length, 2, '2 initial matches for token');
eq(app.findBar.matches[0].start, 6, 'first match at offset 6');
eq(app.findBar.matches[1].start, 17, 'second match at offset 17');

// Edit the document in the textarea while FindBar is open (insert prefix + third token)
const ta = app.activeTextarea();
ta.value = 'PREFIX token\nalpha token\nbeta token\n';
ta.dispatchEvent(new Event('input', { bubbles: true }));

eq(app.findBar.matches.length, 3, 'FindBar recomputed matches after textarea input');
eq(app.findBar.matches[0].start, 7, 'first match updated to offset 7');
eq(app.findBar.matches[1].start, 19, 'second match shifted to offset 19');
eq(app.findBar.matches[2].start, 30, 'third match shifted to offset 30');
eq(app.findBar.countEl.textContent, '1 of 3', 'FindBar counter updated to 1 of 3');

// Modify file on disk and reloadActiveFromDisk while FindBar is open
fs.writeFileSync(searchPath, 'only one token here\n', 'utf-8');
app.reloadActiveFromDisk();
waitFor(() => app.activeDoc().text === 'only one token here\n', 'reloaded from disk');
eq(app.findBar.matches.length, 1, 'FindBar recomputed matches after reloadActiveFromDisk');
eq(app.findBar.matches[0].start, 9, 'reloaded match offset is 9');
eq(app.findBar.countEl.textContent, '1 of 1', 'FindBar counter updated to 1 of 1');

// Replace All updates doc.text, doc.lineCount, and doc.dirty synchronously
app.findBar.setQuery('token', { replaceWith: 'line1\nline2' });
app.findBar.replaceAll();
eq(app.activeDoc().text, 'only one line1\nline2 here\n', 'replaceAll updated doc.text synchronously');
eq(app.activeDoc().lineCount, 3, 'replaceAll updated doc.lineCount synchronously');
eq(app.activeDoc().dirty, true, 'replaceAll marked doc dirty');
app.findBar.close();

// 3. "Keep mine" dismisses #external-banner when file was deleted on disk
const ephPath = path.join(dir, 'ephemeral.txt');
app.openFile(ephPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === ephPath, 'ephemeral.txt opened');

fs.unlinkSync(ephPath);
const extBanner = document.querySelector('#external-banner');
waitFor(() => app.activeDoc().deletedOnDisk && extBanner && !extBanner.classList.contains('hidden'),
  'deleting watched file on disk shows #external-banner');

const keepMineBtn = Array.from(extBanner.querySelectorAll('button')).find((b) => b.textContent === 'Keep mine');
assert(keepMineBtn, 'Keep mine button present in #external-banner');
clickEl(keepMineBtn);

eq(app.activeDoc().deletedOnDisk, false, 'Keep mine cleared doc.deletedOnDisk');
eq(app.activeDoc().externalChanged, false, 'Keep mine cleared doc.externalChanged');
eq(app.activeDoc().dirty, true, 'Keep mine marked doc dirty');
assert(extBanner.classList.contains('hidden'), '#external-banner hidden after clicking Keep mine');

console.log('test_ui PASSED');
