// VirtualList beyond the basics (test_widgets has those): a hidden list paints
// nothing and catches up when shown, arrows with Alt/Ctrl/Meta pass through,
// drag (and Alt+arrow) to reorder, and the horizontal orientation.

import { eq, press, clickEl, center } from '/lib/test.js';
import { h } from '/lib/dom.js';
import { VirtualList } from '/lib/list.js';

const box = (w, hgt, left = 0, top = 0) => h('div', { style: {
  position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${hgt}px`,
  display: 'flex', flexDirection: 'column' } });
const cellsOf = (list, sel) => Array.from(list.spacer.querySelectorAll(sel));
const frames = (n) => { for (let i = 0; i < n; i++) advanceTime(16); };

// ---- hidden lists ------------------------------------------------------------------------
{
  const host = box(600, 400);
  host.style.display = 'none';
  document.body.appendChild(host);
  const items = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `album ${i}` }));
  const wall = new VirtualList({ layout: 'grid', cellWidth: 150, fill: true, aspect: 1, key: (x) => x.id, render: (it, el) => { el.textContent = it.name; } });
  host.appendChild(wall.el);
  wall.setItems(items);
  frames(3);
  eq(cellsOf(wall, '.vgrid-cell').length, 0, 'a fluid grid under display:none lays out no cells');
  wall.select([400]);                                   // made while hidden: applied when shown
  frames(2);
  eq(cellsOf(wall, '.vgrid-cell').length, 0, 'still none after a select while hidden');

  host.style.display = 'flex';
  frames(3);
  const shown = cellsOf(wall, '.vgrid-cell');
  assert(shown.length > 4 && shown.length < 80, `shown: only the cells on screen (${shown.length})`);
  const sel = shown.find((c) => c._item && c._item.id === 400);
  assert(sel && sel.classList.contains('selected'), 'the item selected while hidden is on screen and selected');
  const sr = wall.scroller.getBoundingClientRect();
  const cr = sel.getBoundingClientRect();
  assert(cr.top >= sr.top - 1 && cr.bottom <= sr.bottom + 1, 'and inside the view');

  // A 0-px pane is hidden too, and a pane given width again repaints.
  host.style.width = '0px';
  frames(2);
  wall.setItems(items.map((x) => ({ ...x, name: `${x.name}!` })));
  frames(2);
  assert(cellsOf(wall, '.vgrid-cell').every((c) => !c._item || !c._item.name.endsWith('!')), 'a 0 px wide grid paints nothing new');
  host.style.width = '600px';
  frames(3);
  const again = cellsOf(wall, '.vgrid-cell');
  assert(again.length > 4 && again.length < 80 && again.every((c) => c._item.name.endsWith('!')), 'widened again: the new items, only on screen');
  wall.destroy();
  host.remove();
}

// ---- refreshClasses: rowClass again, rows kept ----------------------------------------------------
{
  const host = box(400, 300);
  document.body.appendChild(host);
  let marked = 3;
  const list = new VirtualList({ key: (x) => x, rowHeight: 30, rowClass: (x) => (x === marked ? 'marked' : ''),
    columns: [{ id: 'n', label: 'N', flex: 1, cell: (x) => `row ${x}` }] });
  host.appendChild(list.el);
  list.setItems(Array.from({ length: 100 }, (_, i) => i));
  frames(2);
  const rows = () => cellsOf(list, '.vlist-row');
  const cellOf = (x) => rows().find((r) => r._item === x).querySelector('.col');
  const before = [cellOf(3), cellOf(5)];
  eq(rows().filter((r) => r.classList.contains('marked')).map((r) => r._item), [3], 'rowClass marks row 3');
  marked = 5;
  list.refreshClasses();
  eq(rows().filter((r) => r.classList.contains('marked')).map((r) => r._item), [5], 'refreshClasses moves the mark');
  assert(cellOf(3) === before[0] && cellOf(5) === before[1], 'without rebuilding the rows');
  list.destroy();
  host.remove();
}

// ---- arrows with Alt / Ctrl / Meta pass through ------------------------------------------------------
{
  const host = box(600, 400);
  document.body.appendChild(host);
  const grid = new VirtualList({ layout: 'grid', cellWidth: 100, cellHeight: 100, key: (x) => x, label: (x) => `n${x}` });
  host.appendChild(grid.el);
  grid.setItems(Array.from({ length: 60 }, (_, i) => i));
  frames(2);
  clickEl(cellsOf(grid, '.vgrid-cell').find((c) => c._item === 7));
  eq(grid.cursor, 7, 'a click puts the cursor on 7');
  const seen = [];
  const spy = (e) => { if (e.key.startsWith('Arrow')) seen.push(`${e.altKey ? 'Alt+' : ''}${e.ctrlKey ? 'Ctrl+' : ''}${e.key}:${e.defaultPrevented ? 'taken' : 'free'}`); };
  window.addEventListener('keydown', spy);
  press('alt+left');
  press('alt+right');
  press('ctrl+down');
  eq(grid.cursor, 7, 'the cursor did not move');
  eq(seen, ['Alt+ArrowLeft:free', 'Alt+ArrowRight:free', 'Ctrl+ArrowDown:free'], 'they reach the window untaken (Back gets Alt+Left)');
  seen.length = 0;
  press('left');
  eq(grid.cursor, 6, 'a plain arrow still moves');
  eq(seen, ['ArrowLeft:taken'], 'and is taken');
  window.removeEventListener('keydown', spy);
  grid.destroy();
  host.remove();
}

// ---- drag to reorder ----------------------------------------------------------------------------
{
  const host = box(500, 300, 20, 20);
  document.body.appendChild(host);
  let model = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `row ${i}` }));
  const moves = [];
  let allow = true;
  const list = new VirtualList({
    key: (x) => x.id, label: (x) => x.name, rowHeight: 30,
    columns: [{ id: 'name', label: 'Name', flex: 1 }],
    reorderable: () => allow,
    onReorder: (from, to) => {
      moves.push([from, to]);
      const m = model.slice();
      m.splice(to, 0, ...m.splice(from, 1));
      model = m;
      list.setItems(model.map((x) => ({ ...x })));     // the app's fresh rows, as an app does
    },
  });
  host.appendChild(list.el);
  list.setItems(model);
  frames(2);
  const ids = () => list.items.map((x) => x.id);
  const rowOf = (id) => cellsOf(list, '.vlist-row').find((r) => r._item && r._item.id === id);

  // Press row 2, drag into the upper half of row 5: it lands above row 5.
  const [x0, y0] = center(rowOf(2));
  const r5 = rowOf(5).getBoundingClientRect();
  mouseDown(x0, y0, 0);
  advanceTime(16);
  mouseMove(x0, y0 + 2);                               // under the threshold: no drag yet
  advanceTime(16);
  eq(list.spacer.querySelectorAll('.vlist-drop').length, 0, 'no marker for a press that has not moved');
  mouseMove(x0, r5.top + 6);
  advanceTime(16);
  const marker = list.spacer.querySelector('.vlist-drop');
  assert(marker, 'dragging shows a drop marker');
  assert(list.el.classList.contains('reordering'), 'the list says it is reordering');
  mouseUp(x0, r5.top + 6, 0);
  advanceTime(16);
  eq(moves, [[2, 4]], 'onReorder(from, to) with the index it now has');
  eq(ids().slice(0, 6), [0, 1, 3, 4, 2, 5], 'row 2 sits above row 5');
  eq(list.selectedItems().map((x) => x.id), [2], 'the moved row is selected');
  eq(list.spacer.querySelectorAll('.vlist-drop').length, 0, 'the marker is gone');
  assert(!list.el.classList.contains('reordering'), 'and the reordering state');

  // A click (no movement) does not reorder.
  clickEl(rowOf(0));
  eq(moves.length, 1, 'a plain click does not reorder');

  // Held near the bottom edge, the list scrolls; let go past it.
  const sr = list.scroller.getBoundingClientRect();
  const [ax, ay] = center(rowOf(1));
  mouseDown(ax, ay, 0);
  advanceTime(16);
  mouseMove(ax, ay + 20);
  advanceTime(16);
  mouseMove(ax, sr.bottom - 4);
  frames(40);
  const scrolled = list.scroller.scrollTop;
  assert(scrolled > 200, `the list scrolls while the pointer is at the edge (${scrolled})`);
  mouseMove(ax, sr.top + sr.height / 2);
  frames(5);
  const held = list.scroller.scrollTop;
  frames(5);
  eq(list.scroller.scrollTop, held, 'and stops when it leaves the edge');
  mouseUp(ax, sr.top + sr.height / 2, 0);
  advanceTime(16);
  const to = ids().indexOf(1);
  assert(to > 10, `row 1 moved down to where it was let go (${to})`);
  eq(moves[moves.length - 1], [1, to], 'reported');
  const r1 = rowOf(1).getBoundingClientRect();
  assert(r1.top >= sr.top - 1 && r1.bottom <= sr.bottom + 1, 'and it is in view');

  // Alt+Down / Alt+Up move the cursor's row by one.
  list.select([3]);
  advanceTime(16);
  const at = ids().indexOf(3);
  list.focus();
  press('alt+down');
  eq(ids().indexOf(3), at + 1, 'Alt+Down moves it down');
  press('alt+up');
  press('alt+up');
  eq(ids().indexOf(3), at - 1, 'Alt+Up moves it up');
  eq(list.cursor, at - 1, 'the cursor follows it');
  list.select([ids()[0]]);
  advanceTime(16);
  const n = moves.length;
  press('alt+up');
  eq(moves.length, n, 'Alt+Up on the first row does nothing');

  // Not reorderable just now (a filter is on): no drag, no keyboard move.
  allow = false;
  const before = ids().join();
  const [bx, by] = center(rowOf(ids()[1]));
  mouseDown(bx, by, 0);
  advanceTime(16);
  mouseMove(bx, by + 60);
  advanceTime(16);
  eq(list.spacer.querySelectorAll('.vlist-drop').length, 0, 'no marker when reordering is off');
  mouseUp(bx, by + 60, 0);
  advanceTime(16);
  press('alt+down');
  eq(ids().join(), before, 'nothing moved');
  list.destroy();
  host.remove();
}

// ---- horizontal -----------------------------------------------------------------------------------
{
  const host = box(600, 90, 10, 400);
  document.body.appendChild(host);
  const items = Array.from({ length: 300 }, (_, i) => ({ id: i, name: `pic ${i}` }));
  let picked = null;
  const strip = new VirtualList({
    orientation: 'horizontal', cellWidth: 88, cellHeight: 76, padding: 4, multiSelect: false,
    key: (x) => x.id, label: (x) => x.name, scrollAlign: 'center',
    render: (it, el) => { el.textContent = it.name; },
    onSelectionChange: (sel) => { picked = sel[0] ? sel[0].id : null; },
  });
  host.appendChild(strip.el);
  strip.setItems(items);
  frames(2);
  const cells = () => cellsOf(strip, '.vgrid-cell');
  assert(cells().length > 5 && cells().length < 20, `only the cells on screen (${cells().length})`);
  const c0 = cells().find((c) => c._item.id === 0).getBoundingClientRect();
  const c1 = cells().find((c) => c._item.id === 1).getBoundingClientRect();
  eq(Math.round(c1.left - c0.left), 88, 'cells run left to right, a cell width apart');
  eq(Math.round(c1.top - c0.top), 0, 'in one row');
  eq(strip.spacer.getBoundingClientRect().width, 4 * 2 + 300 * 88, 'the strip is as wide as its items');

  clickEl(cells().find((c) => c._item.id === 3));
  eq(picked, 3, 'a click picks its cell');
  press('right');
  eq(picked, 4, 'Right moves to the next');
  press('down');
  eq(picked, 4, 'Down is not a strip key');
  press('end');
  eq(picked, 299, 'End goes to the last');
  assert(strip.scroller.scrollLeft > 20000, `and scrolls there (${strip.scroller.scrollLeft})`);
  const last = cells().find((c) => c._item.id === 299);
  assert(last, 'the last cell is on screen');
  assert(cells().length < 20, 'still only the cells on screen');

  // A click after scrolling picks the cell under the pointer.
  const target = cells().find((c) => c._item.id === 295);
  clickEl(target);
  eq(picked, 295, 'a click on a scrolled strip picks the right cell');

  // Centring: a jump brings the item to the middle.
  strip.select([150]);
  advanceTime(16);
  const sr = strip.scroller.getBoundingClientRect();
  const mid = cells().find((c) => c._item.id === 150).getBoundingClientRect();
  assert(Math.abs((mid.left + 88 / 2) - (sr.left + sr.width / 2)) < 2,      // the cell's slot (it is drawn 6 px narrower: the gap)
    `scrollAlign center centres it (cell ${mid.left}+${mid.width}, strip ${sr.left}+${sr.width}, scrollLeft ${strip.scroller.scrollLeft})`);

  // A plain wheel scrolls it sideways.
  const left0 = strip.scroller.scrollLeft;
  wheel(sr.left + 100, sr.top + 40, 3);
  frames(3);
  assert(strip.scroller.scrollLeft > left0, `the wheel scrolls it sideways (${left0} -> ${strip.scroller.scrollLeft})`);

  // Hidden, then a select: shown again, the item is in view.
  host.style.display = 'none';
  advanceTime(16);
  strip.select([20]);
  advanceTime(16);
  host.style.display = 'flex';
  frames(3);
  const c20 = cells().find((c) => c._item.id === 20);
  assert(c20 && c20.classList.contains('selected'), 'the item picked while hidden is on screen when shown');
  const r20 = c20.getBoundingClientRect();
  const sr2 = strip.scroller.getBoundingClientRect();
  assert(r20.left >= sr2.left - 1 && r20.right <= sr2.right + 1, 'inside the strip');

  // Reorder sideways, by keyboard and by drag.
  const moves = [];
  const rs = new VirtualList({ orientation: 'horizontal', cellWidth: 80, cellHeight: 60, key: (x) => x, label: (x) => `c${x}`,
    reorderable: true, onReorder: (from, to) => moves.push([from, to]), render: (it, el) => { el.textContent = `c${it}`; } });
  const host2 = box(600, 80, 10, 500);
  document.body.appendChild(host2);
  host2.appendChild(rs.el);
  rs.setItems([0, 1, 2, 3, 4, 5]);
  frames(2);
  const rcell = (x) => cellsOf(rs, '.vgrid-cell').find((c) => c._item === x);
  clickEl(rcell(1));
  press('alt+right');
  eq(rs.items, [0, 2, 1, 3, 4, 5], 'Alt+Right moves the item right');
  const [dx, dy] = center(rcell(0));
  const r4 = rcell(4).getBoundingClientRect();
  mouseDown(dx, dy, 0);
  advanceTime(16);
  mouseMove(dx + 10, dy);
  advanceTime(16);
  assert(rs.spacer.querySelector('.vlist-drop.vertical'), 'a vertical drop marker');
  mouseMove(r4.right - 6, dy);
  advanceTime(16);
  mouseUp(r4.right - 6, dy, 0);
  advanceTime(16);
  eq(rs.items, [2, 1, 3, 4, 0, 5], 'dragged past 4');
  eq(moves, [[1, 2], [0, 4]], 'both reported');
  rs.destroy();
  strip.destroy();
  host.remove();
  host2.remove();
}

console.log('test_list PASSED');
