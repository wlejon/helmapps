// Find Animals on a folder, with the test stub standing in for the models
// (js/wildlife/stub.js finds coloured discs; tests/wildlife.js makes the
// photos): opening the folder analyses it in the background, every frame of
// a burst stays a photo of its own and carries the burst's species, photos
// without animals hide until asked for, the Animals menu filters the grid,
// the strip and Next / Previous with counts, tiles and the details panel
// carry the labels, and Select Subject selects the same bursts.

import { app, waitFor, eq, press, clickEl, menuLabels, chooseMenu, fixtureDir } from '/lib/test.js';
import { shotsTree, stubTable, analysed, names, photo, SQUIRREL, CARDINAL } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';

const path = require('path');

// The stub stands in for the models only; decoding, sharpness and the bursts are bro.vision.wildlife's.
if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife) skipTest('this bro has no bro.vision.wildlife');
else run();

function run() {
const dir = fixtureDir(shotsTree());
app.wildlife.useStub(stubTable());
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 9, 'the folder');
analysed(app, waitFor);

const a = app.wildlife.analysis;
eq(a.analysed, 9, 'every photo went through the analyzer once');
eq(a.bursts.length, 6, 'six bursts: a, b, c (0.5 s apart is one), d, and the two empty shots');
const burstA = a.burstOf(path.join(dir, 'a_01.jpg'));
eq(names(burstA.photos.map((p) => ({ path: p }))).join(), 'a_01.jpg,a_02.jpg,a_03.jpg', 'the cardinal burst');
eq(burstA.species.common, 'Northern Cardinal', 'its consensus');
eq(a.burstOf(path.join(dir, 'c_02.jpg')).photos.length, 2, 'the jays 0.5 s apart are one burst');

// Photos without animals hide; every frame of a burst stays.
const gridNames = () => names(app.grid.items).join();
eq(gridNames(), 'a_01.jpg,a_02.jpg,a_03.jpg,b_01.jpg,c_01.jpg,c_02.jpg,d_01.jpg', 'the empty shots hide, the bursts stay whole');
const item = (n) => app.grid.items.find((it) => it.path.endsWith(n));
eq(item('a_02.jpg').tag, 'Northern Cardinal', 'the frame the bird left carries the burst\'s species');
eq(item('a_01.jpg').burst, 3, 'the burst\'s first frame counts its frames');
eq(item('a_03.jpg').burst, 0, 'the others do not');
assert(document.querySelector('.statusbar').textContent.includes('7 of 9 images'), 'the status bar says how many show');

// Tiles carry the tag.
waitFor(() => document.querySelectorAll('.iv-grid .iv-tag-name').length >= 7, 'the tiles\' tags');
const tile = Array.from(document.querySelectorAll('.iv-grid .vgrid-cell')).find((c) => c.title === 'b_01.jpg');
eq(tile.querySelector('.iv-tag-name').textContent, 'Blue Jay', 'a tile names its species');
eq(tile.querySelector('.iv-tag-conf').textContent, '80%', 'and how sure');

// The Animals menu: All, the species by photo count, the toggle.
const btn = document.querySelector('.iv-animals-filter');
assert(btn && !btn.classList.contains('hidden'), 'the Animals button shows');
clickEl(btn);
const labels = menuLabels();
eq(labels.slice(0, 4).join('|'), 'All photos|Blue Jay|Northern Cardinal|Eastern Gray Squirrel', 'All first, then by photo count');
assert(labels.includes('Show Photos Without Animals'), 'the toggle is in the menu');
const counts = Array.from(document.querySelectorAll('.menu .menu-keys')).map((k) => k.textContent);
eq(counts.slice(0, 4).join(), '7,3,3,1', 'with photo counts');
chooseMenu('Blue Jay');
eq(gridNames(), 'b_01.jpg,c_01.jpg,c_02.jpg', 'the grid shows the jays');
eq(btn.textContent, 'Blue Jay', 'the button says the filter');
assert(document.querySelector('.statusbar').textContent.includes('3 of 9 images'), 'and the status bar');

