// Acceptance 5 and 8: opening a folder shows the grid with one cell per
// image, and Enter (or a double-click) on a cell opens it; Escape from an
// image returns to the grid with that image selected.

import { app, waitFor, eq, press, clickEl, dblClickEl, fixtureDir } from '/lib/test.js';
import { png, jpeg, svg, shown } from '/app/tests/images.js';

const path = require('path');

const dir = fixtureDir({
  'a.png': png(64, 48, [220, 60, 60]),
  'b.jpg': jpeg(48, 64, [60, 200, 60]),
  'c.svg': svg(),
  'd.png': png(32, 32, [60, 60, 220]),
  'readme.md': '# not an image',
});

app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.grid.items.length === 4, 'the grid of the folder');
const cells = () => Array.from(document.querySelectorAll('.iv-grid .vgrid-cell'));
waitFor(() => cells().length === 4, 'four cells on screen');
eq(cells().map((c) => c.title), ['a.png', 'b.jpg', 'c.svg', 'd.png'], 'one cell per image, in name order');
eq(document.title, `${path.basename(dir)} — Image Viewer`, 'the title names the folder');
assert(document.querySelector('.statusbar').textContent.includes('4 images'), 'the status bar counts them');

// Previews arrive (bro.thumb, or the decoder thread without it).
waitFor(() => cells().every((c) => c.querySelector('.iv-thumb img, .iv-thumb .icon')), 'a preview in every cell');
assert(cells().filter((c) => c.querySelector('.iv-thumb img')).length >= 3, 'the images have real previews');

// Select the second cell and press Enter.
clickEl(cells()[1]);
eq(app.grid.selectedItems().map((it) => it.name), ['b.jpg'], 'click selects');
press('enter');
shown(app, waitFor, 'b.jpg', 'Enter opens the image');
assert(document.querySelector('.iv-grid').classList.contains('hidden'), 'the grid gives way to the view');

// Escape: back to the grid, with b.jpg selected.
press('right');
shown(app, waitFor, 'c.svg', 'Next onto the SVG');
eq(app.viewer.model().kind, 'vector', 'an SVG is drawn as a vector');
press('escape');
waitFor(() => app.state.mode === 'grid', 'Escape returns to the grid');
eq(app.grid.selectedItems().map((it) => it.name), ['c.svg'], 'the image just shown is selected');

// Double-click opens too.
dblClickEl(cells().find((c) => c.title === 'd.png'));
shown(app, waitFor, 'd.png', 'a double-click opens the image');

// The grid's toolbar button returns as Escape does.
clickEl(document.querySelector('[data-command="show-folder"]'));
waitFor(() => app.state.mode === 'grid', 'the Show Folder button');
eq(app.grid.selectedItems().map((it) => it.name), ['d.png'], 'with d.png selected');

console.log('test_grid PASSED');
