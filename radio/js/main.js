/**
 * Radio: an endless stream of generated instrumental music that you steer
 * (briefs/radio.md).
 *
 * The music is YuE2-3B's yue.endless stream, made 10 s at a time on the GPU.
 * You choose a genre (and its instruments) on the left, and stand somewhere
 * on the mood plane: up is energetic, right is bright. Where you stand picks
 * the mood word and sets the stream's knobs continuously, so a small move is
 * heard within a couple of seconds and a move into another mood's region is
 * a style change. The timeline under the plane shows every chunk: what it
 * was asked to be, the step it is at (writing, rendering, ready, now), how a
 * change was made, and what CLAP says it sounds like once played.
 *
 * How it stays responsive: the models load on their own threads; the stream
 * runs on its worker and hands out audio just ahead of the playhead; CLAP
 * embeds each chunk asynchronously; the views redraw only when something
 * changed. The page's frame loop feeds the player and reports the playhead.
 */

import { startApp } from '/lib/app.js';
import { h, debounce } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, emptyState } from '/lib/layout.js';
import { Slider, Switch } from '/lib/controls.js';
import { toast } from '/lib/toast.js';
import { FAMILIES, KITS, GENRES, MOODS, familyOf, moodAt, moodKnobs, makeStyle, styleText, styleTag, styleLabel, sameStyle } from './styles.js';
import { PlaneView } from './plane_view.js';
import { TimelineView } from './timeline_view.js';
import { Program } from './program.js';
import { Radio } from './radio.js';
import { makeEar } from './hear.js';
import { modelsFlow } from './models_flow.js';
import { PROGRAM_RATE } from './player.js';

/** While dragging, a mood change waits this long for the drag to settle. */
const MOOD_DWELL_MS = 700;
/** Drift: a step across the plane every DRIFT_STEP_S of program, a new genre every DRIFT_GENRE_S. */
const DRIFT_STEP_S = 30;
const DRIFT_GENRE_S = 240;

