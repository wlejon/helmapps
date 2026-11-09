// A reload (an edit to the app's source, F5) puts Files back where it was:
// the folder, Back / Forward, the selection, the scroll position and a copy
// waiting to be pasted (app.keep, lib/app.js).

import { waitFor, eq, fixtureDir } from '/lib/test.js';

const path = require('path');

const files = {};
for (let i = 0; i < 300; i++) files[`many/f${String(i).padStart(3, '0')}.txt`] = 'x';
files['other/a.txt'] = 'a';
const dir = fixtureDir(files);
const many = path.join(dir, 'many');
const other = path.join(dir, 'other');

let app = window.app;
waitFor(() => !!app.state, 'app up');
let opened = false;
app.model.openPath(other).then(() => app.model.openPath(many)).then(() => { opened = true; });
waitFor(() => opened && app.state.currentPath === many && app.list.items.length === 300, 'the big folder, after another');
app.views.setViewMode('list', { save: false });
const picks = [path.join(many, 'f200.txt'), path.join(many, 'f201.txt')];
app.list.select(picks, { scroll: true });
advanceTime(16);
const scrolled = app.list.scroller.scrollTop;
assert(scrolled > 0, `scrolled down to the selection (${scrolled})`);
app.state.clipboard = { mode: 'copy', paths: [picks[0]] };

// The windowed frame loop (runFrames) is where a reload commits; advanceTime
// alone never lets it, since this script runs in the realm being replaced.
const before = app;
location.reload();
for (let i = 0; i < 40 && window.app === before; i++) runFrames(5, { stepMs: 16 });
assert(window.app !== before, 'the page reloaded');
app = window.app;

waitFor(() => app.state && app.state.currentPath === many && app.list.items.length === 300 &&
        app.list.selection.size === 2, 'the same folder, its selection back');
eq([...app.list.selection].sort(), picks, 'the same two files selected');
eq(app.state.backStack, [other], 'Back still leads to the folder before');
eq(app.state.clipboard, { mode: 'copy', paths: [picks[0]] }, 'the copy still waits to be pasted');
eq(Math.round(app.list.scroller.scrollTop), Math.round(scrolled), 'scrolled where it was');

console.log('test_reload_keeps PASSED');
