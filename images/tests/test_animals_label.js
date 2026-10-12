// Labelling on the photo (stub models): every animal the identifier
// classified is an outline over the photo that follows zoom and pan; a click
// opens a picker (the identifier's guesses as chips, "looks like your ..."
// once she has named a crop like it, a field over every name, Remove, Not an
// animal). Uncertain holds every photo with a crop no name covers (or an
// animal and no name), its best guess on the tile, until she answers it. In a
// burst, Whole burst is the same animal in the other frames, matched by box
// overlap; a frame where it is not is left be; Shift is this photo only. What
// the detector found is counted at a glance ("1 bird, 1 frog").

import { app, waitFor, eq, press, type, clickEl, menuLabels, chooseMenu, fixtureDir } from '/lib/test.js';
import { stubTable, analysed, photo, JAY, CARDINAL, FROG, TABLE, MORE_NAMES, TAXA } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';
import { UNCERTAIN, LOOKALIKE_MIN } from '/app/js/wildlife/feature.js';
import { stubEmbedding } from '/app/js/wildlife/stub.js';
import { iou } from '/app/js/wildlife/crops.js';

const path = require('path');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.nearest !== 'function') {
  skipTest('this bro has no bro.vision.wildlife.nearest');
} else run();

function run() {
// A jay and a frog in a burst; in its third frame the jay is elsewhere and the frog gone.
const dir = fixtureDir({
  'k_01.jpg': photo({ time: 40.0, discs: [{ animal: JAY, at: [80, 120] }, { animal: FROG, at: [240, 60] }] }),
  'k_02.jpg': photo({ time: 40.3, discs: [{ animal: JAY, at: [88, 122] }, { animal: FROG, at: [242, 62] }] }),
  'k_03.jpg': photo({ time: 40.6, discs: [{ animal: JAY, at: [250, 170] }] }),
  'j_01.jpg': photo({ time: 60, animal: JAY }),
  'r_01.jpg': photo({ time: 80, animal: CARDINAL }),
  'u_01.jpg': photo({ time: 100, animal: FROG }),
});
const W = app.wildlife;
W.useStub(stubTable([...TABLE, FROG]), { taxa: TAXA, names: MORE_NAMES });
// Every outline shown (off by default: test_animals_outlines).
app.settings.set('showOutlines', true);
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 6, 'the folder');
analysed(app, waitFor);
waitFor(() => W.nameIndex() && W.answers.keys.size === 6, 'the names and every photo\'s key');
waitFor(() => W.analysis.embeddings.size === 6, 'every photo\'s crop embeddings');

const at = (n) => path.join(dir, n);
const mine = (n) => W.answers.of(at(n));
const animals = (n) => (mine(n) ? (mine(n).answer.none ? 'none' : mine(n).answer.animals.map((a) => a.name)) : null);
const gridNames = () => app.grid.items.map((it) => path.basename(it.path)).join();
const item = (n) => app.grid.items.find((it) => it.path === at(n));
const open = (n) => { app.openImage(at(n)); shown(app, waitFor, n); advanceTime(16); };
const O = W.outlines;
const outline = (kind) => document.querySelector(`.iv-outlines .iv-outline.${kind}`);
const named = (name) => Array.from(document.querySelectorAll('.iv-outlines .iv-outline')).find((el) => el.title === name);
const chips = () => O.state().picker.chips.map((c) => `${c.kind}:${c.text} ${c.detail}`);
const chipEl = (kind) => document.querySelector(`.iv-picker .iv-chip.${kind}`);
const btn = document.querySelector('.iv-animals-filter');
const menuCount = (label) => {
  const row = Array.from(document.querySelectorAll('.menu .menu-item')).find((r) => r.querySelector('.menu-text').textContent === label);
  return row && row.querySelector('.menu-count') ? row.querySelector('.menu-count').textContent : null;
};

// The stub's embeddings: a colour's own, unit; a jay and a cardinal far apart.
const e = (c) => stubEmbedding(c.color);
assert(Math.abs(Math.hypot(...e(JAY)) - 1) < 1e-6, 'stub embeddings are unit');
assert(bro.vision.wildlife.nearest(e(JAY), [e(CARDINAL)], 1, { minSimilarity: LOOKALIKE_MIN }).length === 0, 'a cardinal is not like a jay');

