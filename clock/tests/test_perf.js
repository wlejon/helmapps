// Clocks performance & restart persistence test:
// 1. Verifies startup time (bro.app.startup).
// 2. Populates a heavy workload (20 world cities, 10 concurrent running timers,
//    15 alarms, and a running stopwatch with 100 laps) and measures frame times
//    across 60 frames and page switches with measureFrames(), asserting worst
//    frame < 50 ms.
// 3. Verifies restart persistence: a running timer, an alarm, a city, and
//    stopwatch laps survive reloadFromSettings() with accurate remaining time.

import { app, measureFrames, eq } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;

// ---- 1. Startup -------------------------------------------------------------
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `first frame follows load (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// ---- 2. Heavy workload across all 4 pages -----------------------------------
app.setNow(Date.UTC(2024, 0, 15, 12, 0, 0));

// 20 World cities
while (app.state.cities.length) app.removeCity(app.state.cities[0].id);
for (let i = 0; i < 20; i++) {
  app.addCity(app.citiesCatalog[i]);
}
eq(app.state.cities.length, 20, '20 world cities loaded');

// 10 Concurrent running timers
while (app.state.timers.length) app.deleteTimer(app.state.timers[0].id);
for (let i = 0; i < 10; i++) {
  app.addTimer({ durationMs: (i + 2) * 60000, label: `Timer #${i + 1}`, start: true });
}
eq(app.state.timers.length, 10, '10 concurrent timers running');

// 15 Alarms
while (app.state.alarms.length) app.deleteAlarm(app.state.alarms[0].id);
for (let i = 0; i < 15; i++) {
  app.addAlarm({ hour: (6 + i) % 24, minute: (i * 5) % 60, label: `Alarm #${i + 1}`, enabled: i % 2 === 0 });
}
eq(app.state.alarms.length, 15, '15 alarms configured');

// Stopwatch with 100 laps
app.swReset();
app.swStart();
for (let i = 0; i < 100; i++) {
  advanceTime(350 + (i % 7) * 40);
  app.swLap();
}
eq(app.state.stopwatch.laps.length, 100, '100 stopwatch laps recorded');

const pages = ['world', 'timers', 'stopwatch', 'alarms'];
let frameStep = 0;
const stats = measureFrames(() => {
  frameStep++;
  if (frameStep % 15 === 0) {
    app.showPage(pages[(frameStep / 15) % pages.length]);
  }
  return frameStep >= 60;
}, '60 frames under heavy load across all pages');

console.log(`heavy load: ${stats.frames} frames, worst ${stats.maxMs.toFixed(1)} ms, mean ${stats.avgMs.toFixed(1)} ms, ${stats.slow} over 16.7 ms`);
assert(stats.maxMs < FRAME_BUDGET_MS, `no frame over ${FRAME_BUDGET_MS} ms (worst ${stats.maxMs.toFixed(1)} ms)`);

// ---- 3. Restart persistence -------------------------------------------------
// Set up a clean state with 1 city, 1 running 5-min timer, 1 alarm, and 2 laps
while (app.state.cities.length) app.removeCity(app.state.cities[0].id);
while (app.state.timers.length) app.deleteTimer(app.state.timers[0].id);
while (app.state.alarms.length) app.deleteAlarm(app.state.alarms[0].id);
app.swReset();

const persistBase = Date.UTC(2024, 0, 15, 14, 0, 0);
app.setNow(persistBase);

const savedCity = app.addCity('tokyo');
const savedTimer = app.addTimer({ durationMs: 300000, label: 'Persisted Tea', start: true });
const savedAlarm = app.addAlarm({ hour: 16, minute: 45, label: 'Persisted Alarm', enabled: true, days: [1, 3, 5] });
app.swStart();
advanceTime(2500);
app.swLap();
app.swStop();

// Advance virtual clock by 60 seconds before reloading settings
advanceTime(60000);

// Wipe in-memory arrays and restore from settings
app.state.cities = [];
app.state.timers = [];
app.state.alarms = [];
app.state.stopwatch = { running: false, startedAt: null, elapsedMs: 0, laps: [] };

app.reloadFromSettings();

eq(app.state.cities.length, 1, 'city survived settings reload');
eq(app.state.cities[0].id, savedCity.id, 'restored city id matches');

eq(app.state.timers.length, 1, 'running timer survived settings reload');
const restoredTimer = app.state.timers[0];
eq(restoredTimer.label, 'Persisted Tea', 'restored timer label matches');
eq(restoredTimer.status, 'running', 'restored timer is still running');
assert(
  restoredTimer.remainingMs >= 235000 && restoredTimer.remainingMs <= 241000,
  `restored running timer has ~240s remaining after 60s elapsed (got ${restoredTimer.remainingMs})`
);

eq(app.state.alarms.length, 1, 'alarm survived settings reload');
eq(app.state.alarms[0].label, savedAlarm.label, 'restored alarm label matches');
eq(app.state.alarms[0].time, '16:45', 'restored alarm time matches');
eq(app.state.alarms[0].days, [1, 3, 5], 'restored alarm repeat days match');

eq(app.state.stopwatch.laps.length, 1, 'stopwatch lap survived settings reload');

console.log('test_perf PASSED');