const app = startApp({
  settings: {
    style: { type: 'json', default: { genre: 'lo-fi', mood: 'calm' } },
    listener: { type: 'json', default: null },     // { x, y } on the mood plane
    drums: { type: 'double', default: 0 },          // the percussion knob
    drift: { type: 'bool', default: false },
    modelDirs: { type: 'json', default: {} },      // { yue, vae, clap }: folders chosen in the app
    arWeights: { type: 'string', default: 'int8' },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const savedStyle = makeStyle(settings.get('style'));
const savedMood = MOODS.find((m) => m.id === savedStyle.mood);
const state = {
  phase: 'probing',     // probing | unavailable | missing | loading | ready | error
  reason: '',
  backend: null,
  backendGen: 0,
  radio: null,
  ear: null,
  playing: false,       // the user asked for sound
  style: savedStyle,    // what new chunks are made as
  listener: settings.get('listener') || { x: savedMood.x, y: savedMood.y },
  drums: settings.get('drums'),
  drift: settings.get('drift'),
  program: new Program(),
  sentPos: null,        // where the listener was when the knobs were last sent
  moodPending: null,    // a mood the drag has reached but not committed
  driftAt: { step: 0, genre: 0 },
};

// ---- the window -------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);
const toolbar = new Toolbar(ui.toolbar, commands);

// Sidebar: genres by family, then the genre's instruments.
const genres = new Sidebar({ onSelect: (it) => pickGenre(it.id) });
const insChips = h('div.radio-ins');
ui.sidebar.append(genres.el, h('div.sidebar-section.micro', 'Instruments'), insChips);

const plane = new PlaneView({
  onMove: (x, y, end) => moveTo(x, y, end),
  onMood: (id) => { const m = MOODS.find((q) => q.id === id); moveTo(m.x, m.y, true); },
});
const timeline = new TimelineView();

const nowName = h('div.radio-now-name', '—');
const nowIns = h('div.radio-now-ins.micro.dim', '');
const nowNext = h('div.radio-now-next.micro', '');
const playBtn = h('button.icon-btn.radio-play', { onclick: () => commands.run('play-pause'), 'data-tip': 'Play / Pause (Space)' }, icon('play'));
const drums = new Slider({ min: -3, max: 3, step: 0.1, value: state.drums, onChange: (v) => setDrums(v) });
const drift = new Switch({ on: state.drift, onChange: (on) => setDrift(on), label: 'Drift: wander on its own' });
const knobRead = h('div.radio-knobread.micro.dim.num');
const strip = h('div.radio-strip',
  playBtn,
  h('button.icon-btn', { onclick: () => commands.run('skip'), 'data-tip': 'Somewhere else (Mod+→)' }, icon('skip-forward')),
  h('div.radio-now', nowName, nowIns, nowNext),
  h('label.radio-ctl', h('span.micro.dim', 'Drums'), drums.el),
  h('label.radio-ctl.row', drift.el, h('span', 'Drift')));

const blank = h('div.radio-blank');
const main = h('div.radio-main', h('div.radio-plane-wrap', plane.el, knobRead), timeline.el);
const stage = h('div.radio-stage', main, blank);
ui.content.append(stage, strip);

const statusText = h('span.grow.num');
ui.statusbar.append(statusText);

const search = h('input.field.radio-search', { type: 'text', placeholder: 'Go to a sound…  (“rain on a tin roof”)',
  onkeydown: (e) => { if (e.key === 'Enter') { flyTo(search.value); e.preventDefault(); } } });

// ---- commands -------------------------------------------------------------------

const ready = () => state.phase === 'ready';
commands.addAll([
  { id: 'play-pause', label: 'Play', icon: 'play', keys: ['Space'], enabled: ready, checked: () => state.playing, run: togglePlay },
  { id: 'skip', label: 'Somewhere Else', icon: 'skip-forward', keys: ['Mod+ArrowRight'], enabled: ready, run: skip },
  { id: 'drift', label: 'Drift', icon: 'shuffle', keys: ['Mod+D'], checked: () => state.drift, run: () => setDrift(!state.drift) },
  { id: 'models', label: 'Models…', icon: 'layers', keys: ['Mod+,'],
    enabled: () => state.phase !== 'unavailable' && state.phase !== 'loading', run: () => flow.openDialog() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);
toolbar.add(search);
toolbar.spacer();
toolbar.button('models');

// ---- phases and models -------------------------------------------------------

const flow = modelsFlow({ settings, setPhase, useBackend, releaseBackend, generation: () => state.backendGen });

function showBlank(node) {
  blank.replaceChildren(...(node ? [node] : []));
  blank.classList.toggle('hidden', !node);
  main.classList.toggle('hidden', !!node);
}

function setPhase(phase, reason = '') {
  state.phase = phase;
  state.reason = reason;
  if (phase === 'unavailable') showBlank(emptyState({ icon: 'music', title: 'The radio cannot run here', hint: reason }));
  else if (phase === 'missing') showBlank(flow.setupCard(reason));
  else if (phase === 'error') {
    showBlank(emptyState({ icon: 'alert', title: 'The radio stopped', hint: reason,
      action: state.backend ? { label: 'Start Again', run: () => { setPhase('ready'); play(); } } : null }));
  } else if (phase === 'loading' || phase === 'probing') {
    showBlank(h('div.radio-loading', h('div.spinner'), h('div.dim', reason || 'Starting…')));
  } else showBlank(null);
  toolbar.refresh();
  drawNow();
}

/** Runs the radio on a backend (the real one, or a test's fake). */
function useBackend(backend) {
  state.backendGen++;
  if (state.radio) state.radio.stop();
  if (state.backend && state.backend !== backend) freeBackend(state.backend);
  state.backend = backend;
  state.ear = makeEar(backend);
  state.program.reset();
  state.radio = new Radio(backend, {
    onEvent: (e) => { state.program.event(e, { pos: state.sentPos }); },
    onHeard: ({ index, vec }) => {
      const c = state.program.chunks.get(index);
      state.program.heard(index, { ...state.ear.hear(vec, c && c.style), vec });
    },
    onError: (m) => { state.playing = false; setPhase('error', m); },
  });
  setPhase('ready');
}

/**
 * Stops the stream and frees the backend's models. A stream lets go of the
 * models at its onDone, a moment after stop(), so freeing is retried until
 * then (at most 15 s; after that the weights go with the GC instead).
 */
function releaseBackend() {
  const be = state.backend;
  state.backendGen++;
  state.backend = null;
  state.playing = false;
  if (state.radio) state.radio.stop();
  state.radio = null;
  return freeBackend(be);
}

/** Frees a backend's models once its stream lets go of them. */
function freeBackend(be) {
  return new Promise((resolve) => {
    if (!be || !be.dispose) { resolve(); return; }
    const t0 = performance.now();
    const tryFree = () => {
      if (be.dispose()) resolve();
      else if (performance.now() - t0 > 15000) { console.log('radio: models still busy after 15 s; left to the GC'); resolve(); }
      else setTimeout(tryFree, 50);
    };
    tryFree();
  });
}

// ---- steering -------------------------------------------------------------------

const target = () => ({ style: styleText(state.style), tag: styleTag(state.style) });
const knobs = () => Object.assign(moodKnobs(state.listener.x, state.listener.y), { percussion: state.drums });

function togglePlay() { if (state.playing) pause(); else play(); }

function play() {
  if (!ready()) return;
  state.playing = true;
  const r = state.radio;
  r.setPaused(false);
  if (!r.running) {
    state.program.reset();
    state.sentPos = { ...state.listener };
    r.start(Object.assign(target(), { knobs: knobs() }));
  }
  drawNow();
}

function pause() {
  state.playing = false;
  if (state.radio) state.radio.setPaused(true);
  drawNow();
}

/** A new style from the next chunk that can still change. */
function setStyle(style, why) {
  if (sameStyle(style, state.style)) return;
  state.style = style;
  settings.set('style', { genre: style.genre, mood: style.mood, instruments: style.instruments });
  if (state.radio && state.radio.running) {
    state.sentPos = { ...state.listener };
    state.radio.setTarget(target());
  }
  if (why) toast(why, { key: 'steer' });
  drawSide();
  drawNow();
}

const sendKnobs = debounce(() => {
  state.sentPos = { ...state.listener };
  if (state.radio) state.radio.setKnobs(knobs());
}, 200);

const commitMoodSoon = debounce(() => commitMood(), MOOD_DWELL_MS);

function commitMood() {
  if (!state.moodPending) return;
  const mood = state.moodPending;
  state.moodPending = null;
  setStyle(makeStyle({ genre: state.style.genre, mood, instruments: state.style.instruments }));
}

/** The listener moves on the plane: the knobs follow at once, the mood when another region clearly owns the spot. */
function moveTo(x, y, end) {
  state.listener = { x, y };
  const m = moodAt(x, y, state.moodPending || state.style.mood);
  if (m.id !== state.style.mood) { state.moodPending = m.id; if (end) commitMood(); else commitMoodSoon(); }
  else state.moodPending = null;
  sendKnobs();
  plane.setState({ listener: state.listener, mood: state.moodPending || state.style.mood });
  if (end) settings.set('listener', state.listener);
  drawKnobs();
}

function pickGenre(genre) {
  if (genre === state.style.genre) return;
  setStyle(makeStyle({ genre, mood: state.style.mood }));
}

function toggleInstrument(ins) {
  const cur = state.pendingIns || state.style.instruments;
  let next = cur.includes(ins) ? cur.filter((i) => i !== ins) : [...cur, ins];
  if (!next.length) return;                  // at least one
  if (next.length > 3) next = next.slice(1);  // at most three: the oldest goes
  state.pendingIns = next;
  drawSide();
  applyInsSoon();
}
const applyInsSoon = debounce(() => {
  const ins = state.pendingIns;
  state.pendingIns = null;
  if (ins) setStyle(makeStyle({ genre: state.style.genre, mood: state.style.mood, instruments: ins }));
}, 900);

function goToMood(moodId) {
  const m = MOODS.find((q) => q.id === moodId);
  state.listener = { x: m.x, y: m.y };
  state.moodPending = null;
  plane.setState({ listener: state.listener, mood: m.id });
  settings.set('listener', state.listener);
  sendKnobs();
  drawKnobs();
}

function skip() {
  const others = GENRES.filter((g) => familyOf(g) !== familyOf(state.style.genre));
  const genre = others[Math.floor(Math.random() * others.length)];
  const mood = MOODS[Math.floor(Math.random() * MOODS.length)].id;
  goToMood(mood);
  setStyle(makeStyle({ genre, mood }), `Somewhere else: ${mood} ${genre}`);
  if (!state.playing) play();
}

/** Typed text: CLAP picks the genre and mood nearest the phrase. */
function flyTo(text) {
  text = String(text || '').trim();
  if (!text || !state.ear) return;
  const p = state.ear.place(text);
  goToMood(p.mood);
  setStyle(makeStyle({ genre: p.genre, mood: p.mood }), `“${text}” → ${p.mood} ${p.genre}`);
}

function setDrums(v) {
  state.drums = v;
  settings.set('drums', v);
  sendKnobs();
}

function setDrift(on) {
  state.drift = !!on;
  drift.set(state.drift);
  settings.set('drift', state.drift);
  const t = state.radio ? state.radio.playhead / PROGRAM_RATE : 0;
  state.driftAt = { step: t + DRIFT_STEP_S, genre: t + DRIFT_GENRE_S };
  toolbar.refresh();
}

/** Drift: a short step across the plane now and then, and now and then a neighbouring genre. */
function driftTick(t) {
  if (!state.drift || !state.playing) return;
  if (t >= state.driftAt.step) {
    state.driftAt.step = t + DRIFT_STEP_S;
    const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.2;
    const c = (v) => Math.max(-0.95, Math.min(0.95, v));
    moveTo(c(state.listener.x + r * Math.cos(a)), c(state.listener.y + r * Math.sin(a)), true);
  }
  if (t >= state.driftAt.genre) {
    state.driftAt.genre = t + DRIFT_GENRE_S;
    const fam = familyOf(state.style.genre).genres.filter((g) => g !== state.style.genre);
    pickGenre(fam[Math.floor(Math.random() * fam.length)]);
  }
}

// ---- drawing ------------------------------------------------------------------

genres.setSections(FAMILIES.map((f) => ({ title: f.label, items: f.genres.map((g) => ({ id: g, label: g })) })));
let chipsKey = '';

/** The selected genre, the one playing (a dot), and the genre's instrument chips. */
function drawSide() {
  genres.select(state.style.genre);
  const playing = state.radio ? state.program.playing(state.radio.playhead) : null;
  for (const [id, row] of genres.rows) row.classList.toggle('playing', !!(playing && playing.style && playing.style.genre === id));
  const chosen = state.pendingIns || state.style.instruments;
  const key = `${state.style.genre}|${chosen.join(',')}`;
  if (key === chipsKey) return;
  chipsKey = key;
  insChips.replaceChildren(...KITS[state.style.genre].map((i) =>
    h(`button.radio-chip${chosen.includes(i) ? '.on' : ''}`, { onclick: () => toggleInstrument(i) }, i)));
}

function drawKnobs() {
  const k = knobs();
  const f = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  knobRead.textContent = `energy ${f(k.energy)} · fullness ${f(k.density)} · brightness ${f(k.timbre)}`;
}

function drawNow() {
  const r = state.radio;
  const playhead = r ? r.playhead : 0;
  const cur = r ? state.program.playing(playhead) : null;
  if (cur && cur.style) {
    nowName.textContent = styleLabel(cur.style);
    nowIns.textContent = cur.style.instruments.join(', ');
  } else {
    nowName.textContent = state.playing ? 'Starting…' : styleLabel(state.style);
    nowIns.textContent = state.playing ? 'writing the first 10 s' : state.style.instruments.join(', ');
  }
  let next = '';
  if (state.playing && cur && cur.style && !sameStyle(cur.style, state.style)) {
    const p = state.program.planned;
    const eta = p && p.sample > playhead ? Math.round((p.sample - playhead) / PROGRAM_RATE) : null;
    next = `→ ${styleLabel(state.style)}${eta != null ? ` in about ${eta} s` : ', next chunk'}`;
  }
  nowNext.textContent = next;
  playBtn.replaceChildren(icon(state.playing ? 'pause' : 'play'));
  playBtn.classList.toggle('on', state.playing);

  const st = r ? r.stats() : null;
  if (state.phase !== 'ready') statusText.textContent = state.reason;
  else if (!st) statusText.textContent = state.backend ? `Ready · ${state.backend.device}` : '';
  else {
    const cost = st.costSeconds ? (st.costSeconds.splice + st.costSeconds.render + st.costSeconds.decode) : 0;
    statusText.textContent = `${fmtTime(playhead / PROGRAM_RATE)} played · ${st.aheadSeconds.toFixed(1)} s of audio ready`
      + (cost ? ` · a chunk takes ${cost.toFixed(1)} s of GPU for 10 s of music` : '')
      + (st.worstGapSeconds >= 0.2 ? ` · worst gap ${st.worstGapSeconds.toFixed(2)} s` : '');
  }
  if (r) {
    plane.setState({ music: cur && cur.pos, playingMood: cur && cur.style ? cur.style.mood : null, trail: state.program.trail(playhead) });
    drawSide();
  }
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let lastNow = 0;
function frame(t) {
  const r = state.radio;
  if (r && r.running) {
    r.tick();
    driftTick(r.playhead / PROGRAM_RATE);
    timeline.update(state.program.cards(r.playhead, { running: true, target: state.style }), r.playhead);
  }
  plane.frame();
  if (t - lastNow > 250) { lastNow = t; drawNow(); }
  requestAnimationFrame(frame);
}

plane.setState({ listener: state.listener, mood: state.style.mood });
drawSide();
drawKnobs();
requestAnimationFrame(frame);
window.addEventListener('beforeunload', () => { if (state.radio) state.radio.stop(); });

app.expose({ state, plane, timeline, useBackend, play, pause, moveTo, pickGenre, toggleInstrument, skip, flyTo, setDrums, setDrift,
  goToMood, flow });
flow.boot();
