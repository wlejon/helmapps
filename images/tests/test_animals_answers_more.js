// Her answers everywhere (stub models): a name group holds the photos the
// identifier guessed and the ones she confirmed, each tile marked; the
// Animals menu's counts, the search (file names and animal names: hers,
// common and scientific) and the tiles follow her answers; Next to check
// (U) goes only to photos with an animal and no answer of hers and never to
// a spider; throwing the analysis records away and a changed analyzer
// config analyse again and leave her answers alone; a copy of the folder
// elsewhere shows them too (the file's identity, not its path).

import { app, waitFor, eq, press, type, clickEl, menuLabels, chooseMenu, fixtureDir } from '/lib/test.js';
import { shotsTree, stubTable, analysed, photo, TABLE, FROG, SPIDER, JAY, MORE_NAMES, TAXA } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';
import { cacheFile } from '/app/js/wildlife/records.js';
import { answersFile } from '/app/js/wildlife/answers.js';

const fs = require('fs');
const path = require('path');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.nameIndex !== 'function') {
  skipTest('this bro has no bro.vision.wildlife.nameIndex');
} else run();

function run() {
const tree = { ...shotsTree(), 'u_01.jpg': photo({ time: 25, animal: FROG }), 's_01.jpg': photo({ time: 35, animal: SPIDER }) };
const dir = fixtureDir(tree);
const W = app.wildlife;
const table = stubTable([...TABLE, FROG, SPIDER]);
W.useStub(table, { taxa: TAXA, names: MORE_NAMES });
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 11, 'the folder');
analysed(app, waitFor);
waitFor(() => W.nameIndex() && W.answers.keys.size === 11, 'the names and every photo\'s key');

let base = dir;
const at = (n) => path.join(base, n);
const mine = (n) => W.answers.of(at(n));
const item = (n) => app.grid.items.find((it) => it.path === at(n));
const gridNames = () => app.grid.items.map((it) => path.basename(it.path)).join();
const open = (n) => { app.openImage(at(n)); shown(app, waitFor, n); };
const btn = document.querySelector('.iv-animals-filter');
const menuCount = (label) => {
  const row = Array.from(document.querySelectorAll('.menu .menu-item')).find((r) => r.querySelector('.menu-text').textContent === label);
  return row && row.querySelector('.menu-count') ? row.querySelector('.menu-count').textContent : null;
};

// ---- a name group: guessed and confirmed photos together ----------------------------
open('c_01.jpg');
press('y');
waitFor(() => mine('c_01.jpg'), 'c_01 confirmed (this photo)');
eq(mine('c_02.jpg'), null, 'its burst\'s other frame is still a guess');
open('b_01.jpg');
press('n');
type('mall');
press('enter');
waitFor(() => mine('b_01.jpg'), 'b_01 is a Mallard');
press('escape');
waitFor(() => app.state.mode === 'grid', 'the grid');
clickEl(btn);
eq(menuLabels().slice(0, 5).join('|'), 'All photos|Northern Cardinal|Blue Jay|Eastern Gray Squirrel|Mallard', 'the groups by photo count');
eq([menuCount('Blue Jay'), menuCount('Mallard')], ['2', '1'], 'her Mallard counts there, not as a jay');
chooseMenu('Blue Jay');
eq(gridNames(), 'c_01.jpg,c_02.jpg', 'the jay group: the one she confirmed and the guess');
eq([item('c_01.jpg').mine, item('c_02.jpg').mine], [true, false], 'told apart on the tiles');
waitFor(() => document.querySelectorAll('.iv-grid .iv-tag.mine').length === 1, 'one tile with her mark');
const cell = (n) => Array.from(document.querySelectorAll('.iv-grid .vgrid-cell')).find((c) => c.title === n);
assert(cell('c_01.jpg').querySelector('.iv-tag-mine') && !cell('c_01.jpg').querySelector('.iv-tag-conf'), 'hers: a person mark, no score');
eq(cell('c_02.jpg').querySelector('.iv-tag-conf').textContent, '92%', 'the guess: its score');
clickEl(btn);
chooseMenu('Mallard');
eq(gridNames(), 'b_01.jpg', 'her name is a group too');
clickEl(btn);
chooseMenu('All photos');