// ---- Uncertain: a crop no name covers --------------------------------------------------
clickEl(btn);
eq(menuCount('Uncertain'), '3', 'the burst\'s frog frames and the lone frog');
chooseMenu('Uncertain');
eq(gridNames(), 'k_01.jpg,k_02.jpg,u_01.jpg', 'a named jay beside an unsure frog is uncertain too; k_03 (the jay alone) is not');
eq(item('k_01.jpg').tag, 'Green Frog?', 'its best guess as a suggestion');
// Its suggestions are of the frog box's classes, renormalised there (0.5 / 0.8).
assert(item('k_01.jpg').guess && /Uncertain: Green Frog\? 63%/.test(item('k_01.jpg').names), `its tooltip: ${item('k_01.jpg').names}`);
eq(item('k_01.jpg').found, '1 bird, 1 frog', 'what the detector found, at a glance');
if (process.env.IV_SHOTS) { advanceTime(500); screenshot(path.join(process.env.IV_SHOTS, 'grid-uncertain.png')); }
clickEl(btn);
chooseMenu('All photos');

// ---- the outlines on the photo, following the zoom -------------------------------------
open('j_01.jpg');
waitFor(() => O.state().boxes.length === 1, 'an outline on the photo');
eq(O.state().boxes, [{ i: 0, kind: 'sure', name: 'Blue Jay' }], 'the identifier\'s sure name');
const rec = W.analysis.record(at('j_01.jpg'));
const placed = (el, box) => {
  const M = app.viewer.pictureMatrix();
  const k = app.viewer.pic.width / rec.width;
  const x = M[0] * box[0] * k + M[1] * box[1] * k + M[2], y = M[3] * box[0] * k + M[4] * box[1] * k + M[5];
  return Math.abs(parseFloat(el.style.left) - x) < 1 && Math.abs(parseFloat(el.style.top) - y) < 1 &&
    Math.abs(parseFloat(el.style.width) - box[2] * k * M[0]) < 1;
};
assert(placed(outline('sure'), rec.animals[0].box), 'over its box');
app.viewer.zoomTo(2, { x: 10, y: 10 });
advanceTime(16);
assert(placed(outline('sure'), rec.animals[0].box), 'over its box zoomed in');
app.viewer.fit();
advanceTime(16);
press('mod+i');
waitFor(() => document.querySelector('.iv-details .iv-animals-found'), 'the details count at a glance');
eq(document.querySelector('.iv-details .iv-animals-found').textContent, 'Found 1 bird', 'in the details');
press('mod+i');

// A click on it: the picker. Nothing of hers yet, so no "looks like".
clickEl(outline('sure'));
waitFor(() => O.state().picker, 'the picker');
eq(chips(), ['sure:Blue Jay sure', 'guess:Eastern Bluebird 5.1%'], 'the sure name, then its other guesses');
assert(document.activeElement === document.querySelector('.iv-picker .combobox-input'), 'the field has the focus');
press('escape');
waitFor(() => !O.state().picker, 'Escape closes it');
eq(mine('j_01.jpg'), null, 'nothing saved');

// ---- naming an uncertain animal for the burst: the same animal, by overlap -------------
open('k_01.jpg');
waitFor(() => O.state().boxes.length === 2, 'two outlines');
eq(O.state().boxes.map((b) => `${b.kind}:${b.name}`).sort(), ['sure:Blue Jay', 'uncertain:Green Frog?'], 'the jay sure, the frog uncertain');
clickEl(outline('uncertain'));
waitFor(() => O.state().picker, 'the frog\'s picker');
eq(chips(), ['here:Blue Jay in this photo', 'guess:Green Frog 63%', 'guess:American Toad 38%'],
  'the name already in the photo, then its top guesses');
eq(document.querySelector('.iv-picker .iv-answer-hint').textContent, 'Enter: this photo · Shift+Enter: same animal, whole burst (3)',
  'this photo or the same animal in the burst');
type('leopard frog');
// IV_SHOTS=<dir>: pictures of the flow for a person to look at (never in the repo).
const shot = (name) => { if (process.env.IV_SHOTS) { advanceTime(32); screenshot(path.join(process.env.IV_SHOTS, name)); } };
shot('picker-uncertain-frog.png');
press('shift+enter');
waitFor(() => mine('k_01.jpg') && mine('k_02.jpg'), 'the frog named in both frames it is in');
eq([animals('k_01.jpg'), animals('k_02.jpg'), mine('k_03.jpg')], [['Blue Jay', 'leopard frog'], ['Blue Jay', 'leopard frog'], null],
  'her words on the frog of each frame, the jay kept; the frame without the frog left be');
const boxOf = (n, name) => mine(n).answer.animals.find((a) => a.name === name).boxes[0];
assert(iou(boxOf('k_01.jpg', 'leopard frog'), boxOf('k_02.jpg', 'leopard frog')) > 0.5 &&
  JSON.stringify(boxOf('k_01.jpg', 'leopard frog')) !== JSON.stringify(boxOf('k_02.jpg', 'leopard frog')), 'each on its own frame\'s box');
