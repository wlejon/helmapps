/**
 * When each frame of a burst was taken, and how long each shows in the
 * animation made from it.
 *
 * Times are real: EXIF DateTimeOriginal with its sub-seconds
 * (bro.image.readExif's `dateTaken`). A camera's burst runs at ~10-12 fps,
 * but between bursts the photographer waited seconds; played at real time
 * the animation would freeze there. So a gap longer than a burst's own
 * interval is trimmed to a short hold. What the user controls:
 *
 *   hold       seconds a trimmed gap shows for (default 0.1)
 *   speed      a multiplier on everything not overridden (2 = twice as fast)
 *   frame.hold a per-frame override: that frame shows this many seconds,
 *              whatever its interval and the speed
 *   frame.included  false leaves the frame out; the intervals are then
 *              measured between the frames that stay, so real time is kept
 *
 *   const s = schedule(frames, { hold: 0.1, speed: 1 });
 *   s.frames        [{ index, start, duration, gap, interval }] the included ones, in order
 *   s.total         seconds the animation lasts
 *   s.realElapsed   seconds from the first included frame to the last, as shot
 *   gifDelays(s)    centiseconds per frame, rounded so the total does not drift
 *   repeatCounts(s, fps)   copies of each frame at a fixed frame rate (WebM)
 */

/** A gap is an interval longer than this many seconds ... */
export const GAP_SECONDS = 0.4;
/** ... or than this many median intervals. */
export const GAP_MEDIANS = 3;
/** The interval assumed when a frame has no time (no EXIF), in seconds. */
export const DEFAULT_INTERVAL = 0.1;
/** The shortest a GIF frame is written as: viewers show 1 cs (or 0) as 10. */
export const MIN_GIF_CS = 2;

/**
 * Seconds since the epoch from EXIF's dateTaken ("2025-05-10T08:41:46.24",
 * with an offset when the camera wrote one), or NaN. Without an offset the
 * time is read as UTC: only differences between frames of one camera matter.
 */
export function exifSeconds(dateTaken) {
  if (!dateTaken || typeof dateTaken !== 'string') return NaN;
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(\.\d+)?(Z|[+-]\d\d:?\d\d)?$/.exec(dateTaken.trim());
  if (!m) return NaN;
  const [, Y, Mo, D, H, Mi, S, frac, zone] = m;
  let t = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S) / 1000 + (frac ? parseFloat(frac) : 0);
  if (zone && zone !== 'Z') {
    const zm = /([+-])(\d\d):?(\d\d)/.exec(zone);
    t -= (zm[1] === '-' ? -1 : 1) * (Number(zm[2]) * 3600 + Number(zm[3]) * 60);
  }
  return t;
}

function median(xs) {
  if (!xs.length) return DEFAULT_INTERVAL;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Fill in times for frames without one: the frame before it plus the
 * typical interval (the first such frame, the one after it minus that).
 */
export function fillTimes(times) {
  const t = times.map((x) => (Number.isFinite(x) ? x : NaN));
  if (!t.some(Number.isFinite)) return t.map((_, i) => i * DEFAULT_INTERVAL);
  for (let i = 1; i < t.length; i++) if (!Number.isFinite(t[i]) && Number.isFinite(t[i - 1])) t[i] = t[i - 1] + DEFAULT_INTERVAL;
  for (let i = t.length - 2; i >= 0; i--) if (!Number.isFinite(t[i])) t[i] = t[i + 1] - DEFAULT_INTERVAL;
  return t;
}

/** The interval above which a step between frames is a gap, for these intervals. */
export function gapThreshold(intervals) {
  const positive = intervals.filter((d) => d > 0);
  return Math.min(GAP_SECONDS, GAP_MEDIANS * median(positive));
}

/**
 * Bursts: runs of consecutive frames whose steps are no gap. Answers an
 * array of [first, last] index pairs (inclusive) over `times`.
 */
export function bursts(times) {
  const t = fillTimes(times);
  if (!t.length) return [];
  const steps = t.slice(1).map((x, i) => x - t[i]);
  const limit = gapThreshold(steps);
  const out = [];
  let start = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] > limit || steps[i] < 0) { out.push([start, i]); start = i + 1; }
  }
  out.push([start, t.length - 1]);
  return out;
}

/** The burst holding index i, as [first, last]. */
export function burstOf(times, i) {
  return bursts(times).find(([a, b]) => i >= a && i <= b) || [i, i];
}

/**
 * The animation's timeline.
 * frames: [{ time (seconds, NaN when unknown), included = true, hold = null }]
 * opts:   { hold = 0.1, speed = 1 }
 */
export function schedule(frames, { hold = 0.1, speed = 1 } = {}) {
  const sp = speed > 0 ? speed : 1;
  const times = fillTimes(frames.map((f) => f.time));
  const kept = frames.map((f, i) => i).filter((i) => frames[i].included !== false);
  const intervals = kept.slice(1).map((k, j) => times[k] - times[kept[j]]);
  const limit = gapThreshold(intervals);
  const typical = median(intervals.filter((d) => d > 0 && d <= limit));
  const out = [];
  let start = 0;
  kept.forEach((k, j) => {
    // A frame lasts until the next one was taken; the last one, a typical interval.
    const interval = j < intervals.length ? intervals[j] : typical;
    const gap = j < intervals.length && (interval > limit || interval < 0);
    const override = frames[k].hold;
    const duration = override != null && override >= 0 ? override : (gap ? hold : Math.max(0, interval)) / sp;
    out.push({ index: k, start, duration, gap, interval });
    start += duration;
  });
  const realElapsed = kept.length > 1 ? times[kept[kept.length - 1]] - times[kept[0]] : 0;
  return { frames: out, total: start, realElapsed, gapLimit: limit, typical };
}

/**
 * GIF delays in centiseconds, one per scheduled frame: each the rounded end
 * minus the rounded start, so the rounding never adds up; at least MIN_GIF_CS.
 */
export function gifDelays(s) {
  let written = 0;
  return s.frames.map((f) => {
    const end = Math.round((f.start + f.duration) * 100);
    const cs = Math.max(MIN_GIF_CS, end - written);
    written += cs;
    return cs;
  });
}

/**
 * At a fixed frame rate, how many copies of each frame: the frames whose
 * timestamps fall in its time, at least one (a frame shorter than 1/fps
 * still shows once; the ones after it catch up).
 */
export function repeatCounts(s, fps) {
  let written = 0;
  return s.frames.map((f) => {
    const end = Math.round((f.start + f.duration) * fps);
    const n = Math.max(1, end - written);
    written += n;
    return n;
  });
}
