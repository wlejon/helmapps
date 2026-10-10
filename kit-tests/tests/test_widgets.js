// The kit's widgets driven through the engine's real input path:
// VirtualList (list and grid), menus, dialogs, controls, tabs, split panes.

import { eq, press, type, mod, clickEl, dblClickEl, rightClickEl, drag, center, menuLabels, chooseMenu,
  currentDialog, dialogButton, answerPrompt } from '/lib/test.js';
import { h } from '/lib/dom.js';
import { appFrame, Tabs, SplitPane, Sidebar } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { menu } from '/lib/menu.js';
import { confirmDialog, promptDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { Switch, Segmented, Select, Slider } from '/lib/controls.js';

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

// ---- VirtualList: list ------------------------------------------------------
const items = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `item ${String(i).padStart(5, '0')}` }));
let activated = null;
let ctx = null;
let selChanges = 0;
const list = new VirtualList({
  key: (it) => it.id,
  label: (it) => it.name,
  rowHeight: 30,
  columns: [{ id: 'name', label: 'Name', flex: 1, cell: (it) => it.name }, { id: 'id', label: 'ID', width: 80, align: 'right' }],
  onActivate: (sel) => { activated = sel.map((x) => x.id); },
  onContextMenu: (e, sel) => { ctx = sel.map((x) => x.id); },
  onSelectionChange: () => { selChanges++; },
});
ui.content.appendChild(list.el);
list.setItems(items);
advanceTime(32);

const rowsOnScreen = () => document.querySelectorAll('.vlist-row').length;
assert(rowsOnScreen() > 5 && rowsOnScreen() < 80, `only the visible rows exist: ${rowsOnScreen()}`);
const rowFor = (id) => Array.from(document.querySelectorAll('.vlist-row')).find((r) => r._item && r._item.id === id);

clickEl(rowFor(2));
eq(list.selectedItems().map((x) => x.id), [2], 'click selects one');
clickEl(rowFor(5), 'shift');
eq(list.selectedItems().map((x) => x.id), [2, 3, 4, 5], 'shift-click selects the range');
clickEl(rowFor(3), 'ctrl');
eq(list.selectedItems().map((x) => x.id), [2, 4, 5], 'ctrl-click toggles one off');
assert(selChanges >= 3, 'selection changes are reported');

press('end');
eq(list.selectedItems().map((x) => x.id), [9999], 'End goes to the last item');
assert(rowFor(9999), 'and scrolls it into view');
assert(rowsOnScreen() < 80, 'still only the visible rows after scrolling');
press('home');
press('down');
press('down');
eq(list.cursor, 2, 'arrow keys move the cursor');
press('shift+down');
eq(list.selectedItems().map((x) => x.id), [2, 3], 'shift+arrow extends');
press(`${mod}+a`);
eq(list.selectedItems().length, 10000, 'Mod+A selects all');
press('escape');
eq(list.selectedItems().length, 0, 'Escape clears');

type('item 0004');
eq(list.selectedItems().map((x) => x.id), [40], 'type-ahead jumps to the first match of what was typed');
press('enter');
eq(activated, [40], 'Enter activates the selection');
dblClickEl(rowFor(41));
eq(activated, [41], 'double-click activates');
rightClickEl(rowFor(43));
eq(ctx, [43], 'right-click on an unselected row selects it and asks for a menu');

// setItems with fresh objects: a row whose item kept its fields is kept, a
// changed one is rebuilt (a list refreshed several times a second stays cheap).
press('home');
const cellOf = (id) => rowFor(id) && rowFor(id).querySelector('.col');
const keptCell = cellOf(1);
const changedCell = cellOf(2);
list.setItems(items.map((it) => (it.id === 2 ? { id: 2, name: 'renamed' } : { ...it })));
advanceTime(16);
assert(cellOf(1) === keptCell, 'an unchanged row is not rebuilt');
assert(cellOf(2) !== changedCell && cellOf(2).textContent === 'renamed', 'a changed row is');

