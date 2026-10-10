// Which formats open, and how: PNG, JPEG, GIF, BMP, ICO, WebP and TIFF
// decode on the decoder thread; an animated GIF plays as an <img>; SVG draws
// as a vector. A JPEG with an EXIF orientation shows upright, and its camera
// fields show in the details. Mod+C copies the picture as a PNG.

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';
import { png, jpeg, gif, animatedGif, bmp, ico, webp, svg, tiff, orientedJpeg, cameraJpeg, avif, heic, shown } from '/app/tests/images.js';
import { dialogFilter } from '/app/js/formats.js';

const path = require('path');

const dir = fixtureDir({
  'a.png': png(64, 40),
  'b.jpg': jpeg(64, 40),
  'c.gif': gif(),
  'c2.gif': animatedGif(),
  'd.bmp': bmp(30, 20),
  'e.ico': ico(32),
  'f.webp': webp(),
  'g.svg': svg(32, 24),
  'h.tif': tiff(8, 8),
  'rotated.jpg': orientedJpeg(60, 40, 6),
  'camera.jpg': cameraJpeg(32, 24),
});

const expect = {
  'a.png': [64, 40, 'bitmap'],
  'b.jpg': [64, 40, 'bitmap'],
  'c.gif': [1, 1, 'bitmap'],
  'c2.gif': [1, 1, 'animated'],
  'd.bmp': [30, 20, 'bitmap'],
  'e.ico': [32, 32, 'bitmap'],
  'f.webp': [1, 1, 'bitmap'],
  'g.svg': [32, 24, 'vector'],
  'h.tif': [8, 8, 'bitmap'],
  'rotated.jpg': [40, 60, 'bitmap'], // 60x40 stored, EXIF 6: shown 40 wide, 60 tall
};

app.openPath(dir);
waitFor(() => app.folder.items.length === 11, 'the folder listed');
assert(app.folder.items.some((it) => it.name === 'h.tif'), 'TIFF is listed');

for (const [name, [w, h, kind]] of Object.entries(expect)) {
  app.openImage(path.join(dir, name));
  shown(app, waitFor, name);
  const m = app.viewer.model();
  eq([m.width, m.height], [w, h], `${name} size`);
  if (kind) eq(m.kind, kind, `${name} is drawn as ${kind}`);
  assert(!app.state.error, `${name} shows without an error`);
}
eq(app.state.pic.orientation, 6, 'the EXIF orientation is read');

// An animation is a live <img> on the stage (bro plays it), not the canvas.
app.openImage(path.join(dir, 'c2.gif'));
shown(app, waitFor, 'c2.gif');
const live = document.querySelector('.iv-vector');
assert(!live.classList.contains('hidden') && live.getAttribute('src').endsWith('c2.gif'), 'the animation shows as an <img>');

// The camera's EXIF shows in the details panel.
app.openImage(path.join(dir, 'camera.jpg'));
shown(app, waitFor, 'camera.jpg');
eq(app.state.pic.exif.model, 'Canon EOS R5', 'the EXIF model is read');
app.commands.run('details');
const details = () => document.querySelector('.iv-details-body').textContent;
waitFor(() => details().includes('EOS R5'), 'the camera in the details');
assert(details().includes('f/2.8') && details().includes('400'), `aperture and ISO shown: ${details()}`);

// Mod+C copies the picture itself, as a PNG; Copy Path is its own command.
app.commands.run('copy');
waitFor(() => Array.from(document.querySelectorAll('.toast')).some((t) => t.textContent.includes('Copied the image')),
  'the image copied');
let copied = null;
navigator.clipboard.read().then(async (items) => {
  const blob = await items[0].getType('image/png');
  copied = bro.image.decodeOriented(new Uint8Array(await blob.arrayBuffer()));
}, (err) => { copied = { error: err.message }; });
waitFor(() => copied, 'the clipboard read');
eq([copied.width, copied.height], [32, 24], 'the clipboard holds the picture at full size');
app.commands.run('copy-path');
let text = null;
waitFor(() => { navigator.clipboard.readText().then((t) => { text = t; }); return text && text.endsWith('camera.jpg'); },
  'Copy Path puts the path on the clipboard');

// AVIF decodes on the decoder thread (bro's dav1d); HEIC through the system's
// decoder only. Where there is none, a HEIC is still listed, its tile is a
// placeholder, and opening it says why.
const heifDir = fixtureDir({ 'p.avif': avif(), 'q.heic': heic() });
app.openPath(heifDir);
waitFor(() => app.folder.items.length === 2, 'AVIF and HEIC listed');
const avifOk = bro.image.canDecode('image/avif') === 'probably';
if (avifOk) {
  app.openImage(path.join(heifDir, 'p.avif'));
  shown(app, waitFor, 'p.avif');
  eq([app.viewer.model().width, app.viewer.model().height], [64, 48], 'the AVIF size');
  eq(app.viewer.model().kind, 'bitmap', 'the AVIF is decoded on the decoder thread');
} else {
  console.log('test_formats: this bro has no AVIF decoder (BRO_WITH_AVIF off): skipping the AVIF open');
}
const heicSupport = bro.image.decodeSupport('image/heic');
app.openImage(path.join(heifDir, 'q.heic'));
if (heicSupport.supported) {
  shown(app, waitFor, 'q.heic');
  eq([app.viewer.model().width, app.viewer.model().height], [64, 48], 'the HEIC size');
  assert(!app.state.error, 'the HEIC shows without an error');
} else {
  waitFor(() => app.state.error, 'the HEIC error state');
  assert(app.state.error.includes(heicSupport.reason), `opening a HEIC says why: ${app.state.error}`);
  assert(document.querySelector('.iv-error').textContent.includes(heicSupport.reason), 'and the view shows it');
  assert(!dialogFilter().includes('heic'), 'the Open dialog does not offer HEIC');
  console.log(`test_formats: no HEIC decoder here (${heicSupport.reason})`);
}
assert(dialogFilter().includes('avif'), 'the Open dialog offers AVIF');

// A file that is not really an image: an error state, not an exception.
const bad = fixtureDir({ 'broken.png': 'this is not a PNG' });
app.openImage(path.join(bad, 'broken.png'));
waitFor(() => app.state.error, 'the error state');
assert(!document.querySelector('.iv-error').classList.contains('hidden'), 'the error shows in the view');
assert(document.querySelector('.statusbar').textContent.includes('Cannot show broken.png'), 'and in the status bar');

console.log('test_formats PASSED');
