# Brief: System Monitor

| | |
|---|---|
| Folder | `helmapps/monitor/` |
| id | `helm.monitor` |
| Replaces | System Monitor (KDE / GNOME), btop, Task Manager |
| Size | about 2500 lines |
| Permissions | `["sys.processes", "spawn"]`: the process table, opening Disk Usage |

## What it is

Shows what the machine is doing: processes and their CPU and memory, live
graphs of CPU (total and per core), memory and swap, disk I/O, network,
GPU where readable, and the file systems with their free space.

## Platform

On **Linux** everything comes from the kernel's files: `/proc` and `/sys`,
read with `require('fs')`. Reading these files is the kernel's interface,
not a workaround. Do **not** run `ps`, `top`, `free`, `df` or any other
command.

On **Windows** bro has no process or performance API yet. Boot, show the
file systems (`bro.vfs.listVolumes()`) and whatever `os` provides, show
an empty state on the other pages ("Process and performance data on this
platform needs bro support"), and file the gaps.

## Read first

- `../AGENTS.md`, `../lib/README.md`, `../diskusage/`
- `../bro/docs/brokit-api.js`: `fs`, `os` (note what `os` lacks: no `cpus()`, `totalmem()` or `loadavg()` today; file that as a brokit gap)
- `../bro/docs/vfs-api.js`: `listVolumes`
- `../bro/docs/gpu-api.js`: `bro.gpu` devices (names only)
- `man 5 proc` knowledge: `/proc/stat`, `/proc/meminfo`, `/proc/[pid]/stat`, `/proc/[pid]/status`, `/proc/[pid]/cmdline`, `/proc/diskstats`, `/proc/net/dev`, `/proc/loadavg`, `/proc/uptime`, `/sys/class/drm/card*/device/gpu_busy_percent` and `mem_info_vram_*` (amdgpu), `/sys/class/hwmon/*` (temperatures)

## Window

A sidebar with three pages, **Processes**, **Performance** and **File
Systems**, plus a toolbar search field on Processes.

## Must have

1. **Sampler** (`js/sampler.js`, no DOM). Every second (setting: 0.5, 1, 2
   or 5 s) it reads the files above and keeps a ring of 120 samples per
   series. CPU % from `/proc/stat` deltas, per process from `utime+stime`
   deltas against total jiffies. Memory used = MemTotal − MemAvailable.
   Disk and network as bytes/s from deltas. It must cost well under 5% of
   one core with 500 processes: read each `/proc/[pid]/stat` once per tick,
   `cmdline` and `status` only for new pids, and use async `fs.promises`.
2. **Processes.** A `VirtualList` with Name, PID, User, CPU %, Memory,
   Threads and State columns, sortable, with CPU descending by default.
   Rows update in place every tick without losing selection or scroll. A
   filter field matches name, command line and PID. A tree mode (by parent
   PID) is a toggle.
3. **Process actions** in the context menu and toolbar: Properties (command
   line, cwd, start time, memory breakdown from `status`), Copy Command
   Line, and End / Kill. **There is no `process.kill` in brokit**: show the
   actions disabled with "needs bro support" and file the gap. Do not shell
   out to `kill`.
4. **Performance.** Graphs drawn on a `<canvas>` (2D) with the token colours
   read via `getComputedStyle(document.documentElement)`: CPU total plus a
   small multiple per core, memory and swap, disk read/write, network
   rx/tx, and GPU busy and VRAM when the amdgpu sysfs files exist. The
   current value is beside each graph in `.num`. Graphs are 60 fps-free:
   redraw once per tick.
5. **File Systems.** Each mounted volume with mount point, type, used/total
   as a `Progress` bar, and free space. "Open in Disk Usage" uses
   `openApp('helm.diskusage', [mount])`.
6. The header of the Performance page shows uptime, load average, and the
   CPU model (from `/proc/cpuinfo`).
7. Pause sampling while the window is hidden or minimised (a
   `visibilitychange` event, if bro sends it; else file the gap) to save
   power.

## Settings

`interval`, `page`, `sort` (json), `treeMode`, `perCore`.

## Acceptance tests

Make the sampler take a root directory (default `/`), so tests feed it a
fake `/proc` built with `fixtureDir()`: `stat`, `meminfo`, `loadavg`,
`uptime`, and two `[pid]/stat` files. Then:

1. CPU %: two `/proc/stat` snapshots with known deltas give the expected
   total and per-core percentages.
2. Process CPU % from two snapshots of a fake pid matches the formula.
3. Memory used and percentage from a fake `meminfo`.
4. A pid that disappears between ticks leaves the list, and a new pid
   appears, with selection on the other rows kept.
5. The Processes list sorts by Memory when its header is clicked, and the
   sort persists.
6. The filter narrows to matching names and PIDs.
7. On a platform without `/proc` (Windows), the app boots, File Systems
   lists volumes, and Processes shows its empty state.
8. On Linux only (`skipTest` elsewhere), the real sampler sees its own
   process in the list (`process.pid` if brokit has it; else find
   `/proc/self` → its pid).

## Not in this pass

Per-process network and disk I/O, cgroups and containers, services
(systemd), editing priorities, history beyond 2 minutes.
