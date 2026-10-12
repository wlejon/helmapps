// The kit's Combobox through the engine's real input path: suggestions as
// you type, the strong first one preselected, Up / Down, Enter (and
// Shift+Enter) commits, free text commits with no item, Tab completes,
// Escape cancels, a click on a suggestion commits it, the list sits under
// the field and the app's shortcuts never see the keys it handles.

import { eq, press, type, clickEl } from '/lib/test.js';
import { h } from '/lib/dom.js';
import { appFrame } from '/lib/layout.js';
import { Combobox } from '/lib/combobox.js';

const ui = appFrame({ toolbar: false });
document.body.appendChild(ui.frame);

const FRUIT = ['Apple', 'Apricot', 'Avocado', 'Banana', 'Blackberry', 'Blueberry', 'Cherry'];
// Starts of the name are strong; a letter inside it is a weak match (not preselected).
const suggest = (text) => {
  const q = text.trim().toLowerCase();
  const starts = FRUIT.filter((f) => f.toLowerCase().startsWith(q)).map((f) => ({ label: f, detail: 'fruit', value: f, strong: true }));
  const inside = FRUIT.filter((f) => !f.toLowerCase().startsWith(q) && f.toLowerCase().includes(q)).map((f) => ({ label: f, value: f }));
  return [...starts, ...inside];
};

let commits = [], cancels = 0, appKeys = 0;
window.addEventListener('keydown', () => { appKeys++; });
function field(value = '') {
  const cb = new Combobox({ value, placeholder: 'Fruit', suggest, onCommit: (c) => commits.push(c), onCancel: () => { cancels++; } });
  ui.content.replaceChildren(h('div', { style: 'padding: 40px; width: 300px' }, cb.el));
  advanceTime(16);
  clickEl(cb.input);
  return cb;
}
const listRows = () => Array.from(document.querySelectorAll('.combobox-list:not(.hidden) .combobox-item'));
const labels = () => listRows().map((r) => r.querySelector('.menu-text').textContent);
const activeLabel = () => { const a = listRows().find((r) => r.classList.contains('active')); return a ? a.querySelector('.menu-text').textContent : null; };

// Typing suggests; a strong first suggestion is highlighted and Enter takes it.
let cb = field();
type('ap');
eq(labels(), ['Apple', 'Apricot'], 'the starts of names');
eq(activeLabel(), 'Apple', 'the strong first one is highlighted');
const lr = document.querySelector('.combobox-list').getBoundingClientRect();
const fr = cb.input.getBoundingClientRect();
assert(lr.top >= fr.bottom && lr.left <= fr.left + 1 && lr.width >= fr.width - 1, 'the list sits under the field, as wide');
assert(document.querySelector('.combobox-list .combobox-detail').textContent === 'fruit', 'a detail beside the label');
press('down');
eq(activeLabel(), 'Apricot', 'Down moves the highlight');
press('down');
eq(activeLabel(), null, 'past the end: nothing highlighted');
press('up');
eq(activeLabel(), 'Apricot', 'Up comes back from the end');
appKeys = 0;
press('enter');
eq(commits.length, 1, 'Enter commits');
eq([commits[0].item.value, commits[0].text, commits[0].shiftKey], ['Apricot', 'ap', false], 'the highlighted suggestion, the text typed');
eq(appKeys, 0, 'the app\'s keydown listeners never saw Enter');
eq(listRows().length, 0, 'and the list is gone');

// A weak match is not preselected: Enter commits the text as typed, with no item.
commits = [];
cb = field();
type('err');
eq(labels(), ['Blackberry', 'Blueberry', 'Cherry'], 'matches inside the names');
eq(activeLabel(), null, 'nothing preselected for a weak match');
press('enter');
eq([commits[0].item, commits[0].text], [null, 'err'], 'free text');

// Free text nothing matches; Shift+Enter says so.
commits = [];
cb = field();
type('kumquat');
eq(labels(), [], 'no suggestions');
press('shift+enter');
eq([commits[0].item, commits[0].text, commits[0].shiftKey], [null, 'kumquat', true], 'Shift+Enter commits with shiftKey');

// Tab completes the highlighted suggestion and keeps editing.
commits = [];
cb = field();
type('bla');
press('tab');
eq(cb.value, 'Blackberry', 'Tab puts the label in the field');
eq(commits.length, 0, 'without committing');
assert(document.activeElement === cb.input, 'the field keeps the focus');

// Escape cancels.
press('escape');
eq([cancels, commits.length], [1, 0], 'Escape cancels');
eq(listRows().length, 0, 'the list goes');

// The value given is selected, so typing replaces it; a click on a suggestion commits it.
commits = [];
cb = field('Cherry');
cb.focus();
eq([cb.input.selectionStart, cb.input.selectionEnd], [0, 6], 'focus() selects the text');
type('b');
eq(cb.value, 'b', 'typing replaces it');
eq(labels(), ['Banana', 'Blackberry', 'Blueberry'], 'and suggests for the new text');
clickEl(listRows()[2]);
eq([commits.length, commits[0].item && commits[0].item.value], [1, 'Blueberry'], 'a click commits that suggestion');

console.log('test_combobox PASSED');
