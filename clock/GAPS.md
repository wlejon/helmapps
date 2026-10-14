# Gaps found building Clocks (`helm.clock`)

## Intl.DateTimeFormat ignores the timeZone option
- **Where:** `bronze` JS runtime (`Intl.DateTimeFormat`)
- **Expected:** `new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(Date.UTC(2024, 0, 15, 12, 0, 0))` → `'21'`, differing from `'UTC'` (`'12'`).
- **Actual:** `Intl.DateTimeFormat` ignores the `timeZone` option and formats every timestamp in the host's local timezone.
- **Repro:** `bro-headless clock -e "console.log(new Intl.DateTimeFormat('en-US', {timeZone:'UTC',hour:'2-digit',hour12:false}).format(0), new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Tokyo',hour:'2-digit',hour12:false}).format(0))"`
- **Impact:** World Clocks cannot rely on `Intl.DateTimeFormat` alone to shift into IANA timezones. `js/tz-data.js` tests whether `Intl.DateTimeFormat` shifts between `'UTC'` and `'Asia/Tokyo'` at startup and falls back to UTC offset + regional DST rules (`us`, `eu`, `au`, `nz`) across the bundled world city catalog.
- **Belongs in:** bronze

## No background alarm / wake timer service
- **Where:** `bro` / `helm`
- **Expected:** An app can register scheduled alarm instants with a system/session daemon so alarms ring and post a notification even after the Clocks window is closed.
- **Actual:** No background timer or alarm daemon exists yet. Alarms can only be evaluated and rung while the `helm.clock` process is open.
- **Impact:** The Alarms page displays a clear notice (`"Alarms ring while Clocks is open"`) and fires alarms with a `SynthGraph` chime, toast, ringing banner, and `bro.window.requestAttention` while the app is running.
- **Belongs in:** bro / helm
