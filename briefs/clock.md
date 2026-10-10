# Brief: Clocks

| | |
|---|---|
| Folder | `helmapps/clock/` |
| id | `helm.clock` |
| Replaces | GNOME Clocks, KClock, Windows Alarms & Clock |
| Size | about 2000 lines |
| Permissions | none |

## What it is

World clocks, timers, a stopwatch, and alarms.

## Read first

- `../AGENTS.md`, `../lib/README.md`, `../diskusage/`
- `../bro/docs/audio-synth-graph-api.js`: make the alarm and timer sounds with a `SynthGraph` (no audio files needed)
- `../bro/docs/time-api.js`: note that `bro.time` is the app's *scaled game clock*. Do not use it for wall time; use `Date` and `performance.now()`.
- JS `Intl.DateTimeFormat` with `timeZone`: check what bro supports (file a gap if time zones are missing)
- `lib/format.js` `formatTime` follows helm's 24-hour setting

## Must have

1. **Pages** in the sidebar: World, Alarms, Timers, Stopwatch.
2. **World:** the local time large, plus a list of added cities, each with
   its time, date offset ("Tomorrow"), and difference ("+9 h"). Add a city
   from a searchable list of IANA zones, with friendly city names (ship a
   compact table of about 400 cities → zone in `js/cities.js`). Reorder and
   remove. Updates every second, aligned to the second boundary.
3. **Timers:** several at once, each with a label, duration presets (1, 3,
   5, 10, 15, 30 min) and custom entry, start/pause/reset, and a ring
   showing progress (SVG or canvas). When one ends: a sound, a toast, and
   the window raised and flashing (`bro.window.requestAttention` if
   available). Times are based on `Date.now()` deadlines, not counted ticks,
   so they stay exact.
4. **Stopwatch:** start/stop/reset, laps with lap and split times, best and
   worst lap highlighted, and hundredths shown. Space starts and stops, L
   records a lap.
5. **Alarms:** time, label, repeat days, enabled switch, snooze 10 min.
   They ring only while the app is running; the app says so plainly on the
   page ("Alarms ring while Clocks is open"). File the gap for a background
   alarm service, Belongs in: bro or helm.
6. Desktop notifications: bro has no app-side notification API (see
   `../GAPS.md`). Use the in-app toast and window attention instead.
7. Everything persists: cities, alarms, timers in progress (a running
   timer resumes with the right remaining time after a restart), and laps.

## Acceptance tests

Use the headless virtual clock: `advanceTime(ms)` moves timers and
animation frames. Make the app read time through one function (`now()`)
that tests can offset, since `Date.now()` is wall time.

1. A city's time for a fixed instant in `Asia/Tokyo` and `America/New_York`
   matches the expected string (skip if `Intl` time zones are missing,
   with a GAPS entry).
2. Starting a 1-minute timer and advancing past its deadline fires the end
   handler once, and the toast appears.
3. Pausing a timer halfway and resuming keeps the remaining time.
4. Stopwatch laps: three laps with known offsets list in order, with the
   best and worst marked.
5. An alarm set for "now + 1 min" fires when the clock passes it, and
   snooze re-fires 10 min later. A disabled alarm does not fire.
6. Restart persistence: a running timer, an alarm and a city survive a
   reload of the settings.

## Not in this pass

Background alarms (blocked on bro), sunrise and sunset, a bedtime mode.