// Sortable header
let sortedBy = null;
const sl = new VirtualList({ key: (x) => x, columns: [{ id: 'a', label: 'A', sortable: true }], onSort: (id, dir) => { sortedBy = [id, dir]; } });
ui.content.appendChild(sl.el);
sl.setItems([{ a: 1 }, { a: 2 }]);
advanceTime(16);
clickEl(sl.header.querySelector('.col'));
eq(sortedBy, ['a', 1], 'first header click sorts ascending');
clickEl(sl.header.querySelector('.col'));
eq(sortedBy, ['a', -1], 'second reverses');
sl.destroy();

// Column dividers: dragging one sizes the fixed column beside the flexible
// one, header and rows alike; the widths come back to restore; double-click resets.
let resized = null;
const rl = new VirtualList({
  key: (x) => x.a,
  columns: [{ id: 'a', label: 'A', flex: 1 }, { id: 'b', label: 'B', width: 80 }, { id: 'c', label: 'C', width: 60 }],
  columnWidths: { c: 90 },
  onColumnResize: (w) => { resized = w; },
});
ui.content.appendChild(rl.el);
rl.setItems([{ a: 1, b: 2, c: 3 }]);
advanceTime(16);
const headCol = (i) => rl.header.querySelectorAll('.col')[i];
const rowCol = (i) => rl.el.querySelectorAll('.vlist-row .col')[i];
eq(Math.round(headCol(2).getBoundingClientRect().width), 90, 'saved widths are restored');
const grips = rl.header.querySelectorAll('.col-grip');
eq(grips.length, 2, 'a grip between each pair of columns, none after the last');
const [gx, gy] = center(grips[0]);
drag([gx, gy], [gx - 40, gy]);
eq(Math.round(headCol(1).getBoundingClientRect().width), 120, 'dragging left of a fixed column widens it');
eq(Math.round(rowCol(1).getBoundingClientRect().width), 120, 'and its cells with it');
eq(resized, { b: 120, c: 90 }, 'the new widths are reported');
dblClickEl(grips[0]);
eq(Math.round(headCol(1).getBoundingClientRect().width), 80, 'double-click resets');
// Between two fixed columns the divider follows the pointer: they trade width.
const divider = () => headCol(2).getBoundingClientRect().left;
const before = divider();
const [hx, hy] = center(grips[1]);
drag([hx, hy], [hx + 20, hy]);
eq([Math.round(headCol(1).getBoundingClientRect().width), Math.round(headCol(2).getBoundingClientRect().width)], [100, 70],
  'two fixed columns trade width');
eq(Math.round(divider() - before), 20, 'and the divider moved with the pointer');
rl.destroy();

// Tooltips: hovering a [data-tip] shows its text and key cap after a pause.
const { installTooltips } = await import('/lib/tooltip.js');
installTooltips();
const tipBtn = h('button.btn', { 'data-tip': 'Refresh', 'data-keys': 'F5' }, 'R');
ui.toolbar.appendChild(tipBtn);
advanceTime(16);
mouseMove(...center(tipBtn));
advanceTime(200);
assert(!document.querySelector('.tooltip'), 'no tooltip before the pause');
advanceTime(500);
const tipEl = document.querySelector('.tooltip');
assert(tipEl && tipEl.textContent.includes('Refresh') && tipEl.textContent.includes('F5'), 'the tooltip shows its label and keys');
press('escape');
assert(!document.querySelector('.tooltip'), 'a key hides it');
tipBtn.remove();

// ---- VirtualList: grid ------------------------------------------------------
list.setLayout('grid', { cellWidth: 100, cellHeight: 100 });
advanceTime(32);
const cols = list.columnsPerRow();
assert(cols >= 3, `a grid of several columns: ${cols}`);
const cells = document.querySelectorAll('.vgrid-cell');
assert(cells.length > 0 && cells.length < 200, `only the visible cells: ${cells.length}`);
list.scrollToIndex(0);
advanceTime(16);
clickEl(Array.from(document.querySelectorAll('.vgrid-cell')).find((c) => c._item && c._item.id === 0));
eq(list.cursor, 0, 'clicking a cell puts the cursor on it');
press('right');
eq(list.cursor, 1, 'Right in a grid moves one');
press('down');
eq(list.cursor, 1 + cols, 'Down in a grid moves a row');
list.setLayout('list');

