// Find Animals on a folder, with the test stub standing in for the models
// (js/wildlife/stub.js finds coloured discs; tests/wildlife.js makes the
// photos): opening the folder analyses it in the background, every frame of
// a burst stays a photo of its own and carries the burst's species, photos
// without animals hide until asked for, the Animals menu filters the grid,
// the strip and Next / Previous with counts, tiles and the details panel
// carry the labels, and Select Subject selects the same bursts. A frog the
// stub is not sure of at any rank (0.5 and 0.3, under the 0.85 label
// threshold) has no tag, reads "Not identified" with its guesses in the
// details and is counted and filtered as Uncertain, its best guess on its tile there.

import { app, waitFor, eq, press, clickEl, menuLabels, chooseMenu, fixtureDir } from '/lib/test.js';
import { shotsTree, stubTable, analysed, names, photo, detailAnimals, SQUIRREL, CARDINAL, FROG, TABLE } from '/app/tests/wildlife.js';
import { UNIDENTIFIED } from '/app/js/wildlife/feature.js';
import { shown } from '/app/tests/images.js';

const path = require('path');

// The stub stands in for the models only; decoding, sharpness and the bursts are bro.vision.wildlife's.
if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife) skipTest('this bro has no bro.vision.wildlife');
else run();

function run() {
// u_01: the frog, alone at 25 s.
const dir = fixtureDir({ ...shotsTree(), 'u_01.jpg': photo({ time: 25, animal: FROG }) });
app.wildlife.useStub(stubTable([...TABLE, FROG]));
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 10, 'the folder');
analysed(app, waitFor);

const a = app.wildlife.analysis;
eq(a.analysed, 10, 'every photo went through the analyzer once');
eq(a.bursts.length, 7, 'seven bursts: a, b, c (0.5 s apart is one), d, the frog, and the two empty shots');
const burstA = a.burstOf(path.join(dir, 'a_01.jpg'));
eq(names(burstA.photos.map((p) => ({ path: p }))).join(), 'a_01.jpg,a_02.jpg,a_03.jpg', 'the cardinal burst');
eq(burstA.species.common, 'Northern Cardinal', 'its consensus');
eq(a.burstOf(path.join(dir, 'c_02.jpg')).photos.length, 2, 'the jays 0.5 s apart are one burst');

// Photos without animals hide; every frame of a burst stays.
const gridNames = () => names(app.grid.items).join();
eq(gridNames(), 'a_01.jpg,a_02.jpg,a_03.jpg,b_01.jpg,c_01.jpg,c_02.jpg,d_01.jpg,u_01.jpg',
  'the empty shots hide, the bursts stay whole, the unidentified frog shows');
const item = (n) => app.grid.items.find((it) => it.path.endsWith(n));
eq(item('a_02.jpg').tag, 'Northern Cardinal', 'the frame the bird left carries the burst\'s species');
eq(item('a_01.jpg').burst, 3, 'the burst\'s first frame counts its frames');
eq(item('a_03.jpg').burst, 0, 'the others do not');
eq([item('u_01.jpg').tag, item('u_01.jpg').conf], ['', 0], 'a species under 85% is no tag');
eq(item('b_01.jpg').more, 0, 'one name, nothing more');
assert(document.querySelector('.statusbar').textContent.includes('8 of 10 images'), 'the status bar says how many show');

// Tiles carry the tag.
waitFor(() => document.querySelectorAll('.iv-grid .iv-tag-name').length >= 7, 'the tiles\' tags');
const cell = (n) => Array.from(document.querySelectorAll('.iv-grid .vgrid-cell')).find((c) => c.title === n);
const tile = cell('b_01.jpg');
eq(tile.querySelector('.iv-tag-name').textContent, 'Blue Jay', 'a tile names its species');
eq(tile.querySelector('.iv-tag-conf').textContent, '92%', 'and how sure');
assert(!tile.querySelector('.iv-tag-more'), 'no "+N" for one name');
const frogTile = cell('u_01.jpg');
assert(frogTile && (!frogTile.querySelector('.iv-tags') || frogTile.querySelector('.iv-tags').classList.contains('hidden')),
  'the unidentified frog\'s tile has no tag');

// The Animals menu: All, the species by photo count, Uncertain, the toggle.
const btn = document.querySelector('.iv-animals-filter');
assert(btn && !btn.classList.contains('hidden'), 'the Animals button shows');
clickEl(btn);
const labels = menuLabels();
eq(labels.slice(0, 5).join('|'), 'All photos|Blue Jay|Northern Cardinal|Eastern Gray Squirrel|Uncertain',
  'All first, then the named species by photo count, then the uncertain');
assert(!labels.includes('Green Frog'), 'a species under 85% is not in the menu');
assert(labels.includes('Show Photos Without Animals'), 'the toggle is in the menu');
const counts = Array.from(document.querySelectorAll('.menu .menu-count')).map((k) => k.textContent);
eq(counts.slice(0, 5).join(), '8,3,3,1,1', 'with photo counts');
chooseMenu('Uncertain');
eq(gridNames(), 'u_01.jpg', 'Uncertain filters like a species');
eq(btn.textContent, 'Uncertain', 'the button says so');
eq(cell('u_01.jpg').querySelector('.iv-tag.guess .iv-tag-name').textContent, 'Green Frog?', 'its best guess as a suggestion');
clickEl(btn);
chooseMenu('Blue Jay');
eq(gridNames(), 'b_01.jpg,c_01.jpg,c_02.jpg', 'the grid shows the jays');
eq(btn.textContent, 'Blue Jay', 'the button says the filter');
assert(document.querySelector('.statusbar').textContent.includes('3 of 10 images'), 'and the status bar');

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

