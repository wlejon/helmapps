/**
 * Alarms that ring with Clocks closed: every enabled alarm has a launch
 * scheduled with the OS (bro.app.schedule: Task Scheduler, a systemd user
 * timer, a launchd agent) at its next ring, which starts Clocks with
 * `--alarm <id>` (or hands that to the running Clocks). The launch rings the
 * alarm; ringing, snoozing or editing one moves its launch to its next ring.
 */

import { getZoneOffsetMin, getZonedParts } from './cities.js';

const DAY_MS = 86400000;

/** The epoch ms of the alarm's next ring after `base`, in `zone`. */
export function nextAlarmInstant(alarm, zone, base) {
  const days = Array.isArray(alarm.days) ? alarm.days : [];
  for (let k = 0; k <= 8; ++k) {
    const d = getZonedParts(base + k * DAY_MS, zone);
    if (days.length && !days.includes(d.weekday)) continue;
    const wall = Date.UTC(d.year, d.month - 1, d.day, Number(alarm.hour) || 0, Number(alarm.minute) || 0);
    let at = wall - getZoneOffsetMin(wall, zone) * 60000;
    at = wall - getZoneOffsetMin(at, zone) * 60000;
    if (at > base) return at;
  }
  return null;
}

/** When the OS should start Clocks for this alarm, or null for never. */
function launchTime(alarm, zone, base) {
  if (!alarm.enabled) return null;
  if (alarm.snoozedUntil != null && alarm.snoozedUntil > base) return alarm.snoozedUntil;
  return nextAlarmInstant(alarm, zone, base);
}

export const ALARM_ARG = '--alarm';

/** The alarm id a launch's argv names, or null. */
export function alarmFromArgv(argv) {
  const i = (argv || []).indexOf(ALARM_ARG);
  return i >= 0 && i + 1 < argv.length ? String(argv[i + 1]) : null;
}

export function createAlarmScheduler({ state, clockNow, onStatus }) {
  const appApi = typeof bro !== 'undefined' && bro && bro.app ? bro.app : null;
  const supported = !!(appApi && typeof appApi.schedule === 'function');
  state.alarmScheduling = supported
    ? { ok: true, reason: '' }
    : { ok: false, reason: 'scheduled launches are not in this build' };

  let running = null;
  let again = false;

  function report(ok, reason) {
    if (state.alarmScheduling.ok === ok && state.alarmScheduling.reason === reason) return;
    state.alarmScheduling = { ok, reason };
    if (onStatus) onStatus(state.alarmScheduling);
  }

  async function syncOnce() {
    // The OS runs on the wall clock; the page's clock may be pinned (tests).
    const base = Math.max(clockNow(), Date.now());
    const zone = state.referenceZone || 'local';
    const have = new Map(appApi.scheduled().map((s) => [s.id, s]));
    let failure = null;
    for (const a of state.alarms) {
      const when = launchTime(a, zone, base);
      const s = have.get(a.id);
      have.delete(a.id);
      if (when == null) {
        if (s) appApi.unschedule(a.id);
        continue;
      }
      if (s && Math.abs(s.when - when) < 1000) continue;
      try {
        await appApi.schedule(a.id, when, { args: [ALARM_ARG, a.id], wake: true });
      } catch (err) {
        failure = failure || err;
      }
    }
    for (const id of have.keys()) appApi.unschedule(id);
    if (failure) report(false, failure.message || String(failure));
    else report(true, '');
  }

  /** Bring the OS's launches in line with the alarms. Resolves when done. */
  function sync() {
    if (!supported) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try { await syncOnce(); } catch (err) { report(false, err.message || String(err)); }
      } while (again);
      running = null;
    })();
    return running;
  }

  return { sync, supported };
}
