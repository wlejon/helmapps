// Acceptance 7: a new image written into the folder appears in the strip
// without a reload (where bro.vfs exists), and one removed from it goes.

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';
import { png, shown } from '/app/tests/images.js';

const fs = require('fs');
const path = require('path');

if (!(typeof bro !== 'undefined' && bro.vfs && bro.vfs.available !== false)) {
  skipTest('bro.vfs is not available here: no live folder refresh');
} else {
  const dir = fixtureDir({ 'a.png': png(40, 30), 'c.png': png(30, 40) });
  app.openPath(path.join(dir, 'a.png'));
  shown(app, waitFor, 'a.png');
  waitFor(() => app.strip.items.length === 2, 'the strip shows the folder');
  assert(app.folder.watching, 'the folder is watched');

  fs.writeFileSync(path.join(dir, 'b.png'), png(50, 50));
  waitFor(() => app.strip.items.length === 3, 'the new image in the strip', 15000);
  eq(app.strip.items.map((it) => it.name), ['a.png', 'b.png', 'c.png'], 'in name order');
  waitFor(() => document.querySelectorAll('.iv-strip .vgrid-cell').length === 3, 'its cell on screen');
  assert(document.querySelector('.statusbar').textContent.includes('1 / 3'), 'the count follows');

  // Not an image: ignored.
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
  fs.unlinkSync(path.join(dir, 'c.png'));
  waitFor(() => app.strip.items.length === 2, 'the removed image leaves the strip', 15000);
  eq(app.strip.items.map((it) => it.name), ['a.png', 'b.png'], 'the strip now');

  console.log('test_watch PASSED');
}
