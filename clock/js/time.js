/**
 * Central virtual-aware clock for Clocks.
 *
 * In bro-headless, advanceTime(ms) advances performance.now() and drives
 * timers/rAF, whereas Date.now() stays on real wall-clock time. By anchoring
 * wall time to performance.now() at startup (or to a test-supplied override),
 * advancing headless time advances now() by the exact same delta.
 */

const bootWall = Date.now();
const bootPerf = performance.now();

let overrideNow = null;
let overridePerf = 0;
let offsetMs = 0;
let onChange = null;

/** Current epoch milliseconds, tracking headless virtual time and any test override. */
export function now() {
  if (overrideNow !== null) {
    return Math.round(overrideNow + (performance.now() - overridePerf));
  }
  return Math.round(bootWall + (performance.now() - bootPerf) + offsetMs);
}

/** Pin the clock to an exact epoch timestamp (ms) from this moment onward. */
export function setNow(ms) {
  if (ms === null || ms === undefined) {
    overrideNow = null;
    overridePerf = 0;
    offsetMs = 0;
  } else {
    overrideNow = Number(ms);
    overridePerf = performance.now();
  }
  if (onChange) onChange();
}

/** Shift the clock forward or backward by deltaMs. */
export function advanceClock(deltaMs) {
  const d = Number(deltaMs) || 0;
  if (overrideNow !== null) {
    overrideNow += d;
  } else {
    offsetMs += d;
  }
  if (onChange) onChange();
}

/** Register a callback invoked whenever setNow or advanceClock is called. */
export function onClockOverride(fn) {
  onChange = fn;
}
