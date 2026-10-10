// A long scan shows progress, leaves the window usable, and can be stopped:
// it keeps what it read, and the next scan reads only the rest.

import { app, waitFor, eq, fixtureDir, press, mod } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

// Big covers make the scan long (each is shrunk to 320 px on the worker).
const big = bro.image.encodeJpeg(new Uint8Array(1200 * 1200 * 4).fill(120), 1200, 1200, 4, 90);
const N = 160;
const tree = {};
for (let i = 0; i < N; i++) {
  tree[`Many/Album ${i}/01 Song.wav`] = wav(0.05, { info: { title: `Many ${i}`, artist: 'Many', album: `Album ${i}`, track: 1 } });
  tree[`Many/Album ${i}/cover.jpg`] = big;
}
useLibrary(app, fixtureDir(tree));
const read = () => app.library.songs().length;

// Progress in the sidebar, with a Stop button.
waitFor(() => app.library.progress && app.library.progress.parsed > 0, 'the scan to start');
const stop = document.querySelector('.mu-scan-stop');
assert(!stop.classList.contains('hidden') && !stop.disabled, 'a Stop button while scanning');
assert(document.querySelector('.mu-scan-text').textContent.startsWith('Scanning'), 'the sidebar says so');

// The window works meanwhile: switch to Songs, which fills in as records arrive.
press(`${mod}+1`);
waitFor(() => app.state.view === 'songs' && app.views.songs.items.length > 0, 'songs to show while scanning');

const t0 = perf.now();
app.commands.run('stop-scan');
assert(stop.disabled, 'Stop is disabled once pressed');
waitFor(() => !app.library.scanning, 'the scan to stop', 20000);
console.log(`stopped ${(perf.now() - t0).toFixed(0)} ms after Stop, with ${read()} of ${N} read`);
assert(read() > 0 && read() < N, `stopped part way (${read()} of ${N})`);
assert(!app.library.stopping, 'not stopping any more');
assert(stop.classList.contains('hidden'), 'the Stop button goes away');
eq(app.library.lastScan, null, 'a stopped scan is not a finished one');

// The next scan reads only the rest.
const had = read();
app.startScan();
waitFor(() => app.library.lastScan, 'the next scan to finish', 30000);
eq(app.library.lastScan.parsed, N - had, 'it reads only what the stopped one had not');
eq(read(), N, 'every song is in');

console.log('test_stop PASSED');
