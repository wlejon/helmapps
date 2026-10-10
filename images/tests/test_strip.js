// The thumbnail strip on a folder too long to show at once: it scrolls
// sideways (keys, a plain wheel), a click picks the picture under the
// pointer, and the current picture stays in view, also when the strip was
// hidden while the picture changed.

import { app, waitFor, eq, press, mod, clickEl, fixtureDir } from '/lib/test.js';
import { png, shown } from '/app/tests/images.js';

const path = require('path');

const tree = {};
const names = [];
for (let i = 1; i <= 60; i++) {
  const name = `pic${String(i).padStart(2, '0')}.png`;
  tree[name] = png(16, 12, [i * 4, 100, 200 - i * 3]);
  names.push(name);
}
const dir = fixtureDir(tree);

app.openPath(path.join(dir, names[0]));
shown(app, waitFor, names[0]);
waitFor(() => app.strip.items.length === 60, 'the strip lists the folder');

const sc = app.strip.scroller;
const cells = () => Array.from(document.querySelectorAll('.iv-strip .vgrid-cell'));
const at = () => path.basename(app.state.path);
const cellOf = (name) => cells().find((c) => c.title === name);
const inView = (name) => {
  const c = cellOf(name);
  if (!c) return false;
  const r = c.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  return r.left >= s.left - 1 && r.right <= s.right + 1;
};
waitFor(() => cells().length > 0, 'cells in the strip');
assert(cells().length < 40, `only the cells on screen (${cells().length} of 60)`);
eq(sc.scrollLeft, 0, 'starts at the left');

// End: the last picture, and the strip scrolls to it.
press('end');
eq(at(), names[59], 'End goes to the last picture');
waitFor(() => inView(names[59]), 'the last cell in view');
assert(sc.scrollLeft > 1000, `the strip scrolled sideways (${sc.scrollLeft})`);

// A click on a cell of the scrolled strip opens that picture.
const target = cells().map((c) => c.title).filter((t) => inView(t) && t !== names[59])[0];
assert(target, 'a visible cell to click');
clickEl(cellOf(target));
eq(at(), target, `a click on the scrolled strip opens ${target}`);
shown(app, waitFor, target);

// A plain wheel scrolls the strip sideways.
const left0 = sc.scrollLeft;
const s = sc.getBoundingClientRect();
wheel(s.left + 200, s.top + s.height / 2, -4);
waitFor(() => sc.scrollLeft < left0, 'the wheel scrolls the strip back');

// Home: back to the start, in view.
press('home');
eq(at(), names[0], 'Home is the first');
waitFor(() => inView(names[0]), 'the first cell in view');

// Hidden while the picture changes; shown again, the current one is in view.
press(`${mod}+t`);
assert(document.querySelector('.iv-strip').classList.contains('hidden'), 'Mod+T hides the strip');
for (let i = 0; i < 40; i++) press('right');
eq(at(), names[40], 'forty pictures on');
press(`${mod}+t`);
waitFor(() => inView(names[40]), 'shown again, the current picture is in view');
assert(cellOf(names[40]).classList.contains('selected'), 'and highlighted');

console.log('test_strip PASSED');
