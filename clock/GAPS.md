# Gaps found building Clocks (`helm.clock`)

## Resolved: Intl.DateTimeFormat honours the IANA timeZone option
- **Where:** `bronze` JS runtime (`Intl.DateTimeFormat`)
- **Status:** Resolved in `bronze` commit `53f30c3`. `js/tz-data.js` detects `INTL_TZ_WORKS === true` at startup and uses cached `Intl.DateTimeFormat` instances with IANA `timeZone` (`formatToParts`) across all world clock zones.

## No background alarm / wake timer service
- **Where:** `bro` / `helm`
- **Expected:** An app can register scheduled alarm instants with a system/session daemon so alarms ring and post a notification even after the Clocks window is closed.
- **Actual:** No background timer or alarm daemon exists yet. Alarms can only be evaluated and rung while the `helm.clock` process is open.
- **Impact:** The Alarms page displays a clear notice (`"Alarms ring while Clocks is open"`) and fires alarms with a `SynthGraph` chime, toast, ringing banner, and `bro.window.requestAttention` while the app is running.
- **Belongs in:** bro / helm
