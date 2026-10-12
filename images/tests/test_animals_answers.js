// Her corrections (js/wildlife/editor.js, answers.js), with the test stub
// standing in for the models: a name corrected in place with suggestions
// over the lists (a common name, a scientific name, a group above species,
// her own words), a count ("4 Mallard"), the names confirmed with one key,
// an animal added, removed, "no animal", and back to the identifier; in a
// burst "This photo" or "Whole burst" with Enter / Shift+Enter and the
// choice remembered; her answer marked as hers on the tile, in the details
// and the status bar; Undo; the answers file in the data dir; and a second
// start of the app (a separate bro-headless on the same BRO_APP_HOME) that
// shows her answers again (answers_restart.js).

import { app, waitFor, eq, press, type, clickEl, fixtureDir } from '/lib/test.js';
import { shotsTree, stubTable, analysed, photo, TABLE, FROG, SPIDER, MORE_NAMES, TAXA } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';
import { answersFile } from '/app/js/wildlife/answers.js';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.nameIndex !== 'function') {
  skipTest('this bro has no bro.vision.wildlife.nameIndex');
} else run();

function run() {
const dir = fixtureDir({ ...shotsTree(), 'u_01.jpg': photo({ time: 25, animal: FROG }), 's_01.jpg': photo({ time: 35, animal: SPIDER }) });
const at = (n) => path.join(dir, n);
const W = app.wildlife;
W.useStub(stubTable([...TABLE, FROG, SPIDER]), { taxa: TAXA, names: MORE_NAMES });
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 11, 'the folder');
analysed(app, waitFor);
waitFor(() => W.nameIndex() && W.answers.keys.size === 11, 'the names and every photo\'s key');

const field = () => document.querySelector('.iv-details .combobox-input');
const suggestions = () => Array.from(document.querySelectorAll('.combobox-list:not(.hidden) .combobox-item .menu-text')).map((e) => e.textContent);
const highlighted = () => { const a = document.querySelector('.combobox-list:not(.hidden) .combobox-item.active .menu-text'); return a ? a.textContent : null; };
const mine = (n) => W.answers.of(at(n));
const animals = (n) => (mine(n) ? (mine(n).answer.none ? 'none' : mine(n).answer.animals) : null);
const item = (n) => app.shownItems().find((it) => it.path === at(n));
const status = () => document.querySelector('.statusbar').textContent;
const saved = (pred, what) => waitFor(() => pred(), what);
const open = (n) => { app.openImage(at(n)); shown(app, waitFor, n); };

// ---- a name corrected in place, by its common name ---------------------------------
open('b_01.jpg');
eq(app.settings.get('showDetails'), false, 'the details start hidden');
press('n');
assert(app.settings.get('showDetails'), 'N shows the details');
assert(field() && document.activeElement === field(), 'and puts a field in the first animal\'s name');
eq(field().value, 'Blue Jay', 'holding the name it corrects');
type('mall');
eq(suggestions()[0], 'Mallard', 'suggestions by common name');
eq(highlighted(), 'Mallard', 'a sure match is taken by Enter');
eq(document.querySelector('.iv-details .iv-answer-hint').textContent, 'Enter saves · Escape cancels', 'a photo alone: no scope to choose');
press('enter');
saved(() => mine('b_01.jpg'), 'her answer saved');
eq(animals('b_01.jpg'), [{ name: 'Mallard', scientific: 'Anas platyrhynchos', rank: 'species', boxes: [[120, 80, 80, 80]] }],
  'a name of the lists, with its scientific name, on the box the name it corrects was on');
eq([mine('b_01.jpg').by, mine('b_01.jpg').scope, mine('b_01.jpg').name], ['user', 'photo', 'b_01.jpg'], 'by her, this photo, its file name');
assert(/^\d+:[0-9a-f]{32}$/.test(mine('b_01.jpg').key), `keyed by the file's size and ends: ${mine('b_01.jpg').key}`);
waitFor(() => item('b_01.jpg').tag === 'Mallard', 'the tile follows');
eq([item('b_01.jpg').mine, item('b_01.jpg').names], [true, 'Mallard · yours'], 'marked as hers');
waitFor(() => /Mallard · yours/.test(status()), 'the status bar says the photo\'s names are hers');
const sec = document.querySelector('.iv-details .iv-answer');
assert(sec && /Mallard/.test(sec.textContent) && sec.querySelector('.iv-animal-mine'), 'the details: her answer first, marked yours');
assert(/Identifier/.test(document.querySelector('.iv-details').textContent) && /Blue Jay/.test(document.querySelector('.iv-details').textContent),
  'what the identifier said stays below it');
