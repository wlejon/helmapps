// The photo is for looking: Find Animals draws nothing over it until asked.
//  - By default no outline and no name tag on the photo.
//  - The pointer on an animal of the details shows that animal's box alone
//    (beside isolate.js's darkening), with its name tag; a click on the row
//    opens its picker with that one box; Escape and the pointer gone, none.
//  - The toolbar's outline button (or O) shows every box; the setting is
//    remembered across a start of the app (outlines_restart.js).
//  - A name tag is readable wherever the box is: above it, else inside or
//    under it, inside the stage (boxes at the top, left and right edges of a
//    zoomed photo), a long name ending in an ellipsis at TAG_MAX.
//  - A box the detector called a bird suggests birds only (its queryTop),
//    and the names already in the photo (Mallard); no suggestion at 0%,
//    in the picker, the details' "Possibly" line or the Uncertain tile.
// IV_SHOTS=<dir>: pictures of the tags for a person to look at (never in the repo).

import { app, waitFor, eq, center, clickEl, press, fixtureDir } from '/lib/test.js';
import { photo, stubTable, analysed, detailAnimals, MALLARD, ODD_BIRD, LONG } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';
import { TAG_MAX } from '/app/js/wildlife/outlines.js';

const path = require('path');
const { spawnSync } = require('child_process');
const OUTLINE_TABLE = [MALLARD, ODD_BIRD, LONG];

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.nearest !== 'function') {
  skipTest('this bro has no bro.vision.wildlife.nearest');
} else run();

function run() {
const dir = fixtureDir({
  'm_01.jpg': photo({ time: 10, discs: [{ animal: MALLARD, at: [90, 120], r: 26 }, { animal: ODD_BIRD, at: [230, 120], r: 20 }] }),
  't_01.jpg': photo({ time: 20, discs: [{ animal: LONG, at: [160, 10], r: 16 }] }),
  'l_01.jpg': photo({ time: 30, discs: [{ animal: MALLARD, at: [8, 120], r: 16 }] }),
  'r_01.jpg': photo({ time: 40, discs: [{ animal: LONG, at: [312, 120], r: 16 }] }),
});
const W = app.wildlife;
W.useStub(stubTable(OUTLINE_TABLE));
W.isolate.useStub();
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 4, 'the folder');
analysed(app, waitFor);
waitFor(() => W.nameIndex(), 'the names');

const at = (n) => path.join(dir, n);
const O = W.outlines;
const open = (n) => { app.openImage(at(n)); shown(app, waitFor, n); waitFor(() => app.state.pic && !app.state.pic.placeholder, `${n} itself`); advanceTime(16); };
const outlines = () => Array.from(document.querySelectorAll('.iv-outlines .iv-outline'));
const tags = () => Array.from(document.querySelectorAll('.iv-outlines .iv-outline-tag'));
const hover = (el) => { el.scrollIntoView({ block: 'nearest' }); advanceTime(16); mouseMove(...center(el)); advanceTime(16); };
const away = () => hover(document.querySelector('.iv-details-head'));
const rowOf = (name) => detailAnimals().find((x) => x.name === name);
const shot = (name) => { if (process.env.IV_SHOTS) { advanceTime(32); screenshot(path.join(process.env.IV_SHOTS, name)); } };
const rec = (n) => W.analysis.record(at(n));
const odd = rec('m_01.jpg').animals.findIndex((x) => x.species[0].common === 'American Dipper');
assert(odd > 0, 'the odd bird is the second box');

// ---- by default: nothing over the photo ------------------------------------------------
eq(app.settings.get('showOutlines'), false, 'outlines off by default');
open('m_01.jpg');
press('mod+i');
waitFor(() => detailAnimals().length === 2, 'the mallard and the bird no name covers');
advanceTime(100);
eq([outlines().length, tags().length], [0, 0], 'no outline and no name tag on the photo');
assert(document.querySelector('.iv-outlines').classList.contains('hidden'), 'the layer hidden');
const button = document.querySelector('[data-command="animals-outlines"]');
assert(button && !button.classList.contains('hidden') && !button.disabled, 'the outline button in the toolbar');
eq([button.dataset.tip, button.dataset.keys, button.classList.contains('active')], ['Show Animal Outlines', 'O', false],
  'its tip and key, off');
