// Find Animals names every animal of a photo and of a burst, at the
// narrowest rank it is sure of, and shows one on request. With the test
// stub (several discs a photo, several animals; their genera and up from
// bro.vision.wildlife.taxaScores, so the names fall back by rank as with
// the models):
//  - a burst whose frames show an egret or two mallards, never both: every
//    frame carries both names, and filtering by either finds all three;
//  - a dragonfly no species of which is sure, its family is: "Darners
//    (Aeshnidae)" on the tile, in the menu and the details;
//  - four sparrows with two classified a photo: "+2 more birds";
//  - hovering an animal in the details darkens the rest of the photo (a
//    soft box at once, then the mask the SAM stub makes, kept for the
//    session), following the zoom, gone when the pointer leaves; a click
//    zooms the view to its boxes.
// Runs the same with the models installed or not.

import { app, waitFor, eq, center, clickEl, menuLabels, chooseMenu, fixtureDir, press } from '/lib/test.js';
import { photo, stubTable, analysed, names, detailAnimals, EGRET, MALLARD, DARNER, SPARROW, TAXA } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';

const path = require('path');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife) skipTest('this bro has no bro.vision.wildlife');
else run();

/** The pointer onto an element (scrolled into view first, as a click would). */
function hover(el) {
  el.scrollIntoView({ block: 'nearest' });
  advanceTime(16);
  mouseMove(...center(el));
  advanceTime(16);
}

function run() {
const dir = fixtureDir({
  'm_01.jpg': photo({ time: 50.0, discs: [{ animal: EGRET, at: [100, 120] }] }),
  'm_02.jpg': photo({ time: 50.1, discs: [{ animal: MALLARD, at: [80, 70] }, { animal: MALLARD, at: [230, 170], r: 18 }] }),
  'm_03.jpg': photo({ time: 50.2, discs: [{ animal: EGRET, at: [160, 120] }] }),
  'n_01.jpg': photo({ time: 60, discs: [{ animal: DARNER, at: [160, 120], r: 30 }] }),
  's_01.jpg': photo({ time: 70, discs: [[60, 60], [260, 60], [60, 180], [260, 180]].map((at, i) => ({ animal: SPARROW, at, r: 24 - 2 * i })) }),
  'x_01.jpg': photo({ time: 80, discs: [{ animal: EGRET, at: [90, 120], r: 26 }, { animal: MALLARD, at: [230, 120] }] }),
});
app.wildlife.useStub(stubTable([EGRET, MALLARD, DARNER, SPARROW]), { taxa: TAXA, maxClassify: 2 });
app.wildlife.isolate.useStub();
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 6, 'the folder');
analysed(app, waitFor);

const a = app.wildlife.analysis;
const rec = (n) => a.record(path.join(dir, n));
eq(rec('m_02.jpg').animals.length, 2, 'both mallards are animals of their photo');
eq(rec('s_01.jpg').animals.length, 2, 'two sparrows classified (maxClassify 2)');
eq(rec('s_01.jpg').animalsDropped, 2, 'two more counted');
const burst = a.burstOf(path.join(dir, 'm_01.jpg'));
eq(burst.count, 3, 'the egret and mallard frames are one burst');

// Every frame of the burst carries both names; the tile shows the top one and "+1".
const item = (n) => app.grid.items.find((it) => it.path.endsWith(n));
for (const n of ['m_01.jpg', 'm_02.jpg', 'm_03.jpg']) {
  eq([item(n).tag, item(n).more, item(n).names], ['Great Egret', 1, 'Great Egret · 95%, Mallard · 90%'], `${n} carries both`);
}
eq([item('x_01.jpg').tag, item('x_01.jpg').more], ['Great Egret', 1], 'a photo with both: both');
eq([item('n_01.jpg').tag, item('n_01.jpg').conf], ['Darners (Aeshnidae)', 95], 'no darner is sure, their family is');
eq([item('s_01.jpg').tag, item('s_01.jpg').more], ['House Sparrow', 0], 'the sparrows are one name');
waitFor(() => document.querySelectorAll('.iv-grid .iv-tag-more').length === 4, 'the tiles\' "+1"');
const cell = (n) => Array.from(document.querySelectorAll('.iv-grid .vgrid-cell')).find((c) => c.title === n);
eq(cell('m_02.jpg').querySelector('.iv-tag-more').textContent, '+1', 'a tile says it has one more');
eq(cell('m_02.jpg').querySelector('.iv-tag-name').textContent, 'Great Egret', 'beside its top name');
eq(cell('n_01.jpg').querySelector('.iv-tag-name').textContent, 'Darners (Aeshnidae)', 'a family on a tile');

// The menu: every taxon by photo count, a photo once per taxon.
const btn = document.querySelector('.iv-animals-filter');
clickEl(btn);
eq(menuLabels().slice(0, 5).join('|'), 'All photos|Great Egret|Mallard|Darners (Aeshnidae)|House Sparrow', 'by photo count');
eq(Array.from(document.querySelectorAll('.menu .menu-count')).map((k) => k.textContent).slice(0, 5).join(), '6,4,4,1,1', 'with counts');
chooseMenu('Mallard');
eq(names(app.grid.items).join(), 'm_01.jpg,m_02.jpg,m_03.jpg,x_01.jpg', 'the mallard filter finds every frame of the burst');
eq(btn.textContent, 'Mallard', 'the button says the filter');
clickEl(btn);
chooseMenu('Great Egret');
eq(names(app.grid.items).join(), 'm_01.jpg,m_02.jpg,m_03.jpg,x_01.jpg', 'the egret filter too');
clickEl(btn);
chooseMenu('Darners (Aeshnidae)');
eq(names(app.grid.items).join(), 'n_01.jpg', 'a family filters like a species');
eq(btn.textContent, 'Darners (Aeshnidae)', 'and names the button');
app.commands.run('animals-filter', '');

