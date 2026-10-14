// Alarms acceptance test:
// - Banner states "Alarms ring while Clocks is open".
// - An enabled alarm set for "now + 1 min" fires when the clock passes it.
// - Snooze re-fires 10 minutes later.
// - A disabled alarm does not fire when the clock passes its time.

import { app, eq, clickEl } from '/lib/test.js';

app.showPage('alarms');

// Check required page banner
const banner = document.querySelector('.alarm-info-banner');
assert(banner && banner.textContent.includes('Alarms ring while Clocks is open'), 'Alarms page states that alarms ring while Clocks is open');

// Pin virtual time to 2024-01-15 08:30:00 UTC
const baseTime = Date.UTC(2024, 0, 15, 8, 30, 0);
app.setNow(baseTime);

// Clear any existing alarms
while (app.state.alarms.length) {
  app.deleteAlarm(app.state.alarms[0].id);
}
app.state.alarmFireEvents = 0;

// 1. Add an enabled alarm for "now + 1 min" (08:31) and a disabled alarm for "now + 2 min" (08:32)
const enabledAlarm = app.addAlarm({ hour: 8, minute: 31, label: 'Morning Standup', enabled: true });
const disabledAlarm = app.addAlarm({ hour: 8, minute: 32, label: 'Disabled Check', enabled: false });

eq(enabledAlarm.ringing, false, 'enabled alarm is not ringing at 08:30');
eq(app.state.alarmFireEvents, 0, 'no alarm fire events yet');

// Advance 60 seconds to 08:31:00
advanceTime(60 * 1000);
app.tick();

eq(enabledAlarm.ringing, true, 'enabled alarm rings when clock reaches 08:31');
eq(enabledAlarm.firedCount, 1, 'enabled alarm fired once');
eq(app.state.ringingAlarm.id, enabledAlarm.id, 'state.ringingAlarm points to enabledAlarm');

const ringingBanner = document.querySelector('.alarm-ringing-banner');
assert(ringingBanner && !ringingBanner.classList.contains('hidden'), 'ringing banner is visible');
assert(document.querySelector('.toast'), 'alarm toast is shown');

// 2. Snooze the ringing alarm (10 minutes)
clickEl(ringingBanner.querySelector('.alarm-snooze-btn'));
eq(enabledAlarm.ringing, false, 'snoozed alarm stops ringing immediately');
assert(enabledAlarm.snoozedUntil > app.getNow(), 'snoozedUntil is set in the future');

// Advance 1 minute to 08:32:00 — passes the disabled alarm's time (08:32)
advanceTime(60 * 1000);
app.tick();
eq(disabledAlarm.ringing, false, 'disabled alarm does NOT fire at 08:32');
eq(disabledAlarm.firedCount, 0, 'disabled alarm firedCount stays 0');
eq(enabledAlarm.ringing, false, 'snoozed alarm not due yet after 1 min');

// Advance another 4 minutes (5 minutes total since snooze) -> still not ringing
advanceTime(4 * 60 * 1000);
app.tick();
eq(enabledAlarm.ringing, false, 'snoozed alarm still not ringing at +5 min');

// Advance another 5 minutes (10 minutes total since snooze) -> re-fires!
advanceTime(5 * 60 * 1000);
app.tick();
eq(enabledAlarm.ringing, true, 'snoozed alarm re-fires 10 minutes after snooze');
eq(enabledAlarm.firedCount, 2, 'enabled alarm has now fired twice');

// Dismiss the ringing alarm
clickEl(document.querySelector('.alarm-dismiss-btn'));
eq(enabledAlarm.ringing, false, 'alarm dismissed');
eq(app.state.ringingAlarm, null, 'no active ringing alarm after dismiss');

console.log('test_alarm PASSED');