// A fluid grid: the cells widen to fill the row edge to edge, square, no gaps,
// and a click lands on the cell under the pointer.
const wall = new VirtualList({ layout: 'grid', cellWidth: 150, fill: true, aspect: 1, gap: 0, padding: 0,
  key: (x) => x, render: (x, el) => { el.textContent = String(x); } });
ui.content.appendChild(wall.el);
wall.setItems(Array.from({ length: 100 }, (_, i) => i));
advanceTime(32);
const wallW = wall.scroller.clientWidth;
const wcols = wall.columnsPerRow();
const wcell = (i) => wall.pool.get(i).getBoundingClientRect();
const rowEnd = wcell(wcols - 1);
assert(Math.abs(rowEnd.right - wall.scroller.getBoundingClientRect().left - wallW) <= 1,
  `the last column reaches the edge: ${rowEnd.right} of ${wallW}`);
assert(wcell(0).width >= 150 && Math.abs(wcell(0).width - wcell(0).height) <= 1, `cells are at least cellWidth and square: ${wcell(0).width}x${wcell(0).height}`);
eq(Math.round(wcell(1).left - wcell(0).right), 0, 'no gap between cells');
clickEl(wall.pool.get(wcols + 1));
eq(wall.cursor, wcols + 1, 'a click lands on the cell under the pointer');
wall.destroy();

// ---- Menus ------------------------------------------------------------------
let chosen = null;
const anchor = h('button.btn', 'Menu');
ui.toolbar.appendChild(anchor);
advanceTime(16);
menu.showBelow([
  { heading: 'Things' },
  { label: 'Alpha', action: () => { chosen = 'alpha'; } },
  { label: 'Beta', disabled: true, action: () => { chosen = 'beta'; } },
  { separator: true },
  { label: 'More', submenu: [{ label: 'Gamma', action: () => { chosen = 'gamma'; } }] },
  { label: 'Delta', checked: true, action: () => { chosen = 'delta'; } },
], anchor);
advanceTime(16);
eq(menuLabels(), ['Alpha', 'Beta', 'More', 'Delta'], 'menu items');
press('down');
press('down');
press('enter');
eq(chosen, null, 'Down skips the disabled item; Enter on More opens its submenu instead of choosing');
eq(menuLabels(), ['Gamma'], 'the submenu is open');
press('enter');
eq(chosen, 'gamma', 'Enter in the submenu chooses');
assert(!menu.isOpen, 'choosing closes the menu');

menu.showBelow([{ label: 'Alpha', action: () => { chosen = 'a2'; } }, { label: 'Delta', action: () => { chosen = 'd2'; } }], anchor);
advanceTime(16);
press('d');
press('enter');
eq(chosen, 'd2', 'a letter jumps to the matching item');
menu.showBelow([{ label: 'Alpha', action: () => { chosen = 'a3'; } }], anchor);
advanceTime(16);
chooseMenu('Alpha');
eq(chosen, 'a3', 'clicking an item chooses it');
menu.showBelow([{ label: 'Alpha' }], anchor);
press('escape');
assert(!menu.isOpen, 'Escape closes');

// ---- Dialogs ----------------------------------------------------------------
let answer = 'pending';
confirmDialog({ title: 'Sure?', ok: 'Do It', danger: true }).then((v) => { answer = v; });
advanceTime(16);
assert(currentDialog(), 'a dialog is open');
dialogButton('Cancel');
advanceTime(16);
eq(answer, false, 'Cancel answers false');

confirmDialog({ title: 'Sure?' }).then((v) => { answer = v; });
advanceTime(16);
press('enter');
advanceTime(16);
eq(answer, true, 'Enter presses the primary button');

