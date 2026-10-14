// Screenshot UI & workflow acceptance tests:
// 1. Unavailable screencopy empty state on boot, while Open Image still works
// 2. Full Screen capture with synthetic source produces Result view of source size
// 3. Save writes a PNG of the right dimensions with dated filename to saveFolder
// 4. --full CLI launch saves directly without showing the result view

import { app, waitFor, settle, eq, press, clickEl, fixtureDir, mod } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const dir = fixtureDir({});
app.settings.set('saveFolder', dir);

// 1. In headless mode, Wayland screencopy is unavailable by default.
eq(app.hasScreencopy(), false, 'screencopy unavailable in headless');
const unavail = document.querySelector('.ss-unavail');
assert(unavail && !unavail.classList.contains('hidden'), 'capture unavailable empty state is visible');
assert(unavail.textContent.includes('unavailable'), 'empty state explains capture is unavailable');

// Create a 120x80 fixture PNG on disk and verify Open Image works even without screencopy.
const samplePath = path.join(dir, 'sample.png');
const sampleSrc = app.createSyntheticSource(120, 80, [40, 90, 160, 255]);
assert(
  bro.image.encodePngFile(samplePath, sampleSrc.pixels, 120, 80, 4),
  'wrote fixture sample.png'
);

await app.openImageFile(samplePath);
waitFor(() => app.state.view === 'result' && app.state.image, 'Result view after openImageFile');
eq([app.state.image.width, app.state.image.height], [120, 80], 'opened image dimensions');

// Return to Home view via New Screenshot command (Mod+N).
press(`${mod}+n`);
waitFor(() => app.state.view === 'home', 'back to Home view');

// 2. Install a 640x400 synthetic capture source and capture Full Screen.
app.setCaptureSource(() => app.createSyntheticSource(640, 400));
app.settings.set('mode', 'full');
app.settings.set('delay', 0);
assert(unavail.classList.contains('hidden'), 'unavailable state hides once capture source is available');

clickEl(document.querySelector('.ss-take-btn'));
waitFor(() => app.state.view === 'result' && app.state.image && app.state.image.width === 640, 'Full Screen capture result');
eq([app.state.image.width, app.state.image.height], [640, 400], 'Result view matches source size 640x400');

// 3. Save (Mod+S) writes a dated PNG of 640x400 to the configured folder.
const savedPath = await app.saveScreenshot();
assert(savedPath && fs.existsSync(savedPath), 'saved PNG exists on disk');
const savedName = path.basename(savedPath);
assert(
  /^Screenshot \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/.test(savedName),
  `dated filename matches pattern: ${savedName}`
);
const fileBytes = fs.readFileSync(savedPath);
const dims = bro.image.probeDimensions(new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength));
eq([dims.width, dims.height], [640, 400], 'probeDimensions on saved PNG matches 640x400');

// 4. --full launch saves directly without showing the result view.
press(`${mod}+n`);
waitFor(() => app.state.view === 'home', 'back to Home view before --full');
const fullDir = fixtureDir({});
app.settings.set('saveFolder', fullDir);

await app.handleLaunch({ argv: ['--full'], first: false });
settle(50);
eq(app.state.view, 'home', '--full did not switch to result view');
const files = fs.readdirSync(fullDir).filter((f) => f.endsWith('.png'));
eq(files.length, 1, '--full wrote one PNG to saveFolder');
assert(document.querySelector('.toast'), '--full showed a saved toast');

console.log('test_ui PASSED');
