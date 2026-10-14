/**
 * Clocks (helm.clock): World clocks, Alarms, Timers, and Stopwatch.
 *
 * Built on the helm app kit (/lib):
 *  - Paints the window synchronously before any background work.
 *  - Uses a single virtual-clock-aware time source (js/time.js) so headless
 *    tests can pin or advance time deterministically with setNow() and advanceTime().
 *  - Persists cities, alarms, timers in progress, and stopwatch laps via bro.conf.
 */

import { startApp } from '/lib/app.js';
import { h } from '/lib/dom.js';
import { appFrame, Toolbar, Sidebar } from '/lib/layout.js';
import { now, setNow as setClockNow, advanceClock as advanceClockMs, onClockOverride } from './time.js';
import {
  CITIES,
  INTL_TZ_WORKS,
  findCity,
  searchCities,
  getZoneOffsetMin,
  getZonedParts,
  formatInZone,
  formatDateInZone,
  getRelativeDayAndOffset,
} from './cities.js';
import { createWorldView } from './world.js';
import { createTimersView } from './timers.js';
import { createStopwatchView, formatStopwatchMs } from './stopwatch.js';
import { createAlarmsView } from './alarms.js';
import { playChime } from './sound.js';

const DEFAULT_CITIES = [
  findCity('tokyo'),
  findCity('london'),
  findCity('new-york'),
].filter(Boolean);

const app = startApp({
  settings: {
    activePage: { type: 'string', default: 'world' },
    cities: { type: 'json', default: DEFAULT_CITIES },
    timers: { type: 'json', default: [] },
    alarms: { type: 'json', default: [] },
    stopwatch: {
      type: 'json',
      default: { running: false, startedAt: null, elapsedMs: 0, laps: [] },
    },
  },
});

const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const state = {
  page: 'world',
  referenceZone: 'local',
  cities: [],
  timers: [],
  alarms: [],
  stopwatch: { running: false, startedAt: null, elapsedMs: 0, laps: [] },
  ringingAlarm: null,
  timerEndEvents: 0,
  alarmFireEvents: 0,
  lastFinishedTimerId: null,
  lastFiredAlarmId: null,
  lastSoundPlayedAt: 0,
  soundPlayCount: 0,
  lastCopiedTsv: '',
  intlTzSupported: INTL_TZ_WORKS,
};

// ---- window & chrome --------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const sidebar = new Sidebar({ onSelect: (item) => showPage(item.id) });
ui.sidebar.appendChild(sidebar.el);

const statusLeft = h('span.grow.num');
const statusRight = h('span.dim.num');
ui.statusbar.append(statusLeft, statusRight);

// ---- views ------------------------------------------------------------------

const worldView = createWorldView({ state, settings, commands });
const timersView = createTimersView({
  state,
  settings,
  commands,
  onEnd: () => updateChrome(),
});
const stopwatchView = createStopwatchView({ state, settings, commands });
const alarmsView = createAlarmsView({
  state,
  settings,
  commands,
  onRing: () => updateChrome(),
});

const PAGE_META = {
  world: { id: 'world', label: 'World', icon: 'globe', view: worldView },
  alarms: { id: 'alarms', label: 'Alarms', icon: 'alarm', view: alarmsView },
  timers: { id: 'timers', label: 'Timers', icon: 'timer', view: timersView },
  stopwatch: { id: 'stopwatch', label: 'Stopwatch', icon: 'clock', view: stopwatchView },
};

for (const m of Object.values(PAGE_META)) {
  m.view.el.classList.add('hidden');
  ui.content.appendChild(m.view.el);
}

// ---- commands ---------------------------------------------------------------

