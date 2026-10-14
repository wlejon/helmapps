// Timers acceptance test:
// - Starting a 1-minute (60,000 ms) timer and advancing past its deadline fires
//   the end handler once, and the toast appears.
// - Pausing a timer halfway and resuming keeps the remaining time.
// - +1:00 adds 60 seconds to a timer.

import { app, waitFor, eq, clickEl } from '/lib/test.js';

app.showPage('timers');
app.setNow(Date.UTC(2024, 0, 15, 12, 0, 0));

// Clear any existing timers
while (app.state.timers.length) {
  app.deleteTimer(app.state.timers[0].id);
}
app.state.timerEndEvents = 0;

// 1. Start a 1-minute timer via preset chip and advance past deadline
const chip1m = document.querySelector('.timer-preset-chip[data-preset-ms="60000"]');
assert(chip1m, '1m preset chip exists');
clickEl(chip1m);

eq(app.state.timers.length, 1, 'one timer created');
const t1 = app.state.timers[0];
eq(t1.status, 'running', 'timer starts running');
eq(t1.durationMs, 60000, 'duration is 60,000 ms');

// Advance past the 60s deadline
advanceTime(61000);
app.tick();

eq(t1.status, 'finished', 'timer transitions to finished');
eq(t1.firedCount, 1, 'timer end handler fired once');
eq(app.state.timerEndEvents, 1, 'state.timerEndEvents incremented once');

const toastEl = document.querySelector('.toast');
assert(toastEl && toastEl.textContent.includes('Timer finished'), 'toast appears when timer finishes');

// Advance further to verify it does not fire a second time
advanceTime(5000);
app.tick();
eq(t1.firedCount, 1, 'timer end handler still fired only once');

// 2. Pausing a timer halfway keeps remaining time, and resuming finishes after the rest
const t2 = app.addTimer({ durationMs: 60000, label: 'Halfway Test', start: true });
advanceTime(30000);
app.pauseTimer(t2.id);

eq(t2.status, 'paused', 'second timer is paused');
assert(t2.remainingMs >= 29000 && t2.remainingMs <= 30500, `remainingMs (~30s) was ${t2.remainingMs}`);

// While paused, advancing virtual time by 45s does not reduce remainingMs
advanceTime(45000);
app.tick();
eq(t2.status, 'paused', 'still paused after 45s');
assert(t2.remainingMs >= 29000 && t2.remainingMs <= 30500, `remainingMs unchanged while paused (${t2.remainingMs})`);

// Resume and verify it does not finish after 15s, then finishes after another 20s
app.startTimer(t2.id);
eq(t2.status, 'running', 'resumed timer is running');
advanceTime(15000);
app.tick();
eq(t2.status, 'running', 'still running with ~15s left');

advanceTime(20000);
app.tick();
eq(t2.status, 'finished', 'finished after remaining 30s elapsed');
eq(t2.firedCount, 1, 'second timer fired once');

// 3. +1:00 button adds 60,000 ms to a timer
const t3 = app.addTimer({ durationMs: 30000, label: 'Plus Minute Test', start: false });
eq(t3.remainingMs, 30000, 'starts at 30s');
const card3 = document.querySelector(`.timer-card[data-timer-id="${t3.id}"]`);
assert(card3, 'third timer card rendered');
clickEl(card3.querySelector('.timer-plus-min'));
eq(t3.remainingMs, 90000, '+1:00 added 60,000 ms');

console.log('test_timer PASSED');
