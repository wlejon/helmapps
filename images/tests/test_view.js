// The view and the window: wheel zoom around the pointer, panning by drag,
// crisp pixels above 200%, the background setting, the details panel, full
// screen and the slideshow, opening by the Open command and by a drop.

import { app, waitFor, eq, press, mod, drag, center, fixtureDir, settle } from '/lib/test.js';
import { png, shown } from '/app/tests/images.js';

const path = require('path');

const dir = fixtureDir({ 'big.png': png(2400, 1600), 'next.png': png(300, 200), 'third.png': png(200, 300) });

// Open by the Open command: the native picker answers from setPickedFiles.
setPickedFiles([path.join(dir, 'big.png')]);
press(`${mod}+o`);
shown(app, waitFor, 'big.png', 'Mod+O opens the picked file');

// Wheel up zooms in around the pointer: the point under it stays put.
const stage = app.viewer.el.getBoundingClientRect();
const fit = app.viewer.model().scale;
const px = stage.left + stage.width * 0.25, py = stage.top + stage.height * 0.25;
wheel(px, py, -1);
advanceTime(16);
const z = app.viewer.model();
assert(z.scale > fit, `the wheel zoomed in (${fit} -> ${z.scale})`);
// The image point under the pointer, (p - centre) / scale, is unchanged on
// the axis the picture now overflows; on an axis it still fits it stays centred.
const axis = 2400 * z.scale > stage.width ? 'x' : 'y';
const [p, lo, len, pan] = axis === 'x' ? [px, stage.left, stage.width, z.panX] : [py, stage.top, stage.height, z.panY];
const before = ((p - lo) - len / 2) / fit;
const after = ((p - lo) - (len / 2 + pan)) / z.scale;
assert(Math.abs(before - after) < 1, `zoom kept the point under the pointer (${before.toFixed(1)} vs ${after.toFixed(1)})`);
if (axis === 'y' && 2400 * z.scale <= stage.width) eq(z.panX, 0, 'still centred across');
wheel(px, py, 1);
advanceTime(16);
assert(Math.abs(app.viewer.model().scale - fit) < 1e-6, 'wheel down zooms back out');

// Pan by dragging at 100% (bigger than the stage).
press(`${mod}+1`);
const p0 = app.viewer.model();
assert(app.viewer.el.classList.contains('pannable'), 'a picture bigger than the stage can be dragged');
const [cx, cy] = center(app.viewer.el);
drag([cx, cy], [cx - 150, cy - 100]);
const p1 = app.viewer.model();
assert(p1.panX < p0.panX - 100 && p1.panY < p0.panY - 50, `dragging panned (${p1.panX}, ${p1.panY})`);
drag([cx, cy], [cx + 5000, cy + 5000]);
const p2 = app.viewer.model();
eq([p2.panX, p2.panY], [(2400 - stage.width) / 2, (1600 - stage.height) / 2], 'panning stops at the picture\'s edges');

// Above 200%: crisp pixels.
press(`${mod}+=`); press(`${mod}+=`); press(`${mod}+=`);
assert(app.viewer.model().scale >= 3 && app.viewer.model().pixelated, 'above 200% pixels are drawn crisp');
press(`${mod}+0`);
assert(!app.viewer.model().pixelated, 'fitted, it is smooth');

// Background: dark, grey, checkerboard.
eq(app.viewer.el.dataset.bg, 'dark', 'dark by default');
app.commands.run('bg-checker');
eq(app.viewer.el.dataset.bg, 'checker', 'the checkerboard');
eq(app.settings.get('background'), 'checker', 'and remembered');

// Details panel.
const panel = document.querySelector('.iv-details').parentElement;
assert(panel.classList.contains('hidden'), 'details start hidden');
press(`${mod}+i`);
assert(!panel.classList.contains('hidden'), 'Mod+I shows the details');
waitFor(() => /2,400 × 1,600 pixels/.test(panel.textContent) && /PNG image/.test(panel.textContent), 'dimensions and type');
waitFor(() => /File size/.test(panel.textContent) && /Modified/.test(panel.textContent), 'size and modified time');
assert(panel.textContent.includes(dir), 'the folder');
press(`${mod}+i`);
assert(panel.classList.contains('hidden'), 'Mod+I hides them again');

// Full screen hides the chrome; Escape leaves it before it leaves the image.
press('f11');
eq(bro.window.fullscreen, true, 'F11 goes full screen');
assert(document.body.classList.contains('iv-fullscreen'), 'the chrome hides');
press('escape');
eq(bro.window.fullscreen, false, 'Escape leaves full screen');
eq(app.state.mode, 'image', 'and stays on the image');

// The slideshow: every 4 s, any key stops it.
eq(app.settings.get('slideshowSeconds'), 4, '4 s by default');
press('f5');
assert(app.presentation.running, 'F5 starts the slideshow');
eq(bro.window.fullscreen, true, 'full screen');
advanceTime(4100);
shown(app, waitFor, 'next.png', 'the next image after 4 s');
advanceTime(4100);
shown(app, waitFor, 'third.png', 'and the next');
press('a');
assert(!app.presentation.running, 'a key stops it');
eq(bro.window.fullscreen, false, 'and leaves full screen');
eq(path.basename(app.state.path), 'third.png', 'the key did nothing else');
settle(100);

// A drop opens the file.
const other = fixtureDir({ 'dropped.png': png(100, 80) });
dropFiles(cx, cy, [path.join(other, 'dropped.png')]);
shown(app, waitFor, 'dropped.png', 'a dropped image opens');
waitFor(() => app.folder.dir === other, 'its folder is the one browsed');

console.log('test_view PASSED');