commands.addAll([
  // Navigation
  { id: 'page-world', label: 'World Clock', icon: 'globe', keys: ['Mod+1'],
    checked: () => state.page === 'world', run: () => showPage('world') },
  { id: 'page-alarms', label: 'Alarms', icon: 'alarm', keys: ['Mod+2'],
    checked: () => state.page === 'alarms', run: () => showPage('alarms') },
  { id: 'page-timers', label: 'Timers', icon: 'timer', keys: ['Mod+3'],
    checked: () => state.page === 'timers', run: () => showPage('timers') },
  { id: 'page-stopwatch', label: 'Stopwatch', icon: 'clock', keys: ['Mod+4'],
    checked: () => state.page === 'stopwatch', run: () => showPage('stopwatch') },

  // Context-sensitive primary "New" command (Mod+N)
  { id: 'new-item', label: 'New…', icon: 'plus', keys: ['Mod+N'],
    run: () => {
      if (state.page === 'world') return worldView.openAddCityDialog();
      if (state.page === 'alarms') return alarmsView.openAlarmDialog();
      if (state.page === 'timers') return timersView.openNewTimerDialog();
      return null;
    } },

  // World commands
  { id: 'world-add-city', label: 'Add City…', icon: 'plus',
    run: (arg) => (arg ? worldView.addCity(arg) : worldView.openAddCityDialog()) },
  { id: 'world-remove-city', label: 'Remove City', icon: 'trash',
    run: (arg) => worldView.removeCity(arg) },
  { id: 'world-move-city', label: 'Move City', icon: 'arrow-up-down',
    run: (arg) => worldView.moveCity(arg) },

  // Timer commands
  { id: 'timer-new', label: 'New Timer…', icon: 'plus',
    run: (arg) => (arg ? timersView.addTimer(arg) : timersView.openNewTimerDialog()) },
  { id: 'timer-add-preset', label: 'Add Preset Timer', icon: 'timer',
    run: (arg) => timersView.addTimer(arg) },
  { id: 'timer-start', label: 'Start Timer', icon: 'play',
    run: (arg) => timersView.startTimer(arg) },
  { id: 'timer-pause', label: 'Pause Timer', icon: 'pause',
    run: (arg) => timersView.pauseTimer(arg) },
  { id: 'timer-reset', label: 'Reset Timer', icon: 'rotate-ccw',
    run: (arg) => timersView.resetTimer(arg) },
  { id: 'timer-delete', label: 'Delete Timer', icon: 'trash',
    run: (arg) => timersView.deleteTimer(arg) },
  { id: 'timer-add-minute', label: 'Add 1 Minute', icon: 'plus',
    run: (arg) => timersView.addOneMinute(arg) },

  // Stopwatch commands
  { id: 'sw-toggle', label: 'Start / Stop Stopwatch', icon: 'play', keys: ['Space'],
    enabled: () => state.page === 'stopwatch',
    run: () => stopwatchView.swToggle() },
  { id: 'sw-start', label: 'Start Stopwatch', icon: 'play',
    run: () => stopwatchView.swStart() },
  { id: 'sw-stop', label: 'Stop Stopwatch', icon: 'pause',
    run: () => stopwatchView.swStop() },
  { id: 'sw-lap', label: 'Record Lap', icon: 'plus', keys: ['L'],
    enabled: () => state.page === 'stopwatch' && (state.stopwatch.running || stopwatchView.getElapsedMs() > 0),
    run: () => stopwatchView.swLap() },
  { id: 'sw-reset', label: 'Reset Stopwatch', icon: 'rotate-ccw', keys: ['R'],
    enabled: () => state.page === 'stopwatch' && (state.stopwatch.running || stopwatchView.getElapsedMs() > 0 || (state.stopwatch.laps && state.stopwatch.laps.length > 0)),
    run: () => stopwatchView.swReset() },
  { id: 'sw-copy-laps', label: 'Copy Laps as TSV', icon: 'copy', keys: ['Mod+C'],
    enabled: () => state.page === 'stopwatch' && state.stopwatch.laps && state.stopwatch.laps.length > 0,
    run: () => stopwatchView.swCopyLaps() },

  // Alarm commands
  { id: 'alarm-new', label: 'Add Alarm…', icon: 'plus',
    run: (arg) => (arg ? alarmsView.addAlarm(arg) : alarmsView.openAlarmDialog()) },
  { id: 'alarm-toggle', label: 'Toggle Alarm', icon: 'bell',
    run: (arg) => alarmsView.toggleAlarm(arg) },
  { id: 'alarm-delete', label: 'Delete Alarm', icon: 'trash',
    run: (arg) => alarmsView.deleteAlarm(arg) },
  { id: 'alarm-snooze', label: 'Snooze Alarm (10 min)', icon: 'clock',
    enabled: () => !!state.ringingAlarm || state.alarms.some((a) => a.ringing),
    run: (arg) => alarmsView.snoozeAlarm(arg, 10) },
  { id: 'alarm-dismiss', label: 'Dismiss Alarm', icon: 'check',
    enabled: () => !!state.ringingAlarm || state.alarms.some((a) => a.ringing),
    run: (arg) => alarmsView.dismissAlarm(arg) },

  // App-level
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

const pageTitleEl = toolbar.title('World');
toolbar.spacer();
const addCityBtn = toolbar.button('world-add-city', { label: true });
const addAlarmBtn = toolbar.button('alarm-new', { label: true });
const addTimerBtn = toolbar.button('timer-new', { label: true });
const swCopyToolbarBtn = toolbar.button('sw-copy-laps', { label: true });

// ---- sidebar & page switching -----------------------------------------------

let lastSidebarKey = '';

function updateSidebarCounts() {
  const runningTimers = state.timers.filter((t) => t.status === 'running').length;
  const enabledAlarms = state.alarms.filter((a) => a.enabled).length;
  const lapsCount = (state.stopwatch && state.stopwatch.laps) ? state.stopwatch.laps.length : 0;
  const key = `${state.cities.length}:${enabledAlarms}:${runningTimers}:${state.timers.length}:${lapsCount}:${state.page}`;
  if (key === lastSidebarKey) return;
  lastSidebarKey = key;

  sidebar.setSections([
    {
      title: 'Clocks',
      items: [
        { id: 'world', label: 'World', icon: 'globe', count: state.cities.length || null },
        { id: 'alarms', label: 'Alarms', icon: 'alarm', count: enabledAlarms || null },
        { id: 'timers', label: 'Timers', icon: 'timer', count: runningTimers || state.timers.length || null },
        { id: 'stopwatch', label: 'Stopwatch', icon: 'clock', count: lapsCount || null },
      ],
    },
  ]);
  sidebar.select(state.page);
}

function updateChrome() {
  const meta = PAGE_META[state.page] || PAGE_META.world;
  pageTitleEl.textContent = meta.label;
  app.setTitle(meta.label);

  addCityBtn.classList.toggle('hidden', state.page !== 'world');
  addAlarmBtn.classList.toggle('hidden', state.page !== 'alarms');
  addTimerBtn.classList.toggle('hidden', state.page !== 'timers');
  swCopyToolbarBtn.classList.toggle('hidden', state.page !== 'stopwatch');

  updateSidebarCounts();
  toolbar.refresh();
  updateStatus();
}

let lastStatusLeft = '';
let lastStatusRight = '';

function updateStatus() {
  const runningTimers = state.timers.filter((t) => t.status === 'running').length;
  const enabledAlarms = state.alarms.filter((a) => a.enabled).length;
  let left = '';
  if (state.ringingAlarm) {
    left = `Ringing: ${state.ringingAlarm.label || state.ringingAlarm.time}`;
  } else if (runningTimers > 0) {
    left = `${runningTimers} running ${runningTimers === 1 ? 'timer' : 'timers'}`;
  } else if (state.stopwatch.running) {
    left = `Stopwatch running · ${formatStopwatchMs(stopwatchView.getElapsedMs())}`;
  } else if (enabledAlarms > 0) {
    left = `${enabledAlarms} active ${enabledAlarms === 1 ? 'alarm' : 'alarms'}`;
  } else {
    left = `${state.cities.length} world ${state.cities.length === 1 ? 'city' : 'cities'}`;
  }
  const right = formatInZone(now(), state.referenceZone || 'local', { seconds: true });
  if (left !== lastStatusLeft) {
    lastStatusLeft = left;
    statusLeft.textContent = left;
  }
  if (right !== lastStatusRight) {
    lastStatusRight = right;
    statusRight.textContent = right;
  }
}

export function showPage(pageId) {
  const id = PAGE_META[pageId] ? pageId : 'world';
  state.page = id;
  settings.set('activePage', id);
  for (const [k, m] of Object.entries(PAGE_META)) {
    m.view.el.classList.toggle('hidden', k !== id);
  }
  PAGE_META[id].view.render();
  updateChrome();
  return id;
}

// ---- persistence load / restore ---------------------------------------------

export function reloadFromSettings() {
  const currentNow = now();
  const savedCities = settings.get('cities');
  state.cities = Array.isArray(savedCities)
    ? savedCities.map((c) => worldView.normalizeCityEntry(c)).filter(Boolean)
    : [...DEFAULT_CITIES];

  const savedTimers = settings.get('timers');
  state.timers = Array.isArray(savedTimers)
    ? savedTimers.map((t) => {
      const copy = { ...t };
      if (copy.status === 'running' && copy.endAt != null) {
        copy.remainingMs = Math.max(0, copy.endAt - currentNow);
      }
      return copy;
    })
    : [];

  const savedAlarms = settings.get('alarms');
  state.alarms = Array.isArray(savedAlarms)
    ? savedAlarms.map((a) => alarmsView.normalizeAlarm(a))
    : [];
  state.ringingAlarm = state.alarms.find((a) => a.ringing) || null;

  const savedSw = settings.get('stopwatch');
  if (savedSw && typeof savedSw === 'object') {
    state.stopwatch = {
      running: !!savedSw.running,
      startedAt: savedSw.startedAt != null ? Number(savedSw.startedAt) : null,
      elapsedMs: Number(savedSw.elapsedMs) || 0,
      laps: Array.isArray(savedSw.laps) ? savedSw.laps.map((l) => ({ ...l })) : [],
    };
  } else {
    state.stopwatch = { running: false, startedAt: null, elapsedMs: 0, laps: [] };
  }

  const savedPage = settings.get('activePage');
  if (savedPage && PAGE_META[savedPage]) {
    state.page = savedPage;
  }

  worldView.render();
  timersView.render();
  stopwatchView.render();
  alarmsView.render();
  showPage(state.page);
  return state;
}

// ---- tick loop --------------------------------------------------------------

export function tick() {
  // Always check background timers and alarms regardless of active page
  timersView.tick();
  alarmsView.tick();

  // Only update DOM of the visible page
  if (state.page === 'world') worldView.tick();
  else if (state.page === 'stopwatch') stopwatchView.tick();

  updateSidebarCounts();
  updateStatus();
}

function setNow(ms, opts = {}) {
  if (opts && opts.referenceZone) {
    state.referenceZone = opts.referenceZone;
  } else if (ms !== null && ms !== undefined && !opts.keepLocalZone) {
    // When tests pin an exact UTC instant via setNow(Date.UTC(...)), use UTC
    // as the reference day unless local zone was explicitly requested.
    state.referenceZone = 'UTC';
  } else if (ms === null) {
    state.referenceZone = 'local';
  }
  setClockNow(ms);
}

onClockOverride(() => {
  worldView.render();
  timersView.render();
  stopwatchView.render();
  alarmsView.render();
  tick();
});

// Initialize from settings synchronously for the first frame (settings uses bro.conf in-memory cache)
reloadFromSettings();

// Periodic 250ms tick for clocks, timers, and alarms; plus rAF when stopwatch is actively running
setInterval(() => tick(), 250);

function rafLoop() {
  if (state.stopwatch.running || state.timers.some((t) => t.status === 'running')) {
    tick();
  }
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);

app.onLaunch(({ argv }) => {
  const pageArg = (argv || []).find((a) => PAGE_META[a]);
  if (pageArg) showPage(pageArg);
});

// Expose full state and helpers for headless tests
app.expose({
  state,
  settings,
  commands,
  sidebar,
  showPage,
  setNow,
  getNow: now,
  advanceClock: advanceClockMs,
  tick,
  reloadFromSettings,
  // Timezone helpers
  citiesCatalog: CITIES,
  findCity,
  searchCities,
  formatInZone,
  formatDateInZone,
  getZoneOffsetMin,
  getZonedParts,
  getRelativeDayAndOffset,
  // World Clock
  addCity: worldView.addCity,
  removeCity: worldView.removeCity,
  moveCity: worldView.moveCity,
  openAddCityDialog: worldView.openAddCityDialog,
  // Timers
  addTimer: timersView.addTimer,
  startTimer: timersView.startTimer,
  pauseTimer: timersView.pauseTimer,
  resetTimer: timersView.resetTimer,
  deleteTimer: timersView.deleteTimer,
  addOneMinute: timersView.addOneMinute,
  computeRemainingMs: timersView.computeRemainingMs,
  // Stopwatch
  swStart: stopwatchView.swStart,
  swStop: stopwatchView.swStop,
  swToggle: stopwatchView.swToggle,
  swLap: stopwatchView.swLap,
  swReset: stopwatchView.swReset,
  swCopyLaps: stopwatchView.swCopyLaps,
  formatStopwatchMs,
  // Alarms
  addAlarm: alarmsView.addAlarm,
  updateAlarm: alarmsView.updateAlarm,
  toggleAlarm: alarmsView.toggleAlarm,
  deleteAlarm: alarmsView.deleteAlarm,
  snoozeAlarm: alarmsView.snoozeAlarm,
  dismissAlarm: alarmsView.dismissAlarm,
  // Sound
  playChime: (kind) => playChime(state, kind),
});
