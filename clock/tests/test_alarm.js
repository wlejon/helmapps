// Alarms acceptance test:
// - Banner states that alarms ring with Clocks closed (launches scheduled with
//   the OS; headless records them and reaches no OS scheduler).
// - An enabled alarm set for "now + 1 min" fires when the clock passes it.
// - Snooze re-fires 10 minutes later.
// - A disabled alarm does not fire when the clock passes its time.
// - Every enabled alarm has a launch at its next ring; disabling or deleting
//   one removes it; a `--alarm <id>` launch rings it once.

import { app, eq, clickEl } from '/lib/test.js';

app.showPage('alarms');

// Check required page banner
const banner = document.querySelector('.alarm-info-banner');
assert(banner && banner.textContent.includes('even with Clocks closed'), `Alarms page states that alarms ring with Clocks closed: ${banner && banner.textContent}`);

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

// Scheduled launches: one per enabled alarm, at its next ring on the wall clock.
await app.syncSchedules();
const launches = () => new Map(bro.app.scheduled().map((s) => [s.id, s]));
let sched = launches();
eq(sched.size, 1, 'one launch: the enabled alarm only');
const launch = sched.get(enabledAlarm.id);
assert(launch, 'the enabled alarm has a launch');
eq(launch.args, ['--alarm', enabledAlarm.id], 'the launch names the alarm');
// The alarms' zone (the pinned clock above makes it UTC).
const zone = app.state.referenceZone;
const at = app.getZonedParts(launch.when, zone);
eq([at.hour, at.minute, at.second], [8, 31, 0], `at 08:31 in ${zone}`);
assert(launch.when > Date.now() && launch.when - Date.now() <= 86400000, 'the next one, within a day');
eq(launch.when, app.nextAlarmInstant(enabledAlarm, zone, Date.now()), 'nextAlarmInstant agrees');
eq(launch.wake, true, 'the launch wakes the machine');

// Repeat days: the next ring falls on one of them.
app.updateAlarm(enabledAlarm.id, { days: [3] });
await app.syncSchedules();
eq(app.getZonedParts(launches().get(enabledAlarm.id).when, zone).weekday, 3, 'a Wednesday alarm launches on a Wednesday');

// Enabling the second alarm schedules it; disabling and deleting remove launches.
app.toggleAlarm(disabledAlarm.id, true);
await app.syncSchedules();
assert(launches().has(disabledAlarm.id), 'enabled: scheduled');
app.toggleAlarm(disabledAlarm.id, false);
await app.syncSchedules();
assert(!launches().has(disabledAlarm.id), 'disabled: unscheduled');
app.deleteAlarm(disabledAlarm.id);

// A scheduled launch (`--alarm <id>`, as the OS starts Clocks) rings the alarm,
// once, and leaves its next launch scheduled.
app.showPage('world');
advanceTime(60 * 1000);  // past the minute it last rang in
const fired = enabledAlarm.firedCount;
await app.handleLaunch({ argv: ['--alarm', enabledAlarm.id] });
eq(app.state.page, 'alarms', 'the launch shows the Alarms page');
eq(enabledAlarm.ringing, true, 'the launch rings the alarm');
eq(enabledAlarm.firedCount, fired + 1, 'rang once');
await app.handleLaunch({ argv: ['--alarm', enabledAlarm.id] });
eq(enabledAlarm.firedCount, fired + 1, 'a second launch for the ringing alarm does not ring it again');
assert(launches().has(enabledAlarm.id), 'its next launch stays scheduled');
clickEl(document.querySelector('.alarm-dismiss-btn'));

app.deleteAlarm(enabledAlarm.id);
await app.syncSchedules();
eq(bro.app.scheduled().length, 0, 'deleted: no launches left');

console.log('test_alarm PASSED');
