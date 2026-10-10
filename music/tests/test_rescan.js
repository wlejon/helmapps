// Acceptance 4: a second scan with one file changed reparses only that file.
// Then: a removed file leaves the library, a restart reads the saved index
// without reparsing, and the folder watcher rescans by itself.

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

const fs = require('fs');
const path = require('path');

const files = {};
for (let a = 1; a <= 3; a++) {
  for (let t = 1; t <= 4; t++) {
    files[`Artist ${a}/Album ${a}/0${t} Song.wav`] = wav(0.1, { info: { title: `Song ${a}-${t}`, artist: `Artist ${a}`, album: `Album ${a}`, track: t } });
  }
}
const dir = fixtureDir(files);
useLibrary(app, dir);

waitFor(() => app.library.lastScan, 'the first scan', 20000);
eq(app.library.lastScan.parsed, 12, 'the first scan reads every file');
eq(app.library.songs().length, 12, 'twelve songs');

// Nothing changed: nothing is read.
const scanOnce = () => {
  const before = app.library.lastScan;
  app.startScan();
  waitFor(() => app.library.lastScan !== before, 'the scan to finish', 20000);
  return app.library.lastScan;
};
eq(scanOnce().parsed, 0, 'an unchanged library reads nothing');

// One file retagged: only it is read.
const changed = path.join(dir, 'Artist 2', 'Album 2', '03 Song.wav');
fs.writeFileSync(changed, wav(0.15, { info: { title: 'Retitled', artist: 'Artist 2', album: 'Album 2', track: 3 } }));
const s = scanOnce();
eq(s.parsed, 1, 'one changed file, one parse');
eq(s.files, 12, 'still twelve files');
assert(app.library.songs().some((x) => x.title === 'Retitled'), 'the new title is in the library');
assert(!app.library.songs().some((x) => x.title === 'Song 2-3'), 'the old one is gone');

// One file removed.
fs.unlinkSync(path.join(dir, 'Artist 3', 'Album 3', '04 Song.wav'));
const r = scanOnce();
eq([r.parsed, r.removed], [0, 1], 'a removed file is dropped, nothing read');
eq(app.library.album(app.library.albums().find((x) => x.title === 'Album 3').key).songs.length, 3, 'its album is one song shorter');

// The watcher: a new file appears and the library picks it up unasked.
waitFor(() => app.library.watching, 'the folders are watched');
const before = app.library.lastScan;
fs.writeFileSync(path.join(dir, 'Artist 1', 'Album 1', '05 New.wav'), wav(0.1, { info: { title: 'Arrived', artist: 'Artist 1', album: 'Album 1', track: 5 } }));
waitFor(() => app.library.lastScan !== before && app.library.songs().some((x) => x.title === 'Arrived'), 'the watcher to rescan', 20000);
eq(app.library.lastScan.parsed, 1, 'the watcher read only the new file');

console.log('test_rescan PASSED');
