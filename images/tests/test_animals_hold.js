// Find Animals never takes away the frames she is working with. A burst with
// no animal in it (the detector missed it, or there is none): she selects
// the subject and the burst's frames, and only then do the answers land, all
// "no animal", which the filter would hide. While Select Subject or
// Stabilize is open nothing in the strip goes, so the selection survives and
// B stabilizes it; once she leaves, the filter applies but keeps the photo
// on screen and the selected frames, and those go as the selection changes.
// The stub stands in for the models (an empty table: no animal anywhere), so
// this runs the same with the models installed or not.

import { app, waitFor, eq, press, clickEl } from '/lib/test.js';
import { burstTree, defaultBurst, useKeyModel, pickSubject, withoutAnimals, base } from '/app/tests/burst.js';
import { stubTable, analysed } from '/app/tests/wildlife.js';
import { fixtureDir } from '/lib/test.js';

const path = require('path');

// Two bursts of four (EXIF times 0.1 s apart, a gap between); Find Animals off until the selection is made.
const frames = defaultBurst(4, 4);
const names = frames.map((f) => f.name);
const dir = fixtureDir(burstTree(frames));
withoutAnimals();
app.openPath(path.join(dir, names[0]));
waitFor(() => app.state.mode === 'image' && app.state.pic && app.state.pic.path.endsWith(names[0]) && !app.state.pic.placeholder,
  `${names[0]} on screen`);
waitFor(() => app.strip.items.length === names.length, 'the strip lists both bursts');

const strip = () => app.strip.items.map((it) => it.name);
const selected = () => app.strip.selectedItems().map((it) => it.name).sort();
const cell = (name) => Array.from(document.querySelectorAll('.iv-strip .vgrid-cell')).find((c) => c.title === name);
const first4 = names.slice(0, 4);

// Select Subject: the subject clicked, its burst (the first four, by EXIF time) selected.
useKeyModel();
pickSubject(frames[0].subject);
waitFor(() => app.strip.selection.size === 4, 'the photo\'s burst is selected');
eq(selected(), first4, 'the first burst');

// The answers land now: no animal in any frame.
app.settings.set('findAnimals', true);
app.wildlife.useStub(stubTable([]));
analysed(app, waitFor, 'every frame analysed');
eq(app.wildlife.counts().empty, names.length, 'no frame has an animal');
eq(strip(), names, 'while Select Subject is open nothing leaves the strip');
eq(selected(), first4, 'and the selection stays');
assert(!app.commands.isEnabled('animals-show-empty') && !app.commands.isEnabled('animals-menu'),
  'the filter cannot be changed while the photos are held');

// B stabilizes the selected frames.
press('b');
waitFor(() => app.burst.active && app.burst.session.ready() && app.burst.view.crop, 'the stabilize view', 60000);
eq(app.burst.session.frames.map((f) => base(f.path)), first4, 'every selected frame is stabilized');

// Leaving: the filter applies, but not to the photo on screen or the frames still selected.
press('escape');
eq(app.state.mode, 'image', 'Escape closes the stabilize view');
waitFor(() => strip().length === 4, 'the frames nobody selected leave the strip');
eq(strip(), first4, 'the selected frames stay');
eq(selected(), first4, 'still selected');
assert(app.commands.isEnabled('animals-show-empty'), 'the filter can be changed again');

// B again: the same frames.
press('b');
waitFor(() => app.burst.active && app.burst.session.ready() && app.burst.view.crop, 'the stabilize view again', 60000);
eq(app.burst.session.frames.length, 4, 'the same four frames');
press('escape');
eq(app.state.mode, 'image', 'closed again');

// The selection changes: a frame left out of it goes; another photo opened, the rest go.
clickEl(cell(names[2]), 'ctrl');
waitFor(() => strip().length === 3, 'the frame left out of the selection goes');
eq(strip(), [names[0], names[1], names[3]], 'the others stay');
clickEl(cell(names[1]));
waitFor(() => app.state.path.endsWith(names[1]), `${names[1]} on screen`);
waitFor(() => strip().length === 1, 'opening a photo lets the rest go');
eq(strip(), [names[1]], 'only the photo on screen stays');

// Show Photos Without Animals brings them all back.
app.commands.run('animals-show-empty');
waitFor(() => strip().length === names.length, 'every frame back');

console.log('test_animals_hold PASSED');