// The details panel: the burst's names and the frame's own.
app.openImage(path.join(dir, 'c_02.jpg'));
shown(app, waitFor, 'c_02.jpg');
press('mod+i');
waitFor(() => detailAnimals().length === 2, 'the details list the burst\'s jay and the photo\'s');
const det = document.querySelector('.iv-details').textContent;
assert(/Burst/.test(det) && /2 over 0\.5 s/.test(det), `the burst's frames and time: ${det}`);
const [inBurst, inPhoto] = detailAnimals();
eq([inBurst.name, inBurst.score, inBurst.meta], ['Blue Jay', '92%', 'Cyanocitta cristata · 2 of 2 frames'], 'the burst\'s jay');
eq([inPhoto.name, inPhoto.score, inPhoto.meta], ['Blue Jay', '92%', 'Cyanocitta cristata'], 'this photo\'s jay');
assert(inBurst.hit && inPhoto.hit, 'both are in this photo: they isolate and zoom');
assert(/This photo/.test(det) && /bird 0\.50/.test(det), 'what the detector found');
assert(!/Not identified/.test(det), 'named at 92%');
press('mod+i');

// Not sure at any rank: "Not identified", the guesses muted under it.
app.commands.run('animals-filter', UNIDENTIFIED);
app.openImage(path.join(dir, 'u_01.jpg'));
shown(app, waitFor, 'u_01.jpg');
press('mod+i');
waitFor(() => /Not identified/.test(document.querySelector('.iv-details').textContent), 'the details say it is not identified');
const frog = detailAnimals();
eq(frog.length, 1, 'one animal, a burst of one has no burst section');
eq([frog[0].name, frog[0].score, frog[0].meta], ['Not identified', '', 'frog'], 'no name, what the detector called it');
// Of the frog box's classes, renormalised there (0.5 and 0.3 of 0.8).
eq(frog[0].guess, 'Possibly Green Frog 63%, American Toad 38%', 'the guesses');
assert(frog[0].hit, 'it isolates like a named one');
assert(!/Lithobates clamitans/.test(document.querySelector('.iv-details').textContent), 'no scientific name for a guess');
press('mod+i');
app.commands.run('animals-filter', '');
app.openImage(path.join(dir, 'c_02.jpg'));
shown(app, waitFor, 'c_02.jpg');

// Select Subject selects Find Animals' burst: c_01 + c_02 (0.5 s apart; the EXIF-step rule alone would split them).
app.commands.run('animals-filter', '');
press('s');
waitFor(() => app.strip.selection.size === 2, 'the burst is selected');
eq(names(app.strip.selectedItems()).join(), 'c_01.jpg,c_02.jpg', 'the same burst the grid shows');
press('s');

// Show Photos Without Animals: every photo again.
app.commands.run('animals-show-empty');
eq(names(app.shownItems()).length, 10, 'all ten show');
app.commands.run('animals-show-empty');
eq(names(app.shownItems()).length, 8, 'and hide again');

// A no-animal photo on screen stays on screen; Next steps among the shown ones.
app.openImage(path.join(dir, 'e_01.jpg'));
shown(app, waitFor, 'e_01.jpg', 'a hidden photo still opens');
press('right');
shown(app, waitFor, 'u_01.jpg', 'Next from it goes on among the shown photos (the unidentified frog shows)');
press('right');
shown(app, waitFor, 'a_01.jpg', 'and wraps');

// Find Animals off: no tags, no filter, every photo.
app.commands.run('find-animals');
eq(app.shownItems(), app.folder.items, 'off: the folder as it is');
assert(btn.classList.contains('hidden'), 'and no Animals button');
app.commands.run('find-animals');
analysed(app, waitFor, 'on again: answered from the cache');
eq(a.analysed, 10, 'nothing analysed again');
eq(app.shownItems().length, 8, 'the filter is back');

// The folder watch: a new photo and one rewritten in place are analysed, nothing else.
if (app.folder.watching) {
  const fs = require('fs');
  fs.writeFileSync(path.join(dir, 'f_01.jpg'), photo({ time: 40, animal: SQUIRREL }));
  fs.writeFileSync(path.join(dir, 'e_02.jpg'), photo({ time: 30, animal: CARDINAL }));
  waitFor(() => a.analysed === 12 && a.state === 'done' && !a.groupTimer, 'the new and the changed photo analysed', 20000);
  eq(app.shownItems().find((it) => it.path.endsWith('f_01.jpg')).tag, 'Eastern Gray Squirrel', 'the new photo is tagged');
  eq(app.shownItems().find((it) => it.path.endsWith('e_02.jpg')).tag, 'Northern Cardinal', 'the rewritten one too, and it shows now');
  eq(app.shownItems().length, 10, 'ten with animals of eleven');
} else console.log('no folder watch here (bro.vfs): the watch part is not checked');

console.log('test_animals PASSED');
}
