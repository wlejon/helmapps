// A recording still running when the page goes (the window closed, Quit, an
// update to the app) is saved as Stop would save it: what was said is never
// lost to a close. Here the page reloads mid-recording, and the reloaded
// Recorder lists the recording, its audio and marker kept.

import { waitFor, settle, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

let app = window.app;
const dir = fixtureDir({});
app.settings.set('recordingsDir', dir);   // the reloaded page looks there too
await app.setRecordingsDir(dir);
eq(app.list.items.length, 0, 'starts with an empty library');

app.startRecording({ sampleRate: 16000, live: false, autoFeed: false });
const engRate = bro.mic && typeof bro.mic.engineRate === 'function' ? bro.mic.engineRate() : 48000;
const halfSec = new Float32Array(Math.round(engRate * 0.5));
for (let i = 0; i < halfSec.length; i++) halfSec[i] = 0.6 * Math.sin((2 * Math.PI * 440 * i) / engRate);
app.capture.feed(halfSec, engRate);
settle(60);
app.addMarker('Before the close');
assert(app.state.recording && app.capture.duration >= 0.45, `recording, ${app.capture.duration}s in`);

// The windowed frame loop (runFrames) is where a reload commits.
const before = app;
location.reload();
for (let i = 0; i < 40 && window.app === before; i++) runFrames(5, { stepMs: 16 });
assert(window.app !== before, 'the page reloaded');
app = window.app;

const wavs = fs.readdirSync(dir).filter((f) => f.endsWith('.wav'));
eq(wavs.length, 1, 'the recording was written as the page went');
const meta = JSON.parse(fs.readFileSync(path.join(dir, wavs[0].replace(/\.wav$/, '.json')), 'utf8'));
assert(meta.duration >= 0.45 && meta.duration < 1, `its audio kept (${meta.duration}s)`);
eq(meta.markers.map((m) => m.label), ['Before the close'], 'its marker kept');
waitFor(() => app.list && app.list.items.length === 1, 'the reloaded Recorder lists it');
eq(app.state.recording, false, 'and is not recording');

console.log('test_close_saves PASSED');