shot('outlines-off.png');

// ---- the pointer on an animal of the details: its box alone -----------------------------
const bird = rowOf('Not identified');
assert(bird && bird.hit, 'the bird\'s row is on the photo');
hover(bird.el);
waitFor(() => outlines().length === 1, 'one box while the pointer is on its row');
eq(O.state().boxes, [{ i: odd, kind: 'uncertain', name: 'American Dipper?' }], 'the bird\'s, and no other');
const focusTag = () => document.querySelector('.iv-outlines .iv-outline.focus + .iv-outline-tag');
assert(focusTag() && getComputedStyle(focusTag()).visibility === 'visible', 'its name tag shows');
eq(W.isolate.state().boxes.length, 1, 'beside the darkening of the rest');
shot('outlines-hover.png');
away();
waitFor(() => outlines().length === 0, 'none once the pointer leaves');

// ---- a click on the row: its picker, with its one box ----------------------------------
clickEl(rowOf('Not identified').el.querySelector('.iv-animal-guess'));
waitFor(() => O.state().picker, 'the picker from the details');
eq(O.state().picker.i, odd, 'for that animal');
away();
advanceTime(16);
eq([outlines().length, O.state().boxes.map((b) => b.i)], [1, [odd]], 'its box shows while the picker is open');
assert(outlines()[0].classList.contains('picking'), 'as the one being named');
// Its suggestions: the name already in the photo, then birds only, none at 0%.
const chips = () => O.state().picker.chips.map((c) => `${c.kind}:${c.text}${c.detail ? ` ${c.detail}` : ''}`);
eq(chips(), ['here:Mallard in this photo', 'guess:American Dipper 92%', 'guess:Spotted Sandpiper 7.9%'],
  'the photo\'s Mallard, then the bird box\'s birds');
assert(!/Beaver|Otter|Turtle|Virginia Rail/.test(document.querySelector('.iv-picker').textContent),
  'no mammal, turtle or 0% bird in the picker');
assert(!/(^|\D)0(\.0)?%/.test(document.querySelector('.iv-picker').textContent), 'no 0% in the picker');
shot('outlines-picker.png');
press('escape');
waitFor(() => !O.state().picker && outlines().length === 0, 'Escape: the picker and its box go');
// The details and the Uncertain tile suggest the same.
eq(rowOf('Not identified').guess, 'Possibly American Dipper 92%, Spotted Sandpiper 7.9%', 'the details\' guesses: birds, none at 0%');
app.commands.run('animals-filter', ':uncertain');
const tileOf = () => app.grid.items.find((it) => it.path === at('m_01.jpg') && it.guess);
waitFor(tileOf, 'the photo in Uncertain');
const tile = tileOf();
eq([tile.tag, tile.conf], ['American Dipper?', 92], 'its tile\'s guess');
assert(!/Beaver|0%/.test(tile.names), `its tooltip: ${tile.names}`);
app.commands.run('animals-filter', '');

// ---- the toolbar button: every box, remembered -------------------------------------------
clickEl(button);
waitFor(() => outlines().length === 2, 'every box');
eq([app.settings.get('showOutlines'), button.classList.contains('active')], [true, true], 'on, and the button says so');
shot('outlines-on.png');

