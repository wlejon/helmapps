// Acceptance tests for TabManager: multi-file launch, single-instance hand-off,
// tab switching, and dirty-close confirmation dialog (Save / Don't Save / Cancel).

import {
  app,
  waitFor,
  settle,
  eq,
  press,
  type,
  currentDialog,
  dialogButton,
  fixtureDir,
} from '/lib/test.js';

const fs = require('fs');
const path = require('path');

waitFor(() => app.state && app.state.ready, 'app ready');

const dir = fixtureDir({
  'one.txt': 'first file\n',
  'two.txt': 'second file\n',
  'three.txt': 'third file\n',
});

const f1 = path.join(dir, 'one.txt');
const f2 = path.join(dir, 'two.txt');
const f3 = path.join(dir, 'three.txt');

// 1. Simulate launch with two files: opens two tabs (replacing initial blank Untitled)
app.triggerLaunch({ argv: [f1, f2], cwd: dir, first: false });
waitFor(() => app.tabs.docs.length === 2, 'two tabs opened from launch args');
eq(app.tabs.docs.map((d) => d.title), ['one.txt', 'two.txt'], 'both files open in tabs');
eq(app.activeDoc().title, 'two.txt', 'last opened file is active');

// 2. Simulate a second single-instance launch adding a third tab to the same window
app.triggerLaunch({ argv: [f3], cwd: dir, first: false });
waitFor(() => app.tabs.docs.length === 3, 'third tab added by second launch');
eq(app.activeDoc().title, 'three.txt', 'newly launched file becomes active');

// 3. Switch tabs with Ctrl+Tab
press('ctrl+tab');
eq(app.activeDoc().title, 'one.txt', 'Ctrl+Tab wraps to first tab');
press('ctrl+tab');
eq(app.activeDoc().title, 'two.txt', 'Ctrl+Tab moves to second tab');

// 4. Modify active tab and close (Mod+W): dialog appears; Cancel keeps tab;
//    Don't Save closes tab and leaves disk unchanged.
const ta = app.activeTextarea();
ta.focus();
ta.setSelectionRange(ta.value.length, ta.value.length);
type('unsaved edit');
eq(app.activeDoc().dirty, true, 'two.txt is dirty');

press('mod+w');
waitFor(() => currentDialog() != null, 'dirty close confirmation dialog appears');
dialogButton('Cancel');
waitFor(() => currentDialog() == null, 'dialog closed after Cancel');
eq(app.tabs.docs.length, 3, 'Cancel keeps the dirty tab open');
eq(app.activeDoc().title, 'two.txt', 'two.txt still active');

press('mod+w');
waitFor(() => currentDialog() != null, 'dirty close dialog appears again');
dialogButton("Don't Save");
waitFor(() => currentDialog() == null && app.tabs.docs.length === 2, "Don't Save closes the tab");
eq(fs.readFileSync(f2, 'utf-8'), 'second file\n', 'file on disk is unchanged after Don\'t Save');

console.log('test_tabs PASSED');
