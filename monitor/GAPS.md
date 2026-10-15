# Engine & Kit Gaps (`helm.monitor`)

## 1. Disk I/O and Network throughput counters on Windows
- **Where:** `brokit` `os` module (`require('os')`) / `bro.sys`
- **Expected:** Cross-platform disk read/write byte counters and network interface rx/tx byte counters (similar to `/proc/diskstats` and `/proc/net/dev` on Linux).
- **Actual:** `os.networkInterfaces()` returns interface addresses (`IPv4`/`IPv6`/`mac`), not byte counters, and `os` has no disk I/O counters on Windows.
- **Repro:** `bro-headless monitor -e "console.log(Object.keys(require('os').networkInterfaces()))"`
- **Impact:** Disk I/O and Network throughput graphs populate from `/proc/diskstats` and `/proc/net/dev` on Linux (and in fixture tests), and remain at `0 B/s` on Windows.
- **Belongs in:** `brokit`

## 2. Resolved: `bro.gpu.deviceName()` / `bro.gpu.memoryInfo()` caching
- **Where:** `bro.gpu` (`deviceName()`, `memoryInfo()`)
- **Status:** Resolved. `bro.gpu.deviceName()` and `bro.gpu.memoryInfo()` cache static device properties and avoid synchronous driver stalls on repeated reads.

## 3. Resolved: `window.devicePixelRatio` caching
- **Where:** `bro` DOM `window.devicePixelRatio` getter
- **Status:** Resolved. `window.devicePixelRatio` returns the cached display scale factor updated on display/DPI change events.

## 4. Resolved: Cross-platform process listing and termination (`bro.sys.processes`)
- **Where:** `brosys` (`bro.sys.processes.list`, `bro.sys.processes.kill`, `bro.sys.listProcesses`, `bro.sys.killProcess`)
- **Status:** Resolved. `helm.monitor` requests `"permissions": ["sys"]`, polls `bro.sys.processes.list()` when `/proc` is absent, computes per-process CPU % deltas from `cpuTimeMs` (`userTimeMs + kernelTimeMs`) over elapsed wall-clock time, and wires **End Process** (`SIGTERM` / `15`, `Delete`) and **Kill Process** (`SIGKILL` / `9`, `Shift+Delete` with confirmation dialog) to `bro.sys.processes.kill(pid, signal)`.
