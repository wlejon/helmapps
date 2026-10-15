// Radio on a fake backend (no models): genres, instruments, the mood plane
// (knobs follow at once, the mood changes past a border, hysteresis), the
// timeline's steps and CLAP verdicts, "go to a sound", skip, drift, pause,
// and resume.

import { app, waitFor, eq, press, clickEl, mod } from '/lib/test.js';
import { fakeBackend } from '/app/tests/fake_backend.js';

const RATE = 48000;

// Where the models are found, their load finishes first; the fake replaces them after.
waitFor(() => app.state.phase !== 'loading' && app.state.phase !== 'probing', 'the models load to settle', 120000);
if (app.state.phase === 'missing') {
  assert(document.querySelector('.radio-blank .radio-setup'), 'the models card when the models are not here');
  eq(document.querySelectorAll('.radio-setup .models-row').length, 3, 'one row per model');
}

const be = fakeBackend();
app.useBackend(be);
waitFor(() => app.state.phase === 'ready', 'ready');
const targets = () => be.calls.filter((c) => c.kind === 'setTarget');
const knobCalls = () => be.calls.filter((c) => c.kind === 'setKnobs');
const cards = () => Array.from(document.querySelectorAll('.tl-card'));

// The sidebar lists every genre by family; the default style is selected.
eq(Array.from(document.querySelectorAll('.sidebar-section')).slice(0, 3).map((s) => s.textContent), ['Acoustic', 'Band', 'Electronic'], 'the families');
eq(document.querySelectorAll('.sidebar-item').length, 24, 'every genre');
eq(document.querySelector('.sidebar-item.selected').textContent, 'lo-fi', 'lo-fi to start');
eq(document.querySelectorAll('.plane-word').length, 14, 'the mood words on the plane');

// Play: the stream starts as the selected style, at the plane's knobs.
press('space');
eq(app.state.playing, true, 'Space plays');
eq(be.stream.target.tag, 'g=lo-fi|m=calm|i=Rhodes piano,drum machine', 'the first target names the style');
eq(be.stream.target.style, 'lo-fi, Rhodes piano, drum machine, calm, instrumental', 'as YuE2 style text');
waitFor(() => app.state.radio.playhead > 12 * RATE, 'into the second chunk', 30000);

// The timeline: played (with CLAP's verdict), now, ready, writing.
waitFor(() => cards().some((c) => c.classList.contains('played') && c.querySelector('.tl-heard')), 'a played card with a verdict', 15000);
const states = () => cards().map((c) => c.className.split(' ').find((k) => ['played', 'now', 'ready', 'rendering', 'writing', 'planned'].includes(k)));
assert(states().includes('now') && states().includes('writing'), `now and writing on the timeline: ${states().join(' ')}`);
assert(cards().find((c) => c.classList.contains('played')).querySelector('.tl-heard').textContent.includes('sounds like calm lo-fi'), 'CLAP heard what was asked');

// A genre: one target, a 'new style' card, the strip says when.
const t0 = targets().length;
clickEl(Array.from(document.querySelectorAll('.sidebar-item')).find((r) => r.textContent === 'jazz'));
eq(targets().length, t0 + 1, 'picking a genre makes one target');
eq(targets().pop().arg.tag, 'g=jazz|m=calm|i=piano,saxophone', 'jazz with its default instruments');
waitFor(() => cards().some((c) => c.classList.contains('change') && c.textContent.includes('calm jazz')), 'the change on the timeline');
waitFor(() => document.querySelector('.radio-now-next').textContent.includes('calm jazz'), 'the strip says what is coming');
eq(Array.from(document.querySelectorAll('.radio-chip')).map((c) => c.textContent), ['piano', 'saxophone', 'upright bass', 'brushed drums'], "jazz's instruments");

// Instruments: toggles merge into one change.
const t1 = targets().length;
clickEl(Array.from(document.querySelectorAll('.radio-chip')).find((c) => c.textContent === 'upright bass'));
clickEl(Array.from(document.querySelectorAll('.radio-chip')).find((c) => c.textContent === 'saxophone'));
waitFor(() => targets().length === t1 + 1, 'the instrument changes as one target', 3000);
eq(targets().pop().arg.tag, 'g=jazz|m=calm|i=piano,upright bass', 'piano and upright bass');

// The plane: a small move sends knobs only; crossing into another mood changes the style once.
const calm = { x: 0.7, y: -0.75 };
const k0 = knobCalls().length, t2 = targets().length;
app.moveTo(calm.x + 0.03, calm.y + 0.02, true);
waitFor(() => knobCalls().length > k0, 'the knobs follow the listener', 2000);
eq(targets().length, t2, 'no style change inside the region');
const k = knobCalls().pop().arg;
assert(k.energy < 0 && k.timbre > 0, `relaxed and bright: ${JSON.stringify(k)}`);
// Back and forth across the calm/tender border: hysteresis holds the mood.
for (let i = 0; i < 5; i++) { app.moveTo(0.54, -0.7, false); app.moveTo(0.5, -0.69, false); }
app.moveTo(0.53, -0.7, true);
assert(targets().length - t2 <= 1, `at most one style change across a border (${targets().length - t2})`);
// Clicking a mood word goes there.
const t3 = targets().length, k3 = knobCalls().length;
clickEl(Array.from(document.querySelectorAll('.plane-word')).find((w) => w.textContent === 'aggressive'));
eq(targets().length, t3 + 1, 'a mood word is one change');
eq(app.state.style.mood, 'aggressive', 'to that mood');
waitFor(() => knobCalls().slice(k3).some((c) => c.arg.energy > 0), 'and its knobs', 2000);

// Go to a sound: the fake CLAP picks the genre and mood the phrase names.
const search = document.querySelector('.radio-search');
search.value = 'tender bossa nova by the sea';
search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
eq(`${app.state.style.mood} ${app.state.style.genre}`, 'tender bossa nova', 'the phrase places the style');

// Skip goes to another family.
const famBefore = app.state.style.genre;
app.skip();
assert(app.state.style.genre !== famBefore, 'skip changes the genre');

// Drums is the percussion knob.
app.setDrums(2);
waitFor(() => knobCalls().some((c) => c.arg.percussion === 2), 'drums reach the stream', 2000);

// Drift moves on its own.
press(`${mod}+d`);
eq(app.state.drift, true, 'Mod+D turns drift on');
const before = { ...app.state.listener };
waitFor(() => app.state.listener.x !== before.x || app.state.listener.y !== before.y, 'drift steps', 60000);
press(`${mod}+d`);

// Pause holds the playhead.
press('space');
const ph = app.state.radio.playhead;
for (let i = 0; i < 30; i++) advanceTime(16);
eq(app.state.radio.playhead, ph, 'paused, the playhead holds');

// Resume: the style, the place and the drums are kept.
eq(app.settings.get('style').genre, app.state.style.genre, 'the style saved');
eq(app.settings.get('drums'), 2, 'the drums saved');
assert(Math.abs(app.settings.get('listener').x - app.state.listener.x) < 1e-9, 'the place saved');

console.log('test_ui PASSED');
