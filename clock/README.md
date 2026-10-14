# Clocks (`helm.clock`)

World clocks, alarms, countdown timers, and a high-precision stopwatch for the helm desktop.

## Features

- **World Clock:** Large local time readout alongside cards for added world cities showing live time, day/night icon (`sun` / `moon`), relative day badge (`Today`, `Tomorrow`, `Yesterday`), and UTC offset difference (`+9 h`, `-5 h`, `Same time`). Includes a searchable catalog of 125+ cities across all major IANA timezones, reordering, and removal.
- **Alarms:** Scheduled alarms with custom labels, repeating weekday toggles, enable/disable switches, and 10-minute snooze. Synthesizes its alarm chime with `SynthGraph` (no external audio files required). Displays a notice that alarms ring while Clocks is open.
- **Timers:** Multiple concurrent countdown timers with preset chips (`1m`, `3m`, `5m`, `10m`, `15m`, `30m`, `1h`), custom duration dialog, circular SVG progress rings, `+1:00` quick-add, and exact `now()` deadline tracking that survives restarts.
- **Stopwatch:** Hundredths-precision (`MM:SS.cc` / `HH:MM:SS.cc`) readout with lap and split times, automatic highlighting of the fastest (`Best`) and slowest (`Worst`) laps, and one-click TSV export to the clipboard.

## Running and Testing

Run all headless tests from `helmapps/`:

```bash
scripts/run_tests.sh clock
VERBOSE=1 scripts/run_tests.sh clock perf
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+1` .. `Mod+4` | Switch to World, Alarms, Timers, or Stopwatch |
| `Mod+N` | Add City (World), Add Alarm (Alarms), or New Timer (Timers) |
| `Space` | Start / Stop Stopwatch (on Stopwatch page) |
| `L` | Record Lap (on Stopwatch page) |
| `R` | Reset Stopwatch (on Stopwatch page) |
| `Mod+C` | Copy Stopwatch Laps as TSV (on Stopwatch page) |
| `Mod+Q` | Quit |
