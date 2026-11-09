// A reload (an edit to the app's source, F5) puts back what was on screen: the
// photo, zoomed, panned and turned as it was, rather than the last folder's
// grid; and a folder's grid with the same photo selected (app.keep, lib/app.js).

import { waitFor, eq, fixtureDir } from '/lib/test.js';
import { png, shown } from '/app/tests/images.js';

const path = require('path');

const dir = fixtureDir({ 'big.png': png(2400, 1600), 'small.png': png(300, 200) });

// The windowed frame loop (runFrames) is where a reload commits; advanceTime
// alone never lets it, since this script runs in the realm being replaced.
function reload() {
  const before = window.app;
  location.reload();
  for (let i = 0; i < 40 && window.app === before; i++) runFrames(5, { stepMs: 16 });
  assert(window.app !== before, 'the page reloaded');
  return window.app;
}

let app = window.app;
app.openPath(path.join(dir, 'big.png'));
shown(app, waitFor, 'big.png', 'the photo opens');
app.viewer.rotate(90);
app.viewer.zoomTo(1.5, { x: 100, y: 80 });
const was = app.viewer.model();
assert(!was.fit && was.rotation === 90, `zoomed and turned before the reload (${JSON.stringify(was)})`);

app = reload();
shown(app, waitFor, 'big.png', 'the same photo is back');
waitFor(() => !app.viewer.pic.placeholder, 'the full picture, not its preview');
eq(app.state.mode, 'image', 'the photo view, not the grid');
const now = app.viewer.model();
eq([now.fit, now.scale, now.rotation, Math.round(now.panX), Math.round(now.panY)],
   [false, was.scale, 90, Math.round(was.panX), Math.round(was.panY)],
   'its zoom, turn and pan are as they were');

// The grid, a photo selected: the grid comes back with it selected.
app.openFolder(dir, { select: path.join(dir, 'small.png') });
waitFor(() => app.folder.items.length === 2, 'the folder lists');
app = reload();
waitFor(() => app.state.mode === 'grid' && app.folder.dir === dir && app.folder.items.length === 2,
        'the folder grid is back');
eq(app.state.path, path.join(dir, 'small.png'), 'with the same photo selected');

console.log('test_reload_keeps PASSED');