let name = 'pending';
promptDialog({ title: 'Name', value: 'old.txt', validate: (v) => (v.includes('/') ? 'No slashes' : '') }).then((v) => { name = v; });
advanceTime(16);
const input = currentDialog().body.querySelector('input');
eq(input.value, 'old.txt', 'the prompt starts with the value');
answerPrompt('a/b');
assert(currentDialog(), 'an invalid value keeps the prompt open');
answerPrompt('new.txt');
advanceTime(16);
eq(name, 'new.txt', 'a valid value answers it');

promptDialog({ title: 'Name' }).then((v) => { name = v; });
advanceTime(16);
press('escape');
advanceTime(16);
eq(name, null, 'Escape cancels a prompt with null');

// ---- Toast ------------------------------------------------------------------
let undone = false;
toast('Done', { action: 'Undo', onAction: () => { undone = true; } });
advanceTime(16);
clickEl(document.querySelector('.toast .btn'));
eq(undone, true, 'the toast action runs');
toast('Bye');
advanceTime(5000);
eq(document.querySelectorAll('.toast:not(.leaving)').length, 0, 'toasts leave on their own');

// ---- Controls ---------------------------------------------------------------
let sw = null;
const s = new Switch({ onChange: (v) => { sw = v; } });
let seg = null;
const g = new Segmented({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', onChange: (v) => { seg = v; } });
let sel = null;
const se = new Select({ options: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], value: 1, onChange: (v) => { sel = v; } });
let sl2 = null;
const slider = new Slider({ min: 0, max: 100, step: 10, value: 50, onChange: (v) => { sl2 = v; } });
const page = h('div.page', s.el, g.el, se.el, h('div', { style: { width: '200px', display: 'flex' } }, slider.el));
ui.content.prepend(page);
advanceTime(32);
clickEl(s.el);
eq(sw, true, 'switch on');
clickEl(g.el.querySelectorAll('button')[1]);
eq(seg, 'b', 'segmented');
clickEl(se.el);
chooseMenu('Two');
eq([sel, se.labelEl.textContent], [2, 'Two'], 'select');
slider.el.focus();
press('right');
eq(sl2, 60, 'slider steps by key');
const r = slider.el.getBoundingClientRect();
click(r.left + r.width * 0.2, r.top + r.height / 2, 0);
advanceTime(16);
eq(slider.value, 20, 'slider click sets the value, snapped to the step');
page.remove();

// ---- Tabs, SplitPane, Sidebar -------------------------------------------------
let active = null;
let closed = null;
const tabs = new Tabs({ onActivate: (id) => { active = id; }, onClose: (id) => { closed = id; } });
ui.content.prepend(tabs.el);
tabs.add({ id: 'a', label: 'a.txt' });
tabs.add({ id: 'b', label: 'b.txt' });
tabs.activate('a');
advanceTime(16);
clickEl(tabs.tabs.get('b').el);
eq(active, 'b', 'clicking a tab activates it');
clickEl(tabs.tabs.get('a').el.querySelector('.tab-close'));
eq(closed, 'a', 'the close button asks to close');
tabs.update('b', { dirty: true });
assert(tabs.tabs.get('b').el.classList.contains('dirty'), 'dirty mark');

const split = new SplitPane({ fixed: 'first', size: 200, min: 100, max: 400 });
ui.content.appendChild(split.el);
advanceTime(16);
const d = split.divider.getBoundingClientRect();
drag([d.left + 2, d.top + 20], [d.left + 52, d.top + 20]);
assert(Math.abs(split.size - 250) <= 2, `dragging the divider resizes: ${split.size}`);
drag([d.left + 52, d.top + 20], [d.left + 900, d.top + 20]);
eq(split.size, 400, 'clamped to max');

let picked = null;
const side = new Sidebar({ onSelect: (it) => { picked = it.id; } });
ui.sidebar.appendChild(side.el);
side.setSections([{ title: 'Places', items: [{ id: 'h', label: 'Home', icon: 'home' }, { id: 'd', label: 'Docs' }] }]);
advanceTime(16);
clickEl(side.rows.get('d'));
eq(picked, 'd', 'sidebar select');
assert(side.rows.get('d').classList.contains('selected'), 'and highlight');

console.log('test_widgets PASSED');
