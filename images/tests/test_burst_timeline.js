// The stabilize view's timeline: a cell per frame that plays, as wide as it
// holds, the gap between bursts a break; a click goes to a frame; dragging a
// cell's right edge sets its hold (snapped, the time shown while dragging),
// and with several selected sets all of theirs; Delete and Backspace remove
// the selected frames from the timeline and the animation, Mod+Z brings them
// back, and the quiet removed button restores them; what is exported is
// exactly what the timeline shows. The panel's inspector follows the
// selection. IV_SHOT_DIR set: screenshots of the view at 2000x1080 and
// 1280x800 go there.

import { app, eq, press, mod, clickEl, menuLabels, chooseMenu } from '/lib/test.js';
import { openBurst } from '/app/tests/burst.js';

const path = require('path');

const shots = process.env.IV_SHOT_DIR || '';
if (shots) resize(2000, 1080);

const { frames } = openBurst();
const view = app.burst.view;
const tl = view.tl;
const near = (a, b, what, tol = 1e-6) => assert(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const cellEl = (k) => document.querySelector(`.iv-tl-cell[data-index="${k}"]`);
const indices = () => Array.from(document.querySelectorAll('.iv-tl-cell')).map((c) => Number(c.dataset.index)).sort((a, b) => a - b);
advanceTime(100);

// A cell per frame, as wide as it holds; the gap after the fourth frame a break.
eq(indices().join(), '0,1,2,3,4,5,6,7', 'a cell per frame');
const cells = tl.cells();
const t0 = view.timeline();
cells.forEach((c, j) => near(c.w, Math.max(10, t0.frames[j].duration * tl.pps), `cell ${j}'s width is its hold`, 0.01));
eq(cells.filter((c) => c.gap).map((c) => c.index).join(), '3', 'the gap follows the fourth frame');
assert(!cellEl(3).querySelector('.iv-tl-gap').classList.contains('hidden'), 'the gap shows as a break');
assert(cells[4].x >= cells[3].x + cells[3].w + 10, 'with room between the bursts');

// The stage centres every frame as held still, not the reference alone (the
// other frames slide from it, here left and up: the subject flew right).
{
  const e = view.extent;
  const V = view.viewMatrix();
  const cx = V[0] * (e[0] + e[2] / 2) + V[2], cy = V[4] * (e[1] + e[3] / 2) + V[5];
  near(cx, view.stage.clientWidth / 2, 'the frames centred across the stage', 0.5);
  near(cy, view.stage.clientHeight / 2, 'and down it', 0.5);
  assert(e[0] < -50, `the frames reach left of the reference (${e[0].toFixed(0)})`);
}

// A click goes to the frame, and the inspector shows it.
clickEl(cellEl(5).querySelector('.iv-tl-frame'));
eq(view.cur, 5, 'a click goes to the frame');
eq(view.model().selection.join(), '5', 'and selects it');
assert(/Frame 6 of 8/.test(document.querySelector('.iv-bp-frames .iv-bp-head').textContent), 'the inspector names the frame');
assert(/Hold\s*0\.1 s · as shot/.test(document.querySelector('.iv-bp-props').textContent), `its hold, as shot: ${document.querySelector('.iv-bp-props').textContent}`);

/** Where a cell's right edge is on screen. */
function edgeOf(k) {
  const r = cellEl(k).getBoundingClientRect();
  return [r.right, r.top + r.height / 2];
}

// Drag frame 2's edge: the time shows while dragging and snaps (0.01 s steps under 0.2 s).
let [x, y] = edgeOf(1);
mouseDown(x, y, 0);
advanceTime(16);
mouseMove(x + 0.053 * tl.pps, y);
advanceTime(16);
const tip = document.querySelector('.iv-tl-tip');
assert(!tip.classList.contains('hidden'), 'the time shows while dragging');
eq(tip.textContent, '0.15 s', 'snapped to 0.01 s');
mouseUp(x + 0.053 * tl.pps, y, 0);
advanceTime(16);
assert(tip.classList.contains('hidden'), 'and goes when the drag ends');
near(view.timeline().frames[1].duration, 0.15, 'the hold is set', 1e-9);
assert(cellEl(1).classList.contains('custom'), 'the cell says it has its own hold');

// Several selected (Ctrl+click adds, Shift+click a range): dragging one edge holds them all.
clickEl(cellEl(4).querySelector('.iv-tl-frame'));
clickEl(cellEl(6).querySelector('.iv-tl-frame'), 'shift');
eq(view.model().selection.join(), '4,5,6', 'Shift+click selects a range');
clickEl(cellEl(0).querySelector('.iv-tl-frame'), 'ctrl');
eq(view.model().selection.join(), '0,4,5,6', 'Ctrl+click adds one');
assert(/4 frames/.test(document.querySelector('.iv-bp-frames .iv-bp-head').textContent), 'the inspector counts them');
[x, y] = edgeOf(5);
mouseDown(x, y, 0);
advanceTime(16);
mouseMove(x + 0.3 * tl.pps, y);
advanceTime(16);
assert(/· 4 frames/.test(tip.textContent), `the tip says how many: ${tip.textContent}`);
mouseUp(x + 0.3 * tl.pps, y, 0);
advanceTime(16);
let t = view.timeline();
const held = t.frames.filter((f) => [0, 4, 5, 6].includes(f.index)).map((f) => f.duration.toFixed(2));
eq(held.join(), '0.40,0.40,0.40,0.40', 'every selected frame takes the hold');
assert(/Holds\s*0\.4 s/.test(document.querySelector('.iv-bp-props').textContent), 'the inspector shows their holds');

// Undo puts the holds back in one step; the speed scales every frame.
press(`${mod}+z`);
t = view.timeline();
near(t.frames[0].duration, 0.1, 'Undo puts the holds back', 1e-6);
near(t.frames[1].duration, 0.15, 'the earlier drag stays', 1e-9);
view.setSpeed(2);
near(view.timeline().frames[1].duration, 0.075, 'the speed applies to a frame\'s own hold too', 1e-9);
near(view.timeline().frames[0].duration, 0.05, 'and to the rest', 1e-6);
view.setSpeed(1);

// The gap's break drags too: it is the hold of the burst's last frame.
const g = cellEl(3).querySelector('.iv-tl-gap').getBoundingClientRect();
mouseDown(g.left + g.width / 2, g.top + g.height / 2, 0);
advanceTime(16);
mouseMove(g.left + g.width / 2 + 0.2 * tl.pps, g.top + g.height / 2);
advanceTime(16);
mouseUp(g.left + g.width / 2 + 0.2 * tl.pps, g.top + g.height / 2, 0);
advanceTime(16);
t = view.timeline();
near(t.frames[3].duration, 0.3, 'dragging the gap holds the frame before it longer', 1e-9);
eq(t.frames[3].gap, true, 'still a gap');

// A frame tracking is unsure of: its cell is flagged, and the inspector says
// what to do, with the button that gets the stage ready for the click.
const f5 = app.burst.session.frames[5];
const was = { status: f5.status, confidence: f5.track.confidence };
f5.status = 'low';
f5.track.confidence = 0.31;
view.go(5);
advanceTime(50);
eq(cellEl(5).querySelector('.iv-tl-flag').textContent, 'Check 31%', 'the cell is flagged');
assert(!document.querySelector('.iv-bp-callout').classList.contains('hidden'), 'the inspector explains');
assert(/click the subject/i.test(document.querySelector('.iv-bp-callout').textContent), 'how to set it again');
if (shots) {
  screenshot(path.join(shots, 'burst-2000x1080.png'));
  clickEl(cellEl(4).querySelector('.iv-tl-frame'));
  clickEl(cellEl(6).querySelector('.iv-tl-frame'), 'shift');
  advanceTime(100);
  screenshot(path.join(shots, 'burst-2000x1080-multi.png'));
  resize(1280, 800);
  advanceTime(300);
  view.go(5);
  advanceTime(200);
  screenshot(path.join(shots, 'burst-1280x800.png'));
}
clickEl(document.querySelector('.iv-bp-callout .btn'));
eq(view.correcting, true, 'Click the subject readies the stage for the click');
view.setCorrecting(false);
f5.status = was.status;
f5.track.confidence = was.confidence;
view.changed();

// Delete removes the selected frames from the timeline and the animation.
clickEl(cellEl(6).querySelector('.iv-tl-frame'));
clickEl(cellEl(7).querySelector('.iv-tl-frame'), 'shift');
tl.scroller.focus();
press('delete');
advanceTime(16);
eq(indices().join(), '0,1,2,3,4,5', 'Delete takes them out of the timeline');
eq(view.timeline().frames.map((f) => f.index).join(), '0,1,2,3,4,5', 'and out of the animation');
eq(view.exportPlan().map((p) => p.index).join(), '0,1,2,3,4,5', 'the export renders what the timeline shows');
eq(view.cur, 5, 'the current frame moves to one that plays');
assert(/2 removed/.test(document.querySelector('.iv-bp-summary').textContent), 'the summary counts the removed frames');
const removedBtn = document.querySelector('.iv-tl-removed');
assert(!removedBtn.classList.contains('hidden') && /2 removed/.test(removedBtn.textContent), 'a quiet button counts them');
// Backspace too.
clickEl(cellEl(2).querySelector('.iv-tl-frame'));
press('backspace');
eq(indices().join(), '0,1,3,4,5', 'Backspace removes too');

// Mod+Z brings the last removal back, then the first.
press(`${mod}+z`);
eq(indices().join(), '0,1,2,3,4,5', 'Undo brings the frame back');
press(`${mod}+z`);
eq(indices().join(), '0,1,2,3,4,5,6,7', 'and the two before it');
assert(removedBtn.classList.contains('hidden'), 'nothing removed: the button goes');
press(`${mod}+shift+z`);
eq(indices().join(), '0,1,2,3,4,5', 'Redo removes them again');

// The removed button restores them.
clickEl(removedBtn);
assert(menuLabels().some((l) => /Restore All/.test(l)), `it offers to restore them (${menuLabels().join(', ')})`);
chooseMenu('Restore burst_07.jpg');
eq(indices().join(), '0,1,2,3,4,5,6', 'one frame back');
clickEl(removedBtn);
chooseMenu('Restore All (1)');
eq(indices().join(), '0,1,2,3,4,5,6,7', 'every frame back');

// The last frame cannot go.
for (const k of [0, 1, 2, 3, 4, 5, 6]) view.setIncluded(k, false);
eq(view.edits.kept().join(), '7', 'one left');
assert(!view.removeSelected(), 'the last frame is not removed');
for (let i = 0; i < 7; i++) press(`${mod}+z`);
eq(indices().join(), '0,1,2,3,4,5,6,7', 'undo brings every frame back');

console.log('test_burst_timeline PASSED');