// The details: the burst's names on a frame showing only the mallards.
app.openImage(path.join(dir, 'm_02.jpg'));
shown(app, waitFor, 'm_02.jpg');
waitFor(() => app.state.pic && !app.state.pic.placeholder, 'the photo itself');
press('mod+i');
waitFor(() => detailAnimals().length === 3, 'the burst\'s two names and the photo\'s one');
let list = detailAnimals();
eq(list.map((x) => [x.name, x.score, x.meta, x.hit]), [
  ['Great Egret', '95%', 'Ardea alba · 2 of 3 frames · not in this photo', false],
  ['Mallard', '90%', 'Anas platyrhynchos · 1 of 3 frames · 2 here', true],
  ['Mallard', '90%', 'Anas platyrhynchos · 2 here', true],
], 'the burst\'s egret (not here), its mallards (here) and the photo\'s own');

// Hover: everything but the mallards darkens, a soft box at once, then the mask.
const iso = app.wildlife.isolate;
const overlay = document.querySelector('.iv-isolate');
const mallards = list[2];
const before = iso.segments;
hover(mallards.el);
eq(iso.state().boxes.length, 2, 'both mallards are isolated');
assert(!overlay.classList.contains('hidden'), 'the darkening shows at once');
// What is darkened: the stage around the mallards, not the mallards (read from the overlay itself).
const recSize = [rec('m_02.jpg').width, rec('m_02.jpg').height];
const alphaAt = (box) => {
  const M = app.viewer.pictureMatrix();
  const k = app.viewer.pic.width / recSize[0];
  const cx = (box[0] + box[2] / 2) * k, cy = (box[1] + box[3] / 2) * k;
  const dpr = overlay.width / app.viewer.el.clientWidth;
  const x = Math.round((M[0] * cx + M[1] * cy + M[2]) * dpr), y = Math.round((M[3] * cx + M[4] * cy + M[5]) * dpr);
  return overlay.getContext('2d').getImageData(x, y, 1, 1).data[3];
};
const [b1, b2] = iso.state().boxes;
eq([alphaAt(b1), alphaAt(b2)], [0, 0], 'the mallards are clear from the first draw (a soft box, or the mask already)');
waitFor(() => iso.state().phase === 'mask', 'the masks from the boxes', 20000);
eq(iso.segments - before, 2, 'one segmentation a mallard');
eq([alphaAt(b1), alphaAt(b2)], [0, 0], 'the mallards are not darkened');
assert(overlay.getContext('2d').getImageData(2, 2, 1, 1).data[3] > 60, 'the rest is');

// It follows the zoom.
app.viewer.zoomTo(2, { x: 10, y: 10 });
eq(alphaAt(b1), 0, 'zoomed: the first mallard still clear where it is drawn now');
assert(overlay.getContext('2d').getImageData(2, 2, 1, 1).data[3] > 60, 'zoomed: the rest still darkened');
app.viewer.fit();

// The pointer leaves: it goes. Back: the masks come from the session's cache.
hover(document.querySelector('.iv-details-head'));
eq(iso.state().phase, null, 'gone as the pointer leaves');
assert(overlay.classList.contains('hidden'), 'the overlay hides');
hover(mallards.el);
eq(iso.state().phase, 'mask', 'back: the masks at once');
eq(iso.segments - before, 2, 'nothing segmented again');

// A click zooms the view to the mallards' boxes, with a margin.
clickEl(mallards.el);
const v = app.viewer.model();
assert(!v.fit && v.scale > v.fitScale, `zoomed in: ${v.scale} over fit ${v.fitScale}`);
{
  const M = app.viewer.pictureMatrix();
  const k = app.viewer.pic.width / recSize[0];
  const x0 = Math.min(b1[0], b2[0]) * k, x1 = Math.max(b1[0] + b1[2], b2[0] + b2[2]) * k;
  const y0 = Math.min(b1[1], b2[1]) * k, y1 = Math.max(b1[1] + b1[3], b2[1] + b2[3]) * k;
  const sx = (px, py) => [M[0] * px + M[1] * py + M[2], M[3] * px + M[4] * py + M[5]];
  const [l, t] = sx(x0, y0), [r, b] = sx(x1, y1);
  const W = app.viewer.el.clientWidth, H = app.viewer.el.clientHeight;
  assert(l >= 0 && t >= 0 && r <= W && b <= H, `both mallards on the stage: ${[l, t, r, b].map(Math.round)} in ${W}x${H}`);
  assert(r - l > 0.5 * W || b - t > 0.5 * H, `and filling it: ${Math.round(r - l)}x${Math.round(b - t)} of ${W}x${H}`);
}
hover(document.querySelector('.iv-details-head'));
eq(iso.state().phase, null, 'gone again');

// Another photo: an unsure family names its item; the sparrows count the ones not classified.
app.openImage(path.join(dir, 'n_01.jpg'));
shown(app, waitFor, 'n_01.jpg');
waitFor(() => detailAnimals().length === 1 && detailAnimals()[0].name === 'Darners (Aeshnidae)', 'the darner\'s family');
eq([detailAnimals()[0].score, detailAnimals()[0].meta], ['95%', 'Family'], 'its score and rank');
app.openImage(path.join(dir, 's_01.jpg'));
shown(app, waitFor, 's_01.jpg');
waitFor(() => detailAnimals().length === 2, 'the sparrows');
list = detailAnimals();
eq([list[0].name, list[0].meta], ['House Sparrow', 'Passer domesticus · 2 here'], 'the two classified');
eq([list[1].name, list[1].dim, list[1].hit], ['+2 more birds', true, false], 'and the two that were not');

console.log('test_animals_multi PASSED');
}
