// Acceptance tests for Find & Replace and Go to Line:
//  - 3 matches counted, Next moves selectionStart to each match in turn
//  - Replace All replaces all matches and saves expected text to disk
//  - Regex find with capture-group replace ((\w+)@ -> $1 at )
//  - Go to Line (Mod+G) moves selectionStart to target line

import {
  app,
  waitFor,
  eq,
  press,
  type,
  clickEl,
  currentDialog,
  answerPrompt,
  fixtureDir,
} from '/lib/test.js';

const fs = require('fs');
const path = require('path');

waitFor(() => app.state && app.state.ready, 'app ready');

const dir = fixtureDir({
  'fruits.txt': 'apple one\napple two\napple three\n',
  'contacts.txt': 'Contact alice@example.com or bob@work.org today.\n',
});

// 1. Open file with 3 matches and run Find (Mod+F)
const fruitsPath = path.join(dir, 'fruits.txt');
app.openFile(fruitsPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === fruitsPath, 'fruits.txt opened');

press('mod+f');
waitFor(() => app.findBar.visible, 'Find bar opened');
type('apple');

waitFor(() => app.findBar.matches.length === 3, 'three matches counted');
eq(app.findBar.countEl.textContent, '1 of 3', 'match counter displays 1 of 3');
eq(app.activeTextarea().selectionStart, 0, 'first match selected at index 0');

// 2. Next moves selectionStart to each match in turn
press('enter');
eq(app.activeTextarea().selectionStart, 10, 'second match selected at index 10');
eq(app.findBar.countEl.textContent, '2 of 3', 'match counter displays 2 of 3');

press('enter');
eq(app.activeTextarea().selectionStart, 20, 'third match selected at index 20');
eq(app.findBar.countEl.textContent, '3 of 3', 'match counter displays 3 of 3');

press('enter');
eq(app.activeTextarea().selectionStart, 0, 'Next wraps back to first match at index 0');

// 3. Open Replace (Mod+H), Replace All, and save to disk
press('mod+h');
waitFor(() => app.findBar.replaceMode, 'Replace row shown');
app.findBar.replaceInput.focus();
type('pear');
clickEl(app.findBar.replaceAllBtn);

eq(app.activeTextarea().value, 'pear one\npear two\npear three\n', 'Replace All updated buffer text');
eq(app.activeDoc().dirty, true, 'buffer marked dirty after Replace All');

press('escape');
eq(app.findBar.visible, false, 'Escape closes Find bar');

press('mod+s');
waitFor(() => !app.activeDoc().dirty, 'saved after Replace All');
eq(fs.readFileSync(fruitsPath, 'utf-8'), 'pear one\npear two\npear three\n', 'saved file has replaced text');

// 4. Regex find with capture-group replace: (\w+)@ -> $1 at 
const contactsPath = path.join(dir, 'contacts.txt');
app.openFile(contactsPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === contactsPath, 'contacts.txt opened');

app.findBar.open({ replace: true });
app.findBar.setQuery('(\\w+)@', { replaceWith: '$1 at ', regex: true });
eq(app.findBar.matches.length, 2, 'two regex matches found');
app.findBar.replaceAll();
eq(
  app.activeTextarea().value,
  'Contact alice at example.com or bob at work.org today.\n',
  'capture-group replacement ($1 at ) produced expected text',
);

// 5. Go to Line (Mod+G)
app.openFile(fruitsPath);
waitFor(() => app.activeDoc() && app.activeDoc().path === fruitsPath, 'switched back to fruits.txt');
press('mod+g');
waitFor(() => currentDialog() != null, 'Go to Line prompt opened');
answerPrompt('3');
waitFor(() => currentDialog() == null, 'Go to Line prompt closed');
eq(app.activeTextarea().selectionStart, 18, 'caret moved to start of line 3');
eq(app.activeDoc().caret.line, 3, 'status caret reports line 3');

console.log('test_find PASSED');
