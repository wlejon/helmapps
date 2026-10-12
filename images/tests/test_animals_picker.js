// The picker's suggestions never lie over its buttons: the name field's list
// is in the picker's flow (Combobox inline), so while it shows, Remove and
// Not an animal sit under it and a click on Remove is Remove, not the
// suggestion that used to cover it (seen on a burst of two frames).

import { app, waitFor, eq, type, clickEl, fixtureDir } from '/lib/test.js';
import { stubTable, analysed, photo, JAY, FROG, TABLE, MORE_NAMES, TAXA } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';

const path = require('path');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.nearest !== 'function') {
  skipTest('this bro has no bro.vision.wildlife.nearest');
} else run();

function run() {
// Two frames of one burst, a jay in each.
const dir = fixtureDir({
  'b_01.jpg': photo({ time: 50.0, discs: [{ animal: JAY, at: [120, 90] }] }),
  'b_02.jpg': photo({ time: 50.3, discs: [{ animal: JAY, at: [124, 92] }] }),
});
const W = app.wildlife;
W.useStub(stubTable([...TABLE, FROG]), { taxa: TAXA, names: MORE_NAMES });
app.settings.set('showOutlines', true);   // every outline (off by default)
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 2, 'the folder');
analysed(app, waitFor);
waitFor(() => W.nameIndex() && W.answers.keys.size === 2, 'the names and every photo\'s key');

const at = (n) => path.join(dir, n);
const mine = (n) => W.answers.of(at(n));
const animals = (n) => (mine(n) ? (mine(n).answer.none ? 'none' : mine(n).answer.animals.map((a) => a.name)) : null);
const O = W.outlines;
const act = (label) => Array.from(document.querySelectorAll('.iv-picker-acts button')).find((b) => b.textContent === label);
const rows = () => Array.from(document.querySelectorAll('.combobox-list:not(.hidden) .combobox-item'));
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

app.openImage(at('b_01.jpg'));
shown(app, waitFor, 'b_01.jpg');
advanceTime(16);
waitFor(() => O.state().boxes.length === 1, 'the jay\'s outline');
assert(W.editor.burstOf(at('b_01.jpg')), 'the two frames are a burst');

clickEl(document.querySelector('.iv-outlines .iv-outline'));
waitFor(() => O.state().picker, 'the picker');
const picker = document.querySelector('.iv-picker');
const closedHeight = picker.getBoundingClientRect().height;
eq(rows().length, 0, 'no suggestions before typing');

// Suggestions showing: several rows, in the picker, the buttons under them.
type('a');
waitFor(() => rows().length >= 3, 'suggestions for "a"');
const list = document.querySelector('.combobox-list:not(.hidden)');
assert(picker.contains(list), 'the list is part of the picker');
const lr = list.getBoundingClientRect();
assert(picker.getBoundingClientRect().height > closedHeight + lr.height - 1, 'the picker grew by the list');
for (const label of ['Remove', 'Not an animal']) {
  const br = act(label).getBoundingClientRect();
  assert(!overlaps(br, lr), `${label} is not under the list: ${JSON.stringify([br.top, br.bottom])} vs ${JSON.stringify([lr.top, lr.bottom])}`);
  assert(br.top >= lr.bottom, `${label} below the list`);
}
const pr = picker.getBoundingClientRect();
assert(pr.top >= 0 && pr.bottom <= window.innerHeight, 'the picker is inside the window');

// A real click on Remove (pointer events at its centre): Remove, not a name.
clickEl(act('Remove'));
waitFor(() => !O.state().picker, 'the picker closes');
waitFor(() => animals('b_01.jpg') === 'none', `Remove: no animal here (got ${JSON.stringify(animals('b_01.jpg'))})`);
assert(animals('b_02.jpg') === null || animals('b_02.jpg') === 'none', `no name in the other frame: ${JSON.stringify(animals('b_02.jpg'))}`);
eq(document.querySelectorAll('.combobox-list').length, 0, 'no list left behind');

console.log('test_animals_picker PASSED');
}