eq(app.settings.get('answerScope'), 'burst', 'the choice remembered');
waitFor(() => O.state().boxes.map((b) => b.kind).join() === 'mine,mine', 'both outlines hers now');

// The same animal across frames only: the jay in k_03 is elsewhere.
open('k_02.jpg');
waitFor(() => O.state().boxes.length === 2, 'k_02\'s outlines');
clickEl(named('Blue Jay'));
waitFor(() => O.state().picker, 'the jay\'s picker');
eq(chips().slice(0, 3), ['here:leopard frog in this photo', 'guess:Blue Jay 95%', 'guess:Eastern Bluebird 5.1%'],
  'hers already: no sure chip; her other name in the photo, the guesses');
clickEl(document.querySelectorAll('.iv-picker .iv-chip.guess')[1]);
waitFor(() => animals('k_02.jpg')[0] === 'Eastern Bluebird', 'a chip names it');
eq([animals('k_01.jpg'), mine('k_03.jpg')], [['Eastern Bluebird', 'leopard frog'], null],
  'whole burst: the jay of k_01 overlaps it, the jay of k_03 does not');
// This photo only: Shift on the chip.
waitFor(() => named('Eastern Bluebird'), 'its outline says so');
clickEl(named('Eastern Bluebird'));
waitFor(() => O.state().picker, 'the picker again');
// Blue Jay: k_03's name in the burst (a 'here' chip), the crop's best guess.
clickEl(Array.from(document.querySelectorAll('.iv-picker .iv-chip')).find((c) => c.querySelector('.iv-chip-text').textContent === 'Blue Jay'),
  'shift');
waitFor(() => animals('k_02.jpg')[0] !== 'Eastern Bluebird', 'Shift: this photo only');
eq([animals('k_02.jpg')[0], animals('k_01.jpg')[0]], ['Blue Jay', 'Eastern Bluebird'], 'k_01 keeps its name');

// Uncertain now: only the lone frog.
press('escape');
waitFor(() => app.state.mode === 'grid', 'the grid');
clickEl(btn);
eq(menuCount('Uncertain'), '1', 'her answers took the burst out of Uncertain');
press('escape');

// ---- "looks like your ...": after she has named a crop like it -------------------------
open('j_01.jpg');
clickEl(outline('sure'));
waitFor(() => O.state().picker, 'the jay\'s picker again');
shot('picker-lookalike.png');
const look = O.state().picker.chips.find((c) => c.kind === 'lookalike');
assert(look && look.text === 'Looks like your Eastern Bluebird' && /^from /.test(look.detail),
  `the nearest of her named crops (k_01's, first of the two alike): ${JSON.stringify(O.state().picker.chips)}`);
clickEl(chipEl('lookalike'), 'shift');
waitFor(() => mine('j_01.jpg'), 'the chip names it');
eq(mine('j_01.jpg').answer.animals.map((a) => [a.name, a.boxes.length]), [['Eastern Bluebird', 1]], 'on its box');
open('r_01.jpg');
clickEl(outline('sure'));
waitFor(() => O.state().picker, 'the cardinal\'s picker');
assert(!O.state().picker.chips.some((c) => c.kind === 'lookalike'), 'nothing she named looks like a cardinal');

// ---- Remove and Not an animal ------------------------------------------------------------
const act = (label) => Array.from(document.querySelectorAll('.iv-picker-acts button')).find((b) => b.textContent === label);
clickEl(act('Remove'));
waitFor(() => animals('r_01.jpg') === 'none', 'Remove: no name here, and nothing else: no animal');
waitFor(() => O.state().boxes.map((b) => b.kind).join() === 'unnamed', 'the outline stays, unnamed');
open('u_01.jpg');
clickEl(outline('uncertain'));
waitFor(() => O.state().picker, 'the lone frog\'s picker');
clickEl(act('Not an animal'));
waitFor(() => mine('u_01.jpg') && mine('u_01.jpg').answer.notAnimal, 'Not an animal');
eq([mine('u_01.jpg').answer.none, mine('u_01.jpg').answer.notAnimal.length], [true, 1], 'kept as a box that is no animal');
waitFor(() => O.state().boxes.length === 0 && document.querySelector('.iv-outlines').classList.contains('hidden'), 'its outline goes');

// ---- the outlines toggle -------------------------------------------------------------------
open('k_01.jpg');
waitFor(() => O.state().boxes.length === 2, 'outlines');
press('o');
assert(document.querySelector('.iv-outlines').classList.contains('hidden') && !app.settings.get('showOutlines'), 'O hides them');
press('o');
waitFor(() => !document.querySelector('.iv-outlines').classList.contains('hidden'), 'O shows them again');

console.log('test_animals_label PASSED');
}