// ---- name tags, readable at any edge of the stage ------------------------------------------
const stage = () => app.viewer.el.getBoundingClientRect();
const inside = (r, s) => r.left >= s.left - 0.5 && r.top >= s.top - 0.5 && r.right <= s.right + 0.5 && r.bottom <= s.bottom + 0.5;
/** Zoom 4x (the photo wider and taller than the stage) with the photo's `edge` on the stage's. */
const pinEdge = (edge) => {
  const v = app.viewer;
  v.measure();
  const s = 4 * v.fitScale(), pw = v.pic.width * s, ph = v.pic.height * s;
  Object.assign(v.v, { fit: false, scale: s, panX: 0, panY: 0 });
  if (edge === 'left') v.v.panX = pw / 2 - v.size.w / 2;
  if (edge === 'right') v.v.panX = v.size.w / 2 - pw / 2;
  if (edge === 'top') v.v.panY = ph / 2 - v.size.h / 2;
  v.changed();
  advanceTime(16);
};
const checkTag = (n, edge, name) => {
  open(n);
  pinEdge(edge);
  const row = detailAnimals().find((x) => x.hit);
  hover(row.el);
  waitFor(() => focusTag(), `${n}: the tag of the hovered animal`);
  const out = document.querySelector('.iv-outlines .iv-outline.focus');
  const box = out.getBoundingClientRect(), S = stage();
  const near = { left: box.left - S.left, top: box.top - S.top, right: S.right - box.right }[edge];
  assert(near <= 1, `${n}: the box is at the stage's ${edge} edge (${Math.round(near)} px)`);
  const tag = focusTag(), text = tag.querySelector('.iv-outline-tag-text');
  const r = tag.getBoundingClientRect();
  assert(getComputedStyle(tag).visibility === 'visible', `${n}: the tag shows`);
  assert(inside(r, S), `${n}: the tag inside the stage: ${[r.left, r.top, r.right, r.bottom].map(Math.round)} in ` +
    `${[S.left, S.top, S.right, S.bottom].map(Math.round)}`);
  assert(r.width > 40 && r.height >= 16, `${n}: a tag, not a dot: ${Math.round(r.width)}x${Math.round(r.height)}`);
  eq(text.textContent, name, `${n}: the whole name in it`);
  // The name's whole width (scrollWidth would say it, but bro's leaves out a
  // nowrap text's own overflow): the same text in the same font, unconstrained.
  const cs = getComputedStyle(text);
  const probe = document.createElement('span');
  Object.assign(probe.style, { position: 'absolute', left: '0', top: '0', visibility: 'hidden', whiteSpace: 'nowrap',
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight });
  probe.textContent = name;
  document.body.appendChild(probe);
  const full = probe.offsetWidth;
  probe.remove();
  const room = text.clientWidth;
  if (name.length > 30) {
    assert(r.width <= TAG_MAX + 0.5 && full > room && cs.textOverflow === 'ellipsis',
      `${n}: a long name ends in an ellipsis at ${TAG_MAX} px (${Math.round(full)} > ${room}, ${cs.textOverflow})`);
  } else {
    assert(full <= room + 1 && text.scrollWidth <= room + 1, `${n}: all of it visible (${Math.round(full)} <= ${room})`);
  }
  shot(`tag-${edge}.png`);
  away();
  app.viewer.fit();
  advanceTime(16);
};
checkTag('t_01.jpg', 'top', LONG.species[0].common);
checkTag('l_01.jpg', 'left', 'Mallard');
checkTag('r_01.jpg', 'right', LONG.species[0].common);
// A tag above a box with room: over it, at its left.
open('m_01.jpg');
hover(rowOf('Mallard').el);
waitFor(() => focusTag(), 'the mallard\'s tag');
{
  const box = document.querySelector('.iv-outlines .iv-outline.focus').getBoundingClientRect();
  const r = focusTag().getBoundingClientRect();
  assert(r.bottom <= box.top + 0.5 && Math.abs(r.left - box.left) < 1, 'room above: the tag sits on the box');
}
away();

// ---- the setting across a start of the app -------------------------------------------------
const child = spawnSync(process.execPath, ['--width', '1280', '--height', '800', bro.appDir, path.join(bro.appDir, 'tests', 'outlines_restart.js')], {
  env: { ...process.env, IV_OUTLINES_EXPECT: JSON.stringify({ dir }) },
  encoding: 'utf8',
  timeout: 90000,
});
const out = `${child.stdout || ''}${child.stderr || ''}`;
for (const l of out.split(/\r?\n/).filter((x) => /ASSERTION|PASSED|uncaught|Error/.test(x))) console.log(`  restart: ${l.trim()}`);
eq(child.status, 0, 'the app started again shows every outline');
assert(out.includes('outlines_restart PASSED'), 'and says so');

// O turns them off again: nothing over the photo.
press('o');
waitFor(() => outlines().length === 0 && !app.settings.get('showOutlines'), 'O: off again');

console.log('test_animals_outlines PASSED');
}
