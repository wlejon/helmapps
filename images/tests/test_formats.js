// Which formats open, and how: PNG, JPEG, GIF, BMP and ICO decode on the
// decoder thread; WebP on the page; SVG draws as a vector. TIFF does not
// decode in bro, so it is not listed (GAPS.md). A JPEG with an EXIF
// orientation shows upright.

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';
import { png, jpeg, gif, bmp, ico, webp, svg, tiff, orientedJpeg, shown } from '/app/tests/images.js';

const path = require('path');

const dir = fixtureDir({
  'a.png': png(64, 40),
  'b.jpg': jpeg(64, 40),
  'c.gif': gif(),
  'd.bmp': bmp(30, 20),
  'e.ico': ico(32),
  'f.webp': webp(),
  'g.svg': svg(32, 24),
  'h.tif': tiff(8, 8),
  'rotated.jpg': orientedJpeg(60, 40, 6),
});

const expect = {
  'a.png': [64, 40, 'bitmap'],
  'b.jpg': [64, 40, 'bitmap'],
  'c.gif': [1, 1, null],          // 1x1: bro.image answers its "could not decode" size; the page decodes it
  'd.bmp': [30, 20, 'bitmap'],
  'e.ico': [32, 32, 'bitmap'],
  'f.webp': [1, 1, 'img'],
  'g.svg': [32, 24, 'vector'],
  'rotated.jpg': [40, 60, 'bitmap'], // 60x40 stored, EXIF 6: shown 40 wide, 60 tall
};

app.openPath(dir);
waitFor(() => app.folder.items.length === 8, 'the folder listed');
assert(!app.folder.items.some((it) => it.name === 'h.tif'), 'TIFF is not listed: bro cannot decode it');

for (const [name, [w, h, kind]] of Object.entries(expect)) {
  app.openImage(path.join(dir, name));
  shown(app, waitFor, name);
  const m = app.viewer.model();
  eq([m.width, m.height], [w, h], `${name} size`);
  if (kind) eq(m.kind, kind, `${name} is drawn as ${kind}`);
  assert(!app.state.error, `${name} shows without an error`);
}
eq(app.state.pic.orientation, 6, 'the EXIF orientation is read');

// A file that is not really an image: an error state, not an exception.
const bad = fixtureDir({ 'broken.png': 'this is not a PNG' });
app.openImage(path.join(bad, 'broken.png'));
waitFor(() => app.state.error, 'the error state');
assert(!document.querySelector('.iv-error').classList.contains('hidden'), 'the error shows in the view');
assert(document.querySelector('.statusbar').textContent.includes('Cannot show broken.png'), 'and in the status bar');

console.log('test_formats PASSED');
