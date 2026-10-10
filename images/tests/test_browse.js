// Acceptance 2: Next and Previous move through the folder's images in name
// order (numbers by value), skipping everything that is not an image, and
// wrap at both ends. Home and End go to the first and last; Space and
// Backspace step too; the strip follows and a click on it goes.

import { app, waitFor, eq, press, mod, clickEl, fixtureDir } from '/lib/test.js';
import { png, jpeg, tiff, shown } from '/app/tests/images.js';

const path = require('path');

const dir = fixtureDir({
  'img10.png': png(30, 20),
  'img2.jpg': jpeg(30, 20),
  'Apple.png': png(20, 30),
  'banana.PNG': png(20, 20),
  'notes.txt': 'not an image',
  'scan.tif': tiff(4, 4),             // bro cannot decode TIFF: not listed
  'sub/inner.png': png(10, 10),       // a folder, not an image
});
const order = ['Apple.png', 'banana.PNG', 'img2.jpg', 'img10.png'];

app.openPath(path.join(dir, 'banana.PNG'));
shown(app, waitFor, 'banana.PNG');
waitFor(() => app.folder.items.length === 4, 'the folder listed');
eq(app.folder.items.map((it) => it.name), order, 'images in name order, numbers by value, others skipped');

const at = () => path.basename(app.state.path);
const status = () => document.querySelector('.statusbar').textContent;

press('right');
eq(at(), 'img2.jpg', 'Right is the next image');
press('right');
eq(at(), 'img10.png', 'img10 after img2');
assert(status().includes('4 / 4'), `the position: ${status()}`);
press('right');
eq(at(), 'Apple.png', 'Next wraps from the last to the first');
press('left');
eq(at(), 'img10.png', 'Previous wraps from the first to the last');
press('pageup');
eq(at(), 'img2.jpg', 'Page Up is Previous');
press('pagedown');
eq(at(), 'img10.png', 'Page Down is Next');
press('home');
eq(at(), 'Apple.png', 'Home is the first');
press('end');
eq(at(), 'img10.png', 'End is the last');
press('space');
eq(at(), 'Apple.png', 'Space is Next');
press('backspace');
eq(at(), 'img10.png', 'Backspace is Previous');
shown(app, waitFor, 'img10.png', 'the last image decoded');

// The strip shows the folder with the current image highlighted.
waitFor(() => document.querySelectorAll('.iv-strip .vgrid-cell').length === 4, 'four cells in the strip');
const selected = () => Array.from(document.querySelectorAll('.iv-strip .vgrid-cell.selected')).map((c) => c.title);
eq(selected(), ['img10.png'], 'the strip highlights the image on screen');
clickEl(Array.from(document.querySelectorAll('.iv-strip .vgrid-cell')).find((c) => c.title === 'banana.PNG'));
eq(at(), 'banana.PNG', 'a click in the strip goes there');
shown(app, waitFor, 'banana.PNG');
eq(selected(), ['banana.PNG'], 'and the highlight follows');

// Mod+T hides and shows the strip, and the setting remembers.
const stripEl = document.querySelector('.iv-strip');
press(`${mod}+t`);
assert(stripEl.classList.contains('hidden'), 'Mod+T hides the strip');
eq(app.settings.get('showStrip'), false, 'showStrip is saved');
press(`${mod}+t`);
assert(!stripEl.classList.contains('hidden'), 'Mod+T shows it again');

console.log('test_browse PASSED');
