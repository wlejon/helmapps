// Music stays responsive: how long the window took to show, and the worst
// frame while (1) a library of 1500 songs is scanned for the first time
// (the window fills in as it goes), (2) it is scanned again with nothing
// changed, (3) the views are browsed, the album grid scrolled end to end and
// a search typed, and (4) songs are started and skipped. docs/performance.md
// says how to read these numbers and what to do when one is over budget.

import { app, waitFor, measureFrames, eq, fixtureDir, press, type, mod } from '/lib/test.js';
import { wav, flacWithComments, useLibrary } from '/app/tests/fixtures.js';

const FRAME_BUDGET_MS = 50;   // generous for a shared test box; a healthy frame is a few ms

const report = (what, f) => console.log(`${what}: ${f.frames} frames, worst ${f.maxMs.toFixed(1)} ms, ` +
  `mean ${f.avgMs.toFixed(1)} ms, ${f.slow} over 16.7 ms`);
const budget = (what, f) => assert(f.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms ${what} (worst ${f.maxMs.toFixed(1)})`);

// ---- startup ---------------------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `the first frame follows the load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- a library of 1500 songs: 100 artists, 5 albums each, 3 songs an album ---------------
let t0 = perf.now();
const tree = {};
const tone = wav(0.05);
const cover = bro.image.encodeJpeg(new Uint8Array(400 * 400 * 4).fill(140), 400, 400, 4, 85);
let n = 0;
for (let a = 0; a < 100; a++) {
  for (let b = 0; b < 5; b++) {
    const dir = `Artist ${a}/Album ${a}-${b}`;
    if (b < 2) tree[`${dir}/cover.jpg`] = cover;     // 200 album covers to shrink
    for (let t = 1; t <= 3; t++) {
      const title = `Song ${a}-${b}-${t}`;
      tree[`${dir}/0${t} ${title}.${(n++ % 2) ? 'flac' : 'wav'}`] = (n % 2)
        ? tone
        : flacWithComments({ TITLE: title, ARTIST: `Artist ${a}`, ALBUM: `Album ${a}-${b}`, TRACKNUMBER: String(t) }, { seconds: 180 + t });
    }
  }
}
const lib = fixtureDir(tree);
console.log(`fixture: ${n} songs and 200 covers in ${(perf.now() - t0).toFixed(0)} ms`);
useLibrary(app, lib);

// The first scan, from nothing; the album grid is on screen the whole time.
t0 = perf.now();
const first = measureFrames(() => app.library.lastScan && !app.library.scanning, 'the first scan', 120000);
const scan = app.library.lastScan;
report(`first scan of ${scan.files} files (${scan.parsed} parsed, worker ${scan.ms.toFixed(0)} ms: parsing ${scan.parseMs} ms, ` +
  `yielding ${scan.waitMs} ms; ${(perf.now() - t0).toFixed(0)} ms in all)`, first);
budget('during the first scan', first);
eq(app.library.songs().length, 1500, 'every song is in');
eq(app.library.albums().length, 500, 'every album');

// Again, nothing changed: nothing parsed.
const before = app.library.lastScan;
app.startScan();
const again = measureFrames(() => app.library.lastScan !== before, 'the rescan', 60000);
report(`rescan, nothing changed (${app.library.lastScan.parsed} parsed, worker ${app.library.lastScan.ms.toFixed(0)} ms)`, again);
eq(app.library.lastScan.parsed, 0, 'nothing reparsed');
budget('rescanning', again);

// ---- browsing ---------------------------------------------------------------------------
const views = ['Mod+1', 'Mod+2', 'Mod+3', 'Mod+4', 'Mod+5', 'Mod+2'];
let k = 0;
const switching = measureFrames(() => {
  if (k < views.length) { press(views[k++].replace('Mod', mod).toLowerCase()); return false; }
  return true;
}, 'switching views');
report('switching between every view', switching);
budget('switching views', switching);

const grid = app.views.albums;
const scrolling = measureFrames(() => {
  const sc = grid.scroller;
  if (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1) { sc.scrollTop += sc.clientHeight / 2; return false; }
  return true;
}, 'the album grid scrolled to the end', 60000);
report(`album grid of ${grid.items.length}, scrolled end to end`, scrolling);
budget('scrolling the album grid', scrolling);

press(`${mod}+1`);
press(`${mod}+f`);
const typing = measureFrames((() => {
  const text = 'song 42-3';
  let i = 0;
  return () => {
    if (i < text.length) { type(text[i++]); return false; }
    return app.views.songs.items.length === 3;
  };
})(), 'typing a search');
report('typing a search over 1500 songs', typing);
budget('typing a search', typing);
press('escape');

// ---- playing ----------------------------------------------------------------------------------
app.playSongs(app.library.songs(), 0);
let skips = 0;
const skipping = measureFrames(() => {
  if (skips < 20) { app.player.next(); skips++; return false; }
  return app.player.playing;
}, 'skipping through 20 songs');
report('starting and skipping 20 songs', skipping);
budget('skipping songs', skipping);

console.log('test_perf PASSED');
