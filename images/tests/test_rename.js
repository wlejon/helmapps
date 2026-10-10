// Acceptance 6: Rename (F2) changes the file on disk and the title follows.
// The new name keeps its place in the folder's order, and the view is kept.

import { app, waitFor, eq, press, answerPrompt, currentDialog, dialogButton, fixtureDir } from '/lib/test.js';
import { png, shown } from '/app/tests/images.js';

const fs = require('fs');
const path = require('path');

const dir = fixtureDir({ 'one.png': png(40, 30), 'two.png': png(30, 40), 'zed.png': png(20, 20) });
app.openPath(path.join(dir, 'two.png'));
shown(app, waitFor, 'two.png');
waitFor(() => app.folder.items.length === 3, 'the folder listed');
press('r');                                    // a rotated view survives the rename

press('f2');
waitFor(() => currentDialog(), 'the rename prompt');
const field = currentDialog().body.querySelector('input');
eq(field.value, 'two.png', 'the prompt starts from the current name');
answerPrompt('alpha.png');
waitFor(() => fs.existsSync(path.join(dir, 'alpha.png')), 'the file renamed on disk');
assert(!fs.existsSync(path.join(dir, 'two.png')), 'the old name is gone');
waitFor(() => document.title === 'alpha.png — Image Viewer', 'the title follows');
eq(app.viewer.model().rotation, 90, 'the view is kept');
waitFor(() => app.folder.items[0] && app.folder.items[0].name === 'alpha.png', 'the folder re-sorted');
eq(app.folder.items.map((it) => it.name), ['alpha.png', 'one.png', 'zed.png'], 'the new name in name order');
assert(document.querySelector('.statusbar').textContent.includes('1 / 3'), 'the position follows');

// A name that is taken is refused, and nothing moves.
press('f2');
waitFor(() => currentDialog(), 'the rename prompt again');
answerPrompt('zed.png');
waitFor(() => currentDialog() && /already exists/.test(currentDialog().el.textContent), 'told the name is taken');
dialogButton('OK');
assert(fs.existsSync(path.join(dir, 'alpha.png')) && fs.existsSync(path.join(dir, 'zed.png')), 'both files still there');

// Cancel changes nothing.
press('f2');
waitFor(() => currentDialog(), 'the rename prompt a third time');
dialogButton('Cancel');
assert(fs.existsSync(path.join(dir, 'alpha.png')), 'Cancel keeps the name');

console.log('test_rename PASSED');
