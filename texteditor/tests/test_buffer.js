// Acceptance tests for DocBuffer: LF & CRLF + UTF-8 BOM preservation,
// dirty state & atomic save, binary/NUL read-only detection, and persisted
// view settings (word wrap & font size).

import { app, waitFor, settle, eq, press, type, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

waitFor(() => app.state && app.state.ready, 'app ready');

const crlfBomBytes = new Uint8Array([
  0xEF, 0xBB, 0xBF,
  ...new TextEncoder().encode('first line\r\nsecond line\r\n'),
]);
const nulBytes = new Uint8Array([104, 105, 0, 97]); // "hi\0a"

const dir = fixtureDir({
  'notes.txt': 'alpha\nbeta\n',
  'win-bom.txt': crlfBomBytes,
  'binary.bin': nulBytes,
});

// 1. Open LF file: tab title, text, LF and UTF-8 in status bar
const lfPath = path.join(dir, 'notes.txt');
app.openFile(lfPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === lfPath, 'LF file opened');

eq(app.activeDoc().title, 'notes.txt', 'LF tab title');
eq(app.activeDoc().eol, 'LF', 'LF detected');
eq(app.activeDoc().bom, false, 'no BOM on LF file');
eq(app.activeTextarea().value, 'alpha\nbeta\n', 'LF textarea content');

const statusText = () => document.querySelector('.statusbar').textContent;
assert(statusText().includes('LF'), `status bar shows LF: ${statusText()}`);
assert(statusText().includes('UTF-8'), `status bar shows UTF-8: ${statusText()}`);

// 2. Open CRLF + UTF-8 BOM file: status bar shows CRLF and UTF-8 BOM
const crlfPath = path.join(dir, 'win-bom.txt');
app.openFile(crlfPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === crlfPath, 'CRLF+BOM file opened');

eq(app.activeDoc().title, 'win-bom.txt', 'CRLF tab title');
eq(app.activeDoc().eol, 'CRLF', 'CRLF detected');
eq(app.activeDoc().bom, true, 'UTF-8 BOM detected');
eq(app.activeTextarea().value, 'first line\nsecond line\n', 'CRLF normalized in textarea');
assert(statusText().includes('CRLF'), `status bar shows CRLF: ${statusText()}`);
assert(statusText().includes('UTF-8 BOM'), `status bar shows UTF-8 BOM: ${statusText()}`);

// 3. Type into the CRLF+BOM file: tab becomes dirty, save preserves CRLF and BOM
const ta = app.activeTextarea();
ta.focus();
ta.setSelectionRange(0, 0);
type('hello ');

eq(app.activeDoc().dirty, true, 'document marked dirty after typing');
assert(document.title.startsWith('• win-bom.txt'), `window title has dirty dot: ${document.title}`);
assert(document.querySelector('.tab.active.dirty') != null, 'active tab has .dirty class');

press('mod+s');
waitFor(() => !app.activeDoc().dirty, 'save completed and cleared dirty flag');

const savedRaw = new Uint8Array(fs.readFileSync(crlfPath));
eq(savedRaw[0], 0xEF, 'BOM byte 0 preserved');
eq(savedRaw[1], 0xBB, 'BOM byte 1 preserved');
eq(savedRaw[2], 0xBF, 'BOM byte 2 preserved');
const savedStr = new TextDecoder('utf-8').decode(savedRaw.subarray(3));
eq(savedStr, 'hello first line\r\nsecond line\r\n', 'CRLF line endings and new text preserved on disk');

// 4. Open a file with a NUL byte: read-only banner shown, typing does not change it
const binPath = path.join(dir, 'binary.bin');
app.openFile(binPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === binPath, 'binary file opened');

eq(app.activeDoc().readOnly, true, 'binary file is readOnly');
eq(app.activeTextarea().readOnly, true, 'textarea is readOnly');
const banner = document.querySelector('.te-banner.readonly');
assert(banner && !banner.classList.contains('hidden'), 'read-only banner is visible');
assert(banner.textContent.includes('Binary or non-UTF-8 file'), `banner text: ${banner.textContent}`);

const beforeVal = app.activeTextarea().value;
app.activeTextarea().focus();
type('should not insert');
settle(50);
eq(app.activeTextarea().value, beforeVal, 'typing into read-only binary file does not change value');
eq(app.activeDoc().dirty, false, 'read-only binary file stays clean');

// 5. Word-wrap (Alt+Z) and font-size (Mod+= / Mod+-) settings persist
const initialWrap = app.settings.get('wordWrap');
press('alt+z');
eq(app.settings.get('wordWrap'), !initialWrap, 'Alt+Z toggles wordWrap setting');
assert(app.activeTextarea().classList.contains(!initialWrap ? 'wrap' : 'nowrap'), 'textarea wrap class updated');

const initialFont = app.settings.get('fontSize');
press('mod+=');
eq(app.settings.get('fontSize'), initialFont + 2, 'Mod+= increases fontSize by 2');
press('mod+-');
eq(app.settings.get('fontSize'), initialFont, 'Mod+- decreases fontSize by 2');

console.log('test_buffer PASSED');
