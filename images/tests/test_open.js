// Acceptance 1, 3 and 4: opening an image shows it fitted, with the title and
// the status bar right; Zoom In twice then Fit returns to the fitted scale and
// 100% is a scale of 1; rotating four times comes back to 0° and never
// touches the file.

import { app, waitFor, eq, press, mod, fixtureDir } from '/lib/test.js';
import { png, shown } from '/app/tests/images.js';

const fs = require('fs');
const path = require('path');

// Before anything is open: the start state offers Open.
assert(document.querySelector('.iv-start') && !document.querySelector('.iv-start').classList.contains('hidden'),
  'the start state shows');
eq(document.title, 'Image Viewer', 'the bare title');

// Bigger than the stage, so the fit scales it down.
const dir = fixtureDir({ 'photo.png': png(3000, 2000), 'small.png': png(40, 30) });
const file = path.join(dir, 'photo.png');
const before = fs.readFileSync(file);

app.openPath(file);
shown(app, waitFor, 'photo.png');
eq(document.title, 'photo.png — Image Viewer', 'the title names the image');
const m = app.viewer.model();
eq([m.width, m.height], [3000, 2000], 'the picture size');
assert(m.fit && m.scale < 1, `fitted below 100% (scale ${m.scale})`);
const stage = app.viewer.el.getBoundingClientRect();
assert(Math.abs(3000 * m.scale - stage.width) < 1 || Math.abs(2000 * m.scale - stage.height) < 1,
  'fit fills the stage on one axis');
const status = () => document.querySelector('.statusbar').textContent;
assert(status().includes('3,000 × 2,000'), `the status bar shows the dimensions: ${status()}`);
assert(status().includes(`${Math.round(m.scale * 100)}%`), `the status bar shows the zoom: ${status()}`);
waitFor(() => status().includes('1 / 2'), 'the position in the folder');

// Zoom In twice, then Fit.
const fit = m.scale;
press(`${mod}+=`);
press(`${mod}+=`);
const zoomed = app.viewer.model();
assert(!zoomed.fit && zoomed.scale > fit, `zoomed in (scale ${zoomed.scale})`);
press(`${mod}+0`);
eq(app.viewer.model().scale, fit, 'Fit returns to the fitted scale');
eq(app.viewer.model().fit, true, 'and is fitted again');

// 100%.
press(`${mod}+1`);
eq(app.viewer.model().scale, 1, 'Mod+1 is a scale of 1');
assert(status().includes('100%'), 'the status bar says 100%');
press(`${mod}+-`);
assert(app.viewer.model().scale < 1, 'Zoom Out goes below 100%');

// The zoom menu offers the fixed levels and Fit.
document.querySelector('.iv-zoom').click();
advanceTime(16);
const labels = Array.from(document.querySelectorAll('.menu .menu-text')).map((e) => e.textContent);
for (const l of ['Fit to Window', '25%', '50%', '100%', '200%', '400%']) assert(labels.includes(l), `zoom menu has ${l}: ${labels}`);
press('escape');

// Rotate four times.
press(`${mod}+0`);
press('r');
eq(app.viewer.model().rotation, 90, 'R turns right');
assert(status().includes('view only'), `the status bar says the turn is the view only: ${status()}`);
press('r'); press('r'); press('r');
eq(app.viewer.model().rotation, 0, 'four turns are a full turn');
press('shift+r');
eq(app.viewer.model().rotation, 270, 'Shift+R turns left');
press('h');
eq(app.viewer.model().flipH, true, 'H flips horizontally');
press('v');
eq(app.viewer.model().flipV, true, 'V flips vertically');
const after = fs.readFileSync(file);
eq(after.length, before.length, 'the file kept its size');
assert(Buffer.compare ? Buffer.compare(before, after) === 0 : before.every((b, i) => b === after[i]), 'the file on disk is unchanged');

// A small image fits at 100%, never blown up.
app.openPath(path.join(dir, 'small.png'));
shown(app, waitFor, 'small.png');
eq(app.viewer.model().scale, 1, 'a small image shows at 100%');
eq(app.viewer.model().rotation, 0, 'a new image starts upright');

console.log('test_open PASSED');
