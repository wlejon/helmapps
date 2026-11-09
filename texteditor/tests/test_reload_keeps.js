// A reload (an edit to the app's source, F5) brings every tab back as it was:
// the files open, an unsaved Untitled tab with its text, a file edited and not
// saved with its edits, the carets and the active tab, and no "recovered from a
// previous session" offer, which is for a crash (app.keep, lib/app.js).

import { waitFor, eq, fixtureDir } from '/lib/test.js';

const path = require('path');

const before = window.app;
waitFor(() => before.state && before.state.ready, 'app ready');

const dir = fixtureDir({ 'a.txt': 'alpha line\n', 'b.txt': 'beta line\n' });
let opened = false;
before.openFiles([path.join(dir, 'a.txt'), path.join(dir, 'b.txt')]).then(() => { opened = true; });
waitFor(() => opened && before.tabs.docs.length === 2, 'both files open');

// b.txt edited, not saved.
const b = before.tabs.findByPath(path.join(dir, 'b.txt'));
before.tabs.activate(b.id);
const ta = before.activeTextarea();
ta.value = 'beta line, edited\n';
ta.dispatchEvent(new Event('input'));
waitFor(() => b.dirty, 'b.txt is dirty');

// An Untitled tab with a draft, its caret inside the text, left active.
const draft = before.newTab({ text: 'a draft nobody saved' });
waitFor(() => before.activeDoc() === draft, 'the draft is active');
const dta = before.activeTextarea();
dta.setSelectionRange(2, 7);
dta.dispatchEvent(new Event('select'));

// The windowed frame loop (runFrames) is where a reload commits; advanceTime
// alone never lets it, since this script runs in the realm being replaced.
location.reload();
for (let i = 0; i < 40 && window.app === before; i++) runFrames(5, { stepMs: 16 });
assert(window.app !== before, 'the page reloaded');
waitFor(() => window.app && window.app !== before && window.app.state && window.app.state.ready,
        'the reloaded page is ready');
const app = window.app;

const docs = app.tabs.docs.map((d) => ({ title: d.title, dirty: !!d.dirty, text: d.text }));
eq(docs, [
  { title: 'a.txt', dirty: false, text: 'alpha line\n' },
  { title: 'b.txt', dirty: true, text: 'beta line, edited\n' },
  { title: draft.title, dirty: true, text: 'a draft nobody saved' },
], 'every tab came back, unsaved text included, in order');
eq(app.activeDoc().title, draft.title, 'the draft is still the active tab');
const t = app.activeTextarea();
eq([t.selectionStart, t.selectionEnd], [2, 7], 'its selection is where it was');
eq(app.session.pendingRecovery.length, 0, 'no recovery offer after a reload');
eq(document.querySelector('.te-recovery-banner').classList.contains('hidden'), true,
   'the recovery banner stays hidden');

console.log('test_reload_keeps PASSED');
