// Performance & responsiveness tests for Sound Recorder:
// 1. Startup time budget (`firstFrameMs - loadedMs < 250`).
// 2. Live recording waveform rendering + marker drops (`maxMs < 50`).
// 3. Loading, browsing, scrolling, sorting, and searching a library of 500 recordings (`maxMs < 50`).

import { app, measureFrames, eq, fixtureDir } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;

// ---- 1. Startup check --------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports firstFrameMs');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `first frame follows load within 250 ms (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- 2. Live recording waveform rendering under measureFrames ----------------
const emptyDir = fixtureDir({});
await app.setRecordingsDir(emptyDir);

app.startRecording({ sampleRate: 16000, live: false, autoFeed: true });
let recFrameCount = 0;
const liveStats = measureFrames(() => {
  recFrameCount++;
  if (recFrameCount === 15) app.addMarker('Beat 1');
  if (recFrameCount === 30) app.addMarker('Beat 2');
  if (recFrameCount === 45) app.addMarker('Beat 3');
  return recFrameCount >= 60;
}, '60 frames of live recording waveform visualization');

console.log(`live recording: ${liveStats.frames} frames, worst ${liveStats.maxMs.toFixed(1)} ms, mean ${liveStats.avgMs.toFixed(1)} ms, ${liveStats.slow} over 16.7 ms`);
assert(liveStats.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms during live recording (worst ${liveStats.maxMs.toFixed(1)} ms)`);
app.cancelRecording();

// ---- 3. Library of 500 recordings: load, scroll, search, sort ----------------
const t0 = perf.now();
const smallWav = app.wav.encodeWav(new Float32Array(320), 16000, 1);
const tree = {};
const baseTime = Date.now() - 500 * 60000;
const peaks = new Array(64).fill(0.35);

for (let i = 0; i < 500; i++) {
  const pad = String(i).padStart(3, '0');
  tree[`rec_${pad}.wav`] = smallWav;
  tree[`rec_${pad}.json`] = JSON.stringify({
    title: `Voice Note ${pad}`,
    createdAt: baseTime + i * 60000,
    duration: 5 + (i % 120),
    sampleRate: 16000,
    markers: i % 5 === 0 ? [{ timeSec: 2.0, label: `Highlight ${i}` }] : [],
    transcript: i % 10 === 0 ? `Meeting summary item number ${i}` : '',
    peaks,
  });
}
const bigDir = fixtureDir(tree);
console.log(`fixture: 500 recordings written in ${(perf.now() - t0).toFixed(0)} ms`);

let loadFinished = false;
app.setRecordingsDir(bigDir).then(() => { loadFinished = true; });

const loadStats = measureFrames(() => loadFinished && app.list.items.length === 500, 'loading 500 recordings');
console.log(`load 500 recordings: ${loadStats.frames} frames, worst ${loadStats.maxMs.toFixed(1)} ms, mean ${loadStats.avgMs.toFixed(1)} ms`);
assert(loadStats.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while loading 500 recordings (worst ${loadStats.maxMs.toFixed(1)} ms)`);

// Browse, scroll, sort, and search across the 500 recordings
let step = 0;
const browseStats = measureFrames(() => {
  step++;
  if (step <= 20) {
    app.list.scrollToIndex(step * 24);
  } else if (step === 22) {
    app.state.sort = { id: 'duration', dir: -1 };
    app.setSearchQuery('');
  } else if (step === 25) {
    app.setSearchQuery('Highlight');
  } else if (step === 28) {
    app.setSearchQuery('Meeting summary');
  } else if (step === 31) {
    app.setSearchQuery('');
  }
  return step >= 35 && app.list.items.length === 500;
}, 'browsing, scrolling, sorting, and searching 500 recordings');

console.log(`browse 500 recordings: ${browseStats.frames} frames, worst ${browseStats.maxMs.toFixed(1)} ms, mean ${browseStats.avgMs.toFixed(1)} ms, ${browseStats.slow} over 16.7 ms`);
assert(browseStats.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms while browsing 500 recordings (worst ${browseStats.maxMs.toFixed(1)} ms)`);
eq(app.list.items.length, 500, 'all 500 recordings listed');

console.log('test_perf PASSED');
