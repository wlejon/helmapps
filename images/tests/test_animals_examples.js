// Her examples across folders (js/wildlife/examples.js): an animal she names
// in one folder is "looks like your Blue Jay" in another, because each named
// crop's embedding is kept in the data dir (examples.json and the float32
// rows it names), not only in the folder's cache. The store follows her
// answers: a revert or a Remove takes the crop out, an undo puts it back;
// at most PER_NAME of one name, the latest.

import { app, waitFor, eq, clickEl, fixtureDir } from '/lib/test.js';
import { stubTable, analysed, photo, JAY, CARDINAL, TABLE, MORE_NAMES, TAXA } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';
import { Examples, examplesFile, PER_NAME } from '/app/js/wildlife/examples.js';

const fs = require('fs');
const path = require('path');

if (typeof bro === 'undefined' || !bro.vision || !bro.vision.wildlife || typeof bro.vision.wildlife.nearest !== 'function') {
  skipTest('this bro has no bro.vision.wildlife.nearest');
} else run();

function run() {
const dirA = fixtureDir({
  // Minutes apart: two photos, not a burst.
  'a_jay.jpg': photo({ time: 100, animal: JAY }),
  'a_card.jpg': photo({ time: 400, animal: CARDINAL }),
});
const dirB = fixtureDir({
  'b_jay.jpg': photo({ time: 700, animal: JAY }),
});
const W = app.wildlife;
const O = W.outlines;
const store = W.examplesStore;
W.useStub(stubTable(TABLE), { taxa: TAXA, names: MORE_NAMES });
app.settings.set('showOutlines', true);   // every outline (off by default)

const openFolder = (dir, n) => {
  app.openPath(dir);
  waitFor(() => app.state.mode === 'grid' && app.folder.dir === dir && app.folder.items.length === n, `folder ${path.basename(dir)}`);
  analysed(app, waitFor);
  waitFor(() => W.answers.keys.size >= n && W.analysis.embeddings.size === n, 'keys and crop embeddings');
};
const open = (dir, n) => { app.openImage(path.join(dir, n)); shown(app, waitFor, n); advanceTime(16); };
const outline = () => document.querySelector('.iv-outlines .iv-outline');
const picker = () => {
  waitFor(() => O.state().boxes.length === 1, 'an outline');
  clickEl(outline());
  waitFor(() => O.state().picker, 'the picker');
  return O.state().picker.chips;
};
const lookalike = () => {
  const c = picker().find((x) => x.kind === 'lookalike');
  O.close();
  return c ? c.text : null;
};
const settle = () => { for (let i = 0; i < 5; i++) advanceTime(16); };

// ---- nothing named anywhere yet ------------------------------------------------------------
openFolder(dirB, 1);
waitFor(() => store.loaded, 'the store read');
open(dirB, 'b_jay.jpg');
eq(lookalike(), null, 'no example: no lookalike');

// ---- she names the jay in folder A -----------------------------------------------------------
openFolder(dirA, 2);
open(dirA, 'a_jay.jpg');
picker();
clickEl(document.querySelector('.iv-picker .iv-chip.sure'));
waitFor(() => W.answers.of(path.join(dirA, 'a_jay.jpg')), 'named');
waitFor(() => store.entries.length === 1, 'one example kept');
const ex = store.entries[0];
eq([ex.name, ex.scientific, ex.rank, ex.file, ex.model], ['Blue Jay', 'Cyanocitta cristata', 'species', 'a_jay.jpg', 'stub'], 'its name and source');
eq(ex.key, W.answers.keys.get(path.join(dirA, 'a_jay.jpg')) || ex.key, 'keyed by the file');
waitFor(() => fs.existsSync(examplesFile(bro.app.dataDir)), 'the index in the data dir');
const index = () => JSON.parse(fs.readFileSync(examplesFile(bro.app.dataDir), 'utf-8'));
waitFor(() => index().entries.length === 1, 'written');
const rowsFile = path.join(path.dirname(examplesFile(bro.app.dataDir)), index().rows);
eq(fs.statSync(rowsFile).size, ex.emb.length * 4, 'the embedding as float32 rows');

// ---- in folder B, the jay looks like hers --------------------------------------------------
openFolder(dirB, 1);
open(dirB, 'b_jay.jpg');
eq(lookalike(), 'Looks like your Blue Jay', 'an example from another folder');

// A second start reads the same store.
const again = new Examples({ dataDir: bro.app.dataDir, worker: W.answers.worker });
again.load();
waitFor(() => again.entries.length === 1, 'read back');
assert(again.entries[0].emb.every((v, i) => Math.abs(v - ex.emb[i]) < 1e-7), 'the same embedding');

// ---- revert, undo and Remove in folder A keep it in step --------------------------------------
openFolder(dirA, 2);
open(dirA, 'a_jay.jpg');
app.commands.run('animal-revert');
waitFor(() => !W.answers.of(path.join(dirA, 'a_jay.jpg')), 'reverted');
settle();
waitFor(() => store.entries.length === 0, 'the revert takes the example out');
waitFor(() => index().entries.length === 0, 'and from the file');
// Her answers' toasts are one toast (the naming's replaced by the revert's), its Undo the revert's.
const toasts = Array.from(document.querySelectorAll('.toast[data-toast-key="answers"]:not(.leaving)'));
eq(toasts.length, 1, 'one toast for her answers, not one a save');
clickEl(Array.from(toasts[0].querySelectorAll('button')).find((b) => b.textContent === 'Undo'));
waitFor(() => W.answers.of(path.join(dirA, 'a_jay.jpg')), 'undone');
waitFor(() => store.entries.length === 1, 'the undo puts it back');// Remove: gone.
waitFor(() => O.state().boxes.length === 1 && O.state().boxes[0].kind === 'mine', 'her outline again');
picker();
const acts = Array.from(document.querySelectorAll('.iv-picker-acts button')).map((b) => b.textContent);
assert(acts.includes('Remove'), `the picker's actions: ${acts.join()}`);
clickEl(Array.from(document.querySelectorAll('.iv-picker-acts button')).find((b) => b.textContent === 'Remove'));
waitFor(() => W.answers.of(path.join(dirA, 'a_jay.jpg')).answer.none, 'removed');
waitFor(() => store.entries.length === 0, 'a removed animal is no example');
openFolder(dirB, 1);
open(dirB, 'b_jay.jpg');
eq(lookalike(), null, 'nothing to look like any more');

// ---- at most PER_NAME of a name, the latest --------------------------------------------------
const calls = [];
const capped = new Examples({ dataDir: path.join(bro.app.dataDir, 'cap-test'), worker: { call: async (m) => { calls.push(m.op); return {}; } } });
const emb = new Float32Array([1, 0, 0]);
const many = [];
for (let i = 0; i < PER_NAME + 3; i++) {
  many.push({ key: `k${i}`, model: 'm', entries: [{ box: [0, 0, 1, 1], name: 'Blue Jay', scientific: 'Cyanocitta cristata', rank: 'species',
    at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), time: 0, file: `${i}.jpg`, emb }] });
}
many.push({ key: 'x', model: 'm', entries: [{ box: [0, 0, 1, 1], name: 'Northern Cardinal', at: '2025-01-01T00:00:00.000Z', time: 0, file: 'x.jpg', emb }] });
assert(capped.sync(many), 'a change');
eq(capped.entries.length, PER_NAME + 1, `${PER_NAME} jays and the cardinal`);
eq(capped.entries.filter((e) => e.name === 'Blue Jay').map((e) => e.key).sort().join(),
  many.slice(3, PER_NAME + 3).map((p) => p.key).sort().join(), 'the latest jays');
assert(!capped.sync(many), 'the same answers again change nothing');
settle();
eq(calls.filter((c) => c === 'exSave').length, 1, 'and save nothing');

console.log('test_animals_examples PASSED');
}
