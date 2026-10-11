// Choosing a burst's frames in the strip: Select Subject selects the photo's
// own burst (by EXIF time, gaps cut it), Shift+click extends the range from
// the photo, Ctrl+click toggles one frame, neither changes the photo on
// screen, and a plain click still opens a photo.

import { app, waitFor, eq, press, clickEl, fixtureDir } from '/lib/test.js';
import { shown } from '/app/tests/images.js';
import { burstTree, defaultBurst, base } from '/app/tests/burst.js';

const path = require('path');

const frames = defaultBurst(4, 4);
const dir = fixtureDir(burstTree(frames, { w: 320, h: 240, r: 16 }));
const names = frames.map((f) => f.name);

app.openPath(path.join(dir, names[1]));
shown(app, waitFor, names[1]);
waitFor(() => app.strip.items.length === 8, 'the strip lists the burst');

const selected = () => app.strip.selectedItems().map((it) => it.name);
const cell = (name) => Array.from(document.querySelectorAll('.iv-strip .vgrid-cell')).find((c) => c.title === name);
waitFor(() => cell(names[7]), 'every cell on screen');

// S: Select Subject; the strip selects the photo's burst (the first four, the gap ends it).
press('s');
assert(app.burst.picking, 'S turns on Select Subject');
assert(!document.querySelector('.iv-subject-bar').classList.contains('hidden'), 'its bar shows');
waitFor(() => selected().length === 4, 'the burst is selected');
eq(selected().join(), names.slice(0, 4).join(), 'the photo\'s own burst');
eq(base(app.state.path), names[1], 'the photo stays');

// Shift+click: the range from the photo to the frame clicked.
clickEl(cell(names[5]), 'shift');
eq(selected().join(), names.slice(1, 6).join(), 'Shift+click selects from the photo to the frame');
eq(base(app.state.path), names[1], 'Shift+click does not open the frame');

// Ctrl+click toggles a frame out and back in.
clickEl(cell(names[3]), 'ctrl');
eq(selected().join(), [names[1], names[2], names[4], names[5]].join(), 'Ctrl+click leaves a frame out');
clickEl(cell(names[3]), 'ctrl');
eq(selected().length, 5, 'and puts it back');
eq(base(app.state.path), names[1], 'the photo still stays');

// Ctrl+click on the photo itself keeps it: it is always one of the frames.
clickEl(cell(names[1]), 'ctrl');
assert(selected().includes(names[1]), 'the photo on screen stays selected');
eq(app.burst.framePaths().map(base).join(), names.slice(1, 6).join(), 'the frames to stabilize, in folder order');

// A plain click opens a photo (and the subject tool selects that photo's burst).
clickEl(cell(names[6]));
shown(app, waitFor, names[6]);
waitFor(() => selected().length === 4 && selected()[0] === names[4], 'the other burst is selected');
eq(selected().join(), names.slice(4).join(), 'the second burst');

// Escape (on the photo; in the strip it clears the strip's selection) leaves Select Subject, not the photo.
app.viewer.el.focus();
press('escape');
assert(!app.burst.picking, 'Escape stops selecting the subject');
eq(app.state.mode, 'image', 'and stays on the photo');

console.log('test_burst_select PASSED');