const file = answersFile(bro.app.dataDir);
assert(file.startsWith(bro.app.dataDir), 'in the data dir');
waitFor(() => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')).answers.length === 1; } catch (_) { return false; } }, 'written to disk');
eq(JSON.parse(fs.readFileSync(file, 'utf-8')).format, 'helm.images.answers', 'the answers file');

// A count: "4 Mallard".
press('n');
eq(field().value, 'Mallard', 'her name to correct now');
type('4 Mallard');
press('enter');
saved(() => animals('b_01.jpg')[0].count === 4, 'the count');
waitFor(() => item('b_01.jpg').tag === 'Mallard ×4', 'the tile shows the count');
press('n');
eq(field().value, '4 Mallard', 'the count comes back to edit');
press('escape');
assert(!field(), 'Escape: no field');
eq(animals('b_01.jpg')[0].count, 4, 'and nothing changed');

// ---- by a scientific name, a group, her own words ------------------------------------
open('d_01.jpg');
press('n');
type('cardinalis card');
eq(suggestions()[0], 'Northern Cardinal', 'suggestions by scientific name');
press('enter');
saved(() => animals('d_01.jpg') && animals('d_01.jpg')[0].name === 'Northern Cardinal', 'a scientific name');

open('u_01.jpg');
waitFor(() => document.querySelector('.iv-details .iv-animal[data-edit="add"] .iv-animal-edit'), 'the unidentified frog to name');
clickEl(document.querySelector('.iv-details .iv-animal[data-edit="add"] .iv-animal-edit'));
assert(field(), 'a click on "Not identified" names it');
type('darn');
eq(suggestions(), ['Darners (Aeshnidae)', 'Shadow Darner', 'Common Green Darner', 'Lance-tipped Darner'], 'a group above its species');
eq(document.querySelector('.combobox-list:not(.hidden) .combobox-detail').textContent, 'Family', 'said to be a family');
clickEl(document.querySelectorAll('.combobox-list:not(.hidden) .combobox-item')[0]);
saved(() => mine('u_01.jpg'), 'a click on a suggestion saves it');
eq(animals('u_01.jpg'), [{ name: 'Darners', scientific: 'Aeshnidae', rank: 'family' }], 'the family');
waitFor(() => item('u_01.jpg').tag === 'Darners (Aeshnidae)', 'the tile names it');

app.commands.run('animals-show-empty');
open('e_01.jpg');
press('a');
assert(field() && field().value === '', 'A: an empty field to add an animal');
type('freshwater mussel');
eq(highlighted(), null, 'nothing on the lists is taken for her own words');
press('enter');
saved(() => mine('e_01.jpg'), 'her own words');
eq(animals('e_01.jpg'), [{ name: 'freshwater mussel' }], 'kept as she wrote them, no rank');
waitFor(() => item('e_01.jpg').tag === 'freshwater mussel', 'and shown');

// ---- add, remove, no animal, revert, undo --------------------------------------------
open('d_01.jpg');
press('a');
type('eastern gray');
press('enter');
saved(() => animals('d_01.jpg').length === 2, 'an animal added');
eq(animals('d_01.jpg').map((a) => a.name), ['Northern Cardinal', 'Eastern Gray Squirrel'], 'after the first');
waitFor(() => document.querySelectorAll('.iv-details .iv-answer .iv-animal[data-edit]').length === 2, 'both in the details');
document.querySelectorAll('.iv-details .iv-answer .iv-animal[data-edit]')[1].focus();
press('x');
saved(() => animals('d_01.jpg').length === 1, 'X removes the focused one');
eq(animals('d_01.jpg')[0].name, 'Northern Cardinal', 'the other stays');
// Undo in the toast. Her answer shows at once, its toast once it is on disk (the answers
// worker's write and fsync): the Undo of this removal, not the toast before it it replaces.
const undoOf = (text) => {
  let btn = null;
  waitFor(() => {
    const t = Array.from(document.querySelectorAll('.toast[data-toast-key="answers"]:not(.leaving)'))
      .find((el) => el.querySelector('.toast-text').textContent === text);
    btn = t ? Array.from(t.querySelectorAll('button')).find((b) => b.textContent === 'Undo') : null;
    return btn;
  }, `the toast '${text}' with its Undo`);
  return btn;
};
clickEl(undoOf('Removed Eastern Gray Squirrel'));
saved(() => animals('d_01.jpg').length === 2, 'Undo puts it back');
waitFor(() => document.querySelectorAll('.iv-details .iv-answer .iv-animal-act').length === 2, 'the rows\' buttons');
clickEl(document.querySelectorAll('.iv-details .iv-answer .iv-animal')[1].querySelector('.iv-animal-act[data-tip^="Remove"]'));
saved(() => animals('d_01.jpg').length === 1, 'a row\'s cross removes it');
press('shift+n');
saved(() => animals('d_01.jpg') === 'none', 'Shift+N: no animal');
waitFor(() => item('d_01.jpg').none && item('d_01.jpg').names === 'No animal · yours', 'the tile says so');
eq(app.state.path, at('d_01.jpg'), 'the photo on screen stays');
app.commands.run('animal-revert');
saved(() => !mine('d_01.jpg'), 'Revert to identifier');
waitFor(() => item('d_01.jpg').tag === 'Eastern Gray Squirrel' && !item('d_01.jpg').mine, 'the identifier\'s name is back');

// ---- confirm ---------------------------------------------------------------------------
open('s_01.jpg');
press('y');
saved(() => mine('s_01.jpg'), 'Y confirms the names shown');
eq([animals('s_01.jpg'), mine('s_01.jpg').confirmed],
  [[{ name: 'Marbled Orbweaver', scientific: 'Araneus marmoreus', rank: 'species', boxes: [[120, 80, 80, 80]] }], true],
  'the identifier\'s name, confirmed, with its box');
app.commands.run('animal-revert');
saved(() => !mine('s_01.jpg'), 'and reverted');
waitFor(() => document.querySelector('.iv-details .iv-animal-act[data-tip^="Correct"]'), 'a row\'s check');
clickEl(document.querySelector('.iv-details .iv-animal-act[data-tip^="Correct"]'));
saved(() => mine('s_01.jpg') && mine('s_01.jpg').confirmed, 'a row\'s check confirms too');

// ---- bursts: this photo or the whole burst, remembered -------------------------------
eq(app.settings.get('answerScope'), 'photo', 'this photo by default');
open('a_01.jpg');
waitFor(() => document.querySelector('.iv-details .iv-answer-scope button.on'), 'the scope switch in a burst');
eq(document.querySelector('.iv-details .iv-answer-scope button.on').textContent, 'This photo', 'showing this photo');
eq(document.querySelector('.iv-details .iv-answer-scope [data-scope="burst"]').textContent, 'Whole burst (3)', 'or the burst\'s three');
press('n');
eq(document.querySelector('.iv-details .iv-answer-hint').textContent, 'Enter: this photo · Shift+Enter: whole burst (3)', 'the field says what Enter does');
type('scarlet');
press('enter');
saved(() => mine('a_01.jpg'), 'Enter: this photo');
eq([animals('a_01.jpg')[0].name, mine('a_02.jpg'), mine('a_03.jpg')], ['Scarlet Tanager', null, null], 'only this photo');
open('a_02.jpg');
press('n');
type('summer tan');
press('shift+enter');
saved(() => mine('a_03.jpg'), 'Shift+Enter: the whole burst');
eq(['a_01.jpg', 'a_02.jpg', 'a_03.jpg'].map((n) => [animals(n)[0].name, mine(n).scope]),
  [['Scarlet Tanager', 'photo'], ['Summer Tanager', 'burst'], ['Summer Tanager', 'burst']],
  'the same animal in every frame: the cardinal becomes a Summer Tanager; the frame she named otherwise keeps her name');
eq(app.settings.get('answerScope'), 'burst', 'the choice is remembered');
waitFor(() => document.querySelector('.iv-details .iv-answer-scope button.on') &&
  document.querySelector('.iv-details .iv-answer-scope button.on').dataset.scope === 'burst', 'and shown');
open('c_02.jpg');
press('y');
saved(() => mine('c_01.jpg') && mine('c_02.jpg'), 'Y with the remembered choice: the whole burst');
eq([animals('c_01.jpg')[0].name, mine('c_01.jpg').confirmed, mine('c_01.jpg').scope], ['Blue Jay', true, 'burst'], 'confirmed on both frames');
app.commands.run('animal-revert');
saved(() => !mine('c_01.jpg') && !mine('c_02.jpg'), 'revert follows the choice too');
press('shift+y');
saved(() => mine('c_02.jpg'), 'Shift+Y: the other choice');
eq([mine('c_01.jpg'), app.settings.get('answerScope')], [null, 'photo'], 'this photo alone, remembered');
clickEl(document.querySelector('.iv-details .iv-answer-scope [data-scope="burst"]'));
eq(app.settings.get('answerScope'), 'burst', 'the switch sets the choice too');

// ---- the file, and a second start of the app -----------------------------------------
waitFor(() => JSON.parse(fs.readFileSync(file, 'utf-8')).answers.length === W.answers.size, 'every answer on disk');
const want = {};
for (const it of app.shownItems()) want[path.basename(it.path)] = { tag: it.tag, mine: it.mine };
eq(want['b_01.jpg'], { tag: 'Mallard ×4', mine: true }, 'what the restart should show');
const child = spawnSync(process.execPath, ['--width', '1280', '--height', '800', bro.appDir, path.join(bro.appDir, 'tests', 'answers_restart.js')], {
  env: { ...process.env, IV_ANSWERS_EXPECT: JSON.stringify({ dir, want, scope: 'burst' }) },
  encoding: 'utf8',
  timeout: 90000,
});
const out = `${child.stdout || ''}${child.stderr || ''}`;
for (const l of out.split(/\r?\n/).filter((x) => /ASSERTION|PASSED|uncaught|Error/.test(x))) console.log(`  restart: ${l.trim()}`);
eq(child.status, 0, 'the app started again shows her answers');
assert(out.includes('answers_restart PASSED'), 'and says so');

console.log('test_animals_answers PASSED');
}
