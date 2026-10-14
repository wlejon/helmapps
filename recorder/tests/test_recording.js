// End-to-end recording capture tests:
// Starting capture in a fixture directory, feeding synthetic audio via bro.mic,
// adding markers via API and 'M' shortcut, pausing and resuming, stopping & saving,
// and verifying the .wav file and .json sidecar on disk.

import { app, waitFor, settle, eq, press, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const dir = fixtureDir({});
await app.setRecordingsDir(dir);
eq(app.list.items.length, 0, 'starts with an empty fixture library');

// ---- 1. Start recording, feed synthetic audio, drop markers, pause/resume, save ----
app.startRecording({ sampleRate: 16000, live: false, autoFeed: false });
eq(app.state.recording, true, 'recording state is active');
eq(app.state.paused, false, 'recording starts unpaused');

const engRate = (typeof bro !== 'undefined' && bro.mic && typeof bro.mic.engineRate === 'function')
  ? bro.mic.engineRate()
  : 48000;

// Feed 0.5 seconds of 440 Hz sine at engineRate via capture.feed (which feeds bro.mic)
const halfSec = new Float32Array(Math.round(engRate * 0.5));
for (let i = 0; i < halfSec.length; i++) {
  halfSec[i] = 0.6 * Math.sin((2 * Math.PI * 440 * i) / engRate);
}
app.capture.feed(halfSec, engRate);
settle(60);

assert(app.capture.duration >= 0.45, `recorded duration after 0.5s feed is ${app.capture.duration}`);
assert(app.capture.rollingPeaks.length > 0, 'rolling waveform peaks populated');

// Drop a marker via API and another via keyboard shortcut 'M'
const m1 = app.addMarker('Intro Section');
eq(m1.label, 'Intro Section', 'first marker label');
assert(m1.timeSec >= 0.4, `first marker timestamp ${m1.timeSec}s`);

press('m');
eq(app.capture.markers.length, 2, 'second marker added via M key');
eq(app.capture.markers[1].label, 'Marker 2', 'default label for M shortcut marker');

// Pause recording via 'P' shortcut
press('p');
eq(app.state.paused, true, 'recording paused via P key');
const durAtPause = app.capture.duration;

// Feed while paused — should be ignored
app.capture.feed(halfSec, engRate);
settle(40);
eq(app.capture.duration, durAtPause, 'duration does not advance while paused');

// Resume via 'P' shortcut and feed another 0.5s
press('p');
eq(app.state.paused, false, 'recording resumed via P key');
app.capture.feed(halfSec, engRate);
settle(60);
assert(app.capture.duration >= durAtPause + 0.45, `duration advanced after resume to ${app.capture.duration}`);

// Stop & Save
const saved = await app.stopAndSaveRecording('Team Standup Note');
eq(app.state.recording, false, 'recording stopped after save');
assert(saved != null, 'stopAndSaveRecording returned saved entry');
eq(saved.title, 'Team Standup Note', 'saved recording title');
eq(saved.markers.length, 2, 'saved recording has 2 markers');
eq(saved.markers[0].label, 'Intro Section', 'saved marker 0 label');

// Verify .wav and .json files exist on disk and are valid
assert(fs.existsSync(saved.wavPath), `.wav file written at ${saved.wavPath}`);
assert(fs.existsSync(saved.jsonPath), `.json sidecar written at ${saved.jsonPath}`);

const diskWav = fs.readFileSync(saved.wavPath);
const decoded = app.wav.decodeWav(diskWav);
eq(decoded.sampleRate, 16000, 'saved WAV sampleRate is 16000');
assert(decoded.duration >= 0.9, `saved WAV duration ${decoded.duration}s >= 0.9s`);

const diskMeta = JSON.parse(fs.readFileSync(saved.jsonPath, 'utf8'));
eq(diskMeta.title, 'Team Standup Note', 'sidecar JSON title matches');
eq(diskMeta.markers.length, 2, 'sidecar JSON has 2 markers');
assert(Array.isArray(diskMeta.peaks) && diskMeta.peaks.length === 256, 'sidecar JSON has 256 peaks');

// Verify library list shows the recording
waitFor(() => app.list.items.length === 1, 'saved recording appears in VirtualList');
eq(app.list.items[0].title, 'Team Standup Note', 'VirtualList item title');

// ---- 2. Cancel recording via Escape ------------------------------------------
app.startRecording({ sampleRate: 16000, live: false });
settle(60);
eq(app.state.recording, true, 'second recording started');
press('escape');
eq(app.state.recording, false, 'Escape cancels active recording');
eq(app.list.items.length, 1, 'cancelled recording was not added to library');

console.log('test_recording PASSED');
