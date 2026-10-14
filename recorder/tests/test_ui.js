// UI & Inspector acceptance tests:
// Selecting recordings in VirtualList, playing/pausing, scrubbing/jumping to a marker,
// changing playback speed, renaming via promptDialog, searching by title/marker/transcript,
// transcribing with mock transcriber (and checking clean state when no model is installed),
// and deleting via confirmDialog.

import {
  app, waitFor, settle, eq, press, clickEl,
  currentDialog, dialogButton, answerPrompt, fixtureDir
} from '/lib/test.js';

const fs = require('fs');
const path = require('path');

// Create fixture recordings directory with 3 recordings (10s, 8s, 6s)
const rate = 16000;
function makeSineWav(seconds, freq = 330) {
  const n = Math.round(rate * seconds);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / rate);
  return app.wav.encodeWav(s, rate, 1);
}

const now = Date.now();
const dir = fixtureDir({
  'alpha.wav': makeSineWav(10, 330),
  'alpha.json': JSON.stringify({
    title: 'Design Review',
    createdAt: now - 30000,
    duration: 10,
    sampleRate: rate,
    markers: [
      { timeSec: 2.5, label: 'Architecture' },
      { timeSec: 7.0, label: 'Action Items' },
    ],
    transcript: '',
    peaks: new Array(256).fill(0.5),
  }),
  'beta.wav': makeSineWav(8, 440),
  'beta.json': JSON.stringify({
    title: 'Grocery Memo',
    createdAt: now - 10000,
    duration: 8,
    sampleRate: rate,
    markers: [
      { timeSec: 4.0, label: 'Buy Coffee' },
    ],
    transcript: '',
    peaks: new Array(256).fill(0.4),
  }),
  'gamma-no-sidecar.wav': makeSineWav(6, 550),
});

await app.setRecordingsDir(dir);
waitFor(() => app.list.items.length === 3, 'all 3 fixture recordings loaded');

// ---- 1. Selecting recordings in VirtualList ----------------------------------
await app.selectRecording('Design Review');
eq(app.state.selected.title, 'Design Review', 'selected Design Review');
eq(app.state.selected.markers.length, 2, 'Design Review has 2 markers');

const pills = document.querySelectorAll('.rec-marker-pill');
eq(pills.length, 2, 'Inspector renders 2 marker pills');

// ---- 2. Jumping to a marker & scrubbing --------------------------------------
clickEl(pills[1]); // 'Action Items' at 7.0s
eq(app.player.currentTime, 7.0, 'clicking marker pill jumps playhead to 7.0s');

// Test ArrowLeft (-5s) and ArrowRight (+5s)
press('left');
eq(app.player.currentTime, 2.0, 'ArrowLeft seeks back 5s to 2.0s');
press('right');
eq(app.player.currentTime, 7.0, 'ArrowRight seeks forward 5s to 7.0s');

// ---- 3. Play / Pause & Playback Speed ----------------------------------------
app.player.seek(0);
app.setPlaybackSpeed(2.0);
eq(app.state.playbackSpeed, 2.0, 'playback speed set to 2.0x');
eq(app.player.playbackRate, 2.0, 'player playbackRate is 2.0');

press('space');
eq(app.state.playing, true, 'Space starts playback');
settle(120);
assert(app.player.currentTime > 0, `playhead advanced during playback to ${app.player.currentTime}`);
press('space');
eq(app.state.playing, false, 'Space pauses playback');

// Drop a new marker during playback/inspection
const addedDuringPlay = app.addMarker('Bookmark Point');
eq(addedDuringPlay.label, 'Bookmark Point', 'marker added in inspector mode');
eq(app.state.selected.markers.length, 3, 'selected recording now has 3 markers');

// ---- 4. Renaming via F2 & promptDialog ---------------------------------------
press('f2');
waitFor(() => currentDialog() != null, 'F2 opens Rename promptDialog');
answerPrompt('Product Strategy Review');
waitFor(() => currentDialog() == null && app.state.selected.title === 'Product Strategy Review', 'recording renamed');

const updatedAlphaMeta = JSON.parse(fs.readFileSync(path.join(dir, 'alpha.json'), 'utf8'));
eq(updatedAlphaMeta.title, 'Product Strategy Review', 'renamed title saved to sidecar JSON');

// ---- 5. Transcription: clean empty state when no model, then mock transcriber ----
app.setMockTranscriber(null);
eq(app.transcriber.isAvailable(), false, 'STT unavailable when no model is installed');
const hintText = document.querySelector('.rec-transcript-body').textContent;
assert(hintText.includes('On-device STT available when model installed'), `clean STT hint shown: ${hintText}`);

// Inject mock transcriber and run Transcribe
app.setMockTranscriber(async (audio, item) => {
  return `Transcript for ${item.title} (${audio.sampleRate} Hz, ${audio.samples.length} samples): quarterly roadmap approved.`;
});
eq(app.transcriber.isAvailable(), true, 'STT available after mock transcriber injected');

const transcriptText = await app.transcribeRecording();
assert(transcriptText.includes('quarterly roadmap approved'), 'mock transcriber returned expected text');
const domTranscript = document.querySelector('.rec-transcript-body').textContent;
eq(domTranscript, transcriptText, 'Inspector displays the transcript');

const metaAfterStt = JSON.parse(fs.readFileSync(path.join(dir, 'alpha.json'), 'utf8'));
eq(metaAfterStt.transcript, transcriptText, 'transcript persisted in sidecar JSON');

// ---- 6. Searching by title, marker label, and transcript ---------------------
app.setSearchQuery('Coffee'); // matches marker 'Buy Coffee' on Grocery Memo
eq(app.list.items.length, 1, 'search for marker "Coffee" finds 1 recording');
eq(app.list.items[0].title, 'Grocery Memo', 'found Grocery Memo by marker label');

app.setSearchQuery('roadmap'); // matches transcript on Product Strategy Review
eq(app.list.items.length, 1, 'search for transcript "roadmap" finds 1 recording');
eq(app.list.items[0].title, 'Product Strategy Review', 'found Product Strategy Review by transcript');

app.setSearchQuery('');
eq(app.list.items.length, 3, 'clearing search restores all 3 recordings');

// ---- 7. Deleting a recording via Delete & confirmDialog ----------------------
await app.selectRecording('Grocery Memo');
press('delete');
waitFor(() => currentDialog() != null, 'Delete key opens confirmDialog');
dialogButton('Delete');
waitFor(() => app.list.items.length === 2, 'recording deleted after confirmation');
eq(app.list.items.some((x) => x.title === 'Grocery Memo'), false, 'Grocery Memo removed from list');

console.log('test_ui PASSED');
