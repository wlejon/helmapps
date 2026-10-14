# Engine & Kit Gaps (`helm.monitor`)

## 1. Cross-platform process listing and per-process metrics on Windows
- **Where:** `brokit` / `bro.sys` (no process table API on Windows)
- **Expected:** A native asynchronous API to enumerate running processes (PID, PPID, name, command line, user, CPU time, RSS memory, thread count, state) on platforms without `/proc` (Windows, macOS).
- **Actual:** Linux provides all process and performance metrics through `/proc` and `/sys`. On Windows there is no `/proc` and no `bro` process enumeration API yet.
- **Repro:** `bro-headless monitor -e "console.log(window.app.procSampler.supported)"` on Windows → `false`.
- **Impact:** On Windows (when not pointed at a `/proc` root), the **Processes** page shows the empty state `"Process and performance data on this platform needs bro support"`, while **Performance** falls back to `os.cpus()` / `os.totalmem()` / `os.freemem()` and **File Systems** lists drives via `bro.vfs.volumes()`.
- **Belongs in:** `brokit`

## 2. Disk I/O and Network throughput counters on Windows
- **Where:** `brokit` `os` module (`require('os')`)
- **Expected:** Cross-platform disk read/write byte counters and network interface rx/tx byte counters (similar to `/proc/diskstats` and `/proc/net/dev` on Linux).
- **Actual:** `os.networkInterfaces()` returns interface addresses (`IPv4`/`IPv6`/`mac`), not byte counters, and `os` has no disk I/O counters on Windows.
- **Repro:** `bro-headless monitor -e "console.log(Object.keys(require('os').networkInterfaces()))"`
- **Impact:** Disk I/O and Network throughput graphs populate from `/proc/diskstats` and `/proc/net/dev` on Linux (and in fixture tests), and remain at `0 B/s` on Windows.
- **Belongs in:** `brokit`

## 3. Synchronous `bro.gpu.deviceName()` / `bro.gpu.memoryInfo()` blocks the UI thread for ~145 ms
- **Where:** `bro.gpu` (`deviceName()`, `memoryInfo()`)
- **Expected:** Reading GPU name or memory info from a live monitor tick should be fast (<1 ms) or asynchronous off the main thread.
- **Actual:** Calling `bro.gpu.deviceName()` or `bro.gpu.memoryInfo()` synchronously probes the CUDA/Vulkan driver on the main thread, taking ~145 ms per call on Windows with NVIDIA GPUs.
- **Repro:** `bro-headless monitor -e "const t0 = perf.now(); bro.gpu.memoryInfo(); console.log(perf.now() - t0)"`
- **Impact:** `sys-sampler.js` reads GPU busy % and VRAM usage asynchronously from `/sys/class/drm/card*/device/gpu_busy_percent` and `mem_info_vram_*` without calling synchronous `bro.gpu.memoryInfo()` on the periodic sample tick.
- **Belongs in:** `bro`

## 4. `window.devicePixelRatio` calls `NtUserEnumDisplaySettings` on every read on Windows
- **Where:** `bro` DOM `window.devicePixelRatio` getter
- **Expected:** `window.devicePixelRatio` should return a cached float updated on DPI/display change events.
- **Actual:** Profiling with `bro.profiler` shows `NtUserEnumDisplaySettings` (`win32u.dll`) when `window.devicePixelRatio` is read repeatedly during canvas redraws.
- **Repro:** Read `window.devicePixelRatio` in a loop under `bro.profiler.start({ hz: 2000 })`.
- **Impact:** `ResourcesView` caches `window.devicePixelRatio` and refreshes it on window `resize`.
- **Belongs in:** `bro`

## 5. Brief vs `brokit` documentation notes (`os.cpus`, `os.totalmem`, `os.loadavg`, `process.kill`)
- **Where:** `briefs/monitor.md` vs `../bro/docs/brokit-api.js`
- **Expected:** `briefs/monitor.md` notes that `os` lacked `cpus()`, `totalmem()`, and `loadavg()` and that `brokit` lacked `process.kill`.
- **Actual:** Current `brokit` implements `os.cpus()`, `os.totalmem()`, `os.freemem()`, `os.uptime()`, `os.loadavg()`, and `process.kill(pid, signal?)`.
- **Impact:** `sys-sampler.js` uses `os.cpus()`, `os.totalmem()`, `os.freemem()`, `os.uptime()`, and `os.loadavg()` as a live fallback when `/proc` is absent. Per the brief's explicit instruction (*"show the actions disabled with 'needs bro support' and file the gap"*), **End Process** and **Kill Process** remain disabled with `(needs bro support)` in the UI and context menu so the app matches the brief specification and never signals arbitrary host PIDs during fake-`/proc` tests.
- **Belongs in:** `docs`