// The strip and Next / Previous follow the filter.
app.openImage(path.join(dir, 'b_01.jpg'));
shown(app, waitFor, 'b_01.jpg');
eq(names(app.strip.items).join(), 'b_01.jpg,c_01.jpg,c_02.jpg', 'the strip shows the jays');
press('right');
shown(app, waitFor, 'c_01.jpg', 'Next goes to the next jay');
press('right');
press('right');
shown(app, waitFor, 'b_01.jpg', 'and wraps among the jays');
assert(document.querySelector('.statusbar').textContent.includes('1 / 3'), 'the position counts the jays');

// The details panel: the burst's consensus and the frame's own answer.
app.openImage(path.join(dir, 'c_02.jpg'));
shown(app, waitFor, 'c_02.jpg');
press('mod+i');
waitFor(() => /Blue Jay/.test(document.querySelector('.iv-details').textContent), 'the details name the species');
const det = document.querySelector('.iv-details').textContent;
assert(/Burst/.test(det) && /2 over 0\.5 s/.test(det), `the burst's frames and time: ${det}`);
assert(/This photo/.test(det) && /Eastern Bluebird/.test(det), 'the frame\'s own top species');
assert(/bird 0\.50/.test(det), 'what the detector found');
press('mod+i');

// Select Subject selects Find Animals' burst: c_01 + c_02 (0.5 s apart; the EXIF-step rule alone would split them).
app.commands.run('animals-filter', '');
press('s');
waitFor(() => app.strip.selection.size === 2, 'the burst is selected');
eq(names(app.strip.selectedItems()).join(), 'c_01.jpg,c_02.jpg', 'the same burst the grid shows');
press('s');

// Show Photos Without Animals: every photo again.
app.commands.run('animals-show-empty');
eq(names(app.shownItems()).length, 9, 'all nine show');
app.commands.run('animals-show-empty');
eq(names(app.shownItems()).length, 7, 'and hide again');

// A no-animal photo on screen stays on screen; Next steps among the shown ones.
app.openImage(path.join(dir, 'e_01.jpg'));
shown(app, waitFor, 'e_01.jpg', 'a hidden photo still opens');
press('right');
shown(app, waitFor, 'a_01.jpg', 'Next from it goes on (wrapping) among the shown photos');

// Find Animals off: no tags, no filter, every photo.
app.commands.run('find-animals');
eq(app.shownItems(), app.folder.items, 'off: the folder as it is');
assert(btn.classList.contains('hidden'), 'and no Animals button');
app.commands.run('find-animals');
analysed(app, waitFor, 'on again: answered from the cache');
eq(a.analysed, 9, 'nothing analysed again');
eq(app.shownItems().length, 7, 'the filter is back');

// The folder watch: a new photo and one rewritten in place are analysed, nothing else.
if (app.folder.watching) {
  const fs = require('fs');
  fs.writeFileSync(path.join(dir, 'f_01.jpg'), photo({ time: 40, animal: SQUIRREL }));
  fs.writeFileSync(path.join(dir, 'e_02.jpg'), photo({ time: 30, animal: CARDINAL }));
  waitFor(() => a.analysed === 11 && a.state === 'done' && !a.groupTimer, 'the new and the changed photo analysed', 20000);
  eq(app.shownItems().find((it) => it.path.endsWith('f_01.jpg')).tag, 'Eastern Gray Squirrel', 'the new photo is tagged');
  eq(app.shownItems().find((it) => it.path.endsWith('e_02.jpg')).tag, 'Northern Cardinal', 'the rewritten one too, and it shows now');
  eq(app.shownItems().length, 9, 'nine with animals of ten');
} else console.log('no folder watch here (bro.vfs): the watch part is not checked');

console.log('test_animals PASSED');
}
