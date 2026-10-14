# Engine & Kit Gaps (`helm.monitor`)

## 1. Disk I/O and Network throughput counters on Windows
- **Where:** `brokit` `os` module (`require('os')`) / `bro.sys`
- **Expected:** Cross-platform disk read/write byte counters and network interface rx/tx byte counters (similar to `/proc/diskstats` and `/proc/net/dev` on Linux).
- **Actual:** `os.networkInterfaces()` returns interface addresses (`IPv4`/`IPv6`/`mac`), not byte counters, and `os` has no disk I/O counters on Windows.
- **Repro:** `bro-headless monitor -e "console.log(Object.keys(require('os').networkInterfaces()))"`
- **Impact:** Disk I/O and Network throughput graphs populate from `/proc/diskstats` and `/proc/net/dev` on Linux (and in fixture tests), and remain at `0 B/s` on Windows.
- **Belongs in:** `brokit`

## 2. Synchronous `bro.gpu.deviceName()` / `bro.gpu.memoryInfo()` blocks the UI thread for ~145 ms
- **Where:** `bro.gpu` (`deviceName()`, `memoryInfo()`)
- **Expected:** Reading GPU name or memory info from a live monitor tick should be fast (<1 ms) or asynchronous off the main thread.
- **Actual:** Calling `bro.gpu.deviceName()` or `bro.gpu.memoryInfo()` synchronously probes the CUDA/Vulkan driver on the main thread, taking ~145 ms per call on Windows with NVIDIA GPUs.
- **Repro:** `bro-headless monitor -e "const t0 = perf.now(); bro.gpu.memoryInfo(); console.log(perf.now() - t0)"`
- **Impact:** `sys-sampler.js` reads GPU busy % and VRAM usage asynchronously from `/sys/class/drm/card*/device/gpu_busy_percent` and `mem_info_vram_*` without calling synchronous `bro.gpu.memoryInfo()` on the periodic sample tick.
- **Belongs in:** `bro`

## 3. `window.devicePixelRatio` calls `NtUserEnumDisplaySettings` on every read on Windows
- **Where:** `bro` DOM `window.devicePixelRatio` getter
- **Expected:** `window.devicePixelRatio` should return a cached float updated on DPI/display change events.
- **Actual:** Profiling with `bro.profiler` shows `NtUserEnumDisplaySettings` (`win32u.dll`) when `window.devicePixelRatio` is read repeatedly during canvas redraws.
- **Repro:** Read `window.devicePixelRatio` in a loop under `bro.profiler.start({ hz: 2000 })`.
- **Impact:** `ResourcesView` caches `window.devicePixelRatio` and refreshes it on window `resize`.
- **Belongs in:** `bro`

## 4. Resolved: Cross-platform process listing and termination (`bro.sys.processes`)
- **Where:** `brosys` (`bro.sys.processes.list`, `bro.sys.processes.kill`, `bro.sys.listProcesses`, `bro.sys.killProcess`)
- **Status:** Resolved. `helm.monitor` requests `"permissions": ["sys"]`, polls `bro.sys.processes.list()` when `/proc` is absent, computes per-process CPU % deltas from `cpuTimeMs` (`userTimeMs + kernelTimeMs`) over elapsed wall-clock time, and wires **End Process** (`SIGTERM` / `15`, `Delete`) and **Kill Process** (`SIGKILL` / `9`, `Shift+Delete` with confirmation dialog) to `bro.sys.processes.kill(pid, signal)`.