// ---- search: file names and names, hers included ---------------------------------------
const search = document.querySelector('.iv-search input');
assert(search && !document.querySelector('.iv-search').classList.contains('hidden'), 'a search field in the toolbar');
press('mod+f');
eq(document.activeElement, search, 'Mod+F goes to it');
type('mall');
waitFor(() => gridNames() === 'b_01.jpg', 'her name found');
search.value = '';
type('cyanocitta');
waitFor(() => gridNames() === 'c_01.jpg,c_02.jpg', 'a scientific name');
search.value = '';
type('d_01');
waitFor(() => gridNames() === 'd_01.jpg', 'a file name');
search.value = '';
type('jay');
waitFor(() => gridNames() === 'c_01.jpg,c_02.jpg', 'b_01 is no jay now');
press('escape');
waitFor(() => app.grid.items.length === 9 && search.value === '', 'Escape clears the search');

// ---- next to check: unanswered photos with an animal, never a spider ------------------
app.commands.run('animals-show-empty');
app.grid.select([at('a_01.jpg')]);
app.state.path = at('a_01.jpg');
const seen = [];
for (let i = 0; i < 12; i++) {
  press('u');
  advanceTime(16);
  seen.push(path.basename(app.state.path));
}
const visited = [...new Set(seen)].sort();
eq(visited, ['a_02.jpg', 'a_03.jpg', 'c_02.jpg', 'd_01.jpg', 'u_01.jpg', 'a_01.jpg'].sort(), 'every unanswered photo with an animal, round and round');
assert(!seen.includes('s_01.jpg'), 'never the spider');
assert(!seen.includes('b_01.jpg') && !seen.includes('c_01.jpg'), 'never one she answered');
assert(!seen.includes('e_01.jpg'), 'never one without an animal');

// ---- the analysis thrown away, the config changed: her answers stay ------------------
const before = fs.readFileSync(answersFile(bro.app.dataDir), 'utf-8');
fs.rmSync(cacheFile(bro.app.cacheDir, dir), { force: true });
const n0 = W.analysis.analysed;
const changed = stubTable([...TABLE, FROG, SPIDER]).map((e) => (e.color === JAY.color
  ? { ...e, species: [{ ...e.species[0], score: 0.97 }, ...e.species.slice(1)] } : e));
W.useStub(changed, { taxa: TAXA, names: MORE_NAMES });
waitFor(() => W.analysis.analysed >= n0 + 11 && W.analysis.state === 'done' && !W.analysis.groupTimer, 'analysed again', 30000);
eq(fs.readFileSync(answersFile(bro.app.dataDir), 'utf-8'), before, 'her answers file untouched');
waitFor(() => item('b_01.jpg') && item('b_01.jpg').tag === 'Mallard' && item('b_01.jpg').mine, 'her Mallard still shows');
eq([item('c_01.jpg').mine, item('c_02.jpg').conf], [true, 97], 'her confirmation stands; the guess has the new score');

// ---- a copy of the folder elsewhere: the same photos, her answers -----------------------
const copy = fixtureDir({});
for (const n of Object.keys(tree)) fs.copyFileSync(path.join(dir, n), path.join(copy, n));
base = copy;
app.openPath(copy);
waitFor(() => app.folder.dir === copy && app.folder.items.length === 11, 'the copy');
waitFor(() => W.answers.keys.size >= 22 && item('b_01.jpg') && item('b_01.jpg').mine, 'the copy\'s keys read', 20000);
eq(item('b_01.jpg').tag, 'Mallard', 'her answer follows the photo to another folder');
eq([mine('c_01.jpg').confirmed, mine('c_02.jpg')], [true, null], 'and her confirmation');

console.log('test_animals_answers_more PASSED');
}
