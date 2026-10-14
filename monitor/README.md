# System Monitor (`helm.monitor`)

Monitor running processes, live system performance graphs, and mounted file systems.

## Features

- **Processes**: Virtualized, sortable list of running processes (`Name`, `PID`, `User`, `CPU %`, `Memory`, `Threads`, `State`) from `/proc` on Linux or `bro.sys.processes` (`listProcesses` / `killProcess`) cross-platform, with live in-place updates that preserve selection and scroll position, live search filtering, parent-PID **Tree Mode**, **End Process** (`SIGTERM`), **Kill Process** (`SIGKILL` with confirmation), and a **Process Properties** dialog.
- **Performance**: 120-sample Canvas 2D history graphs using helm kit tokens for total CPU %, optional per-core small multiples, Memory and Swap, Disk Read/Write throughput, Network Receive/Send throughput, and GPU Busy % / VRAM usage (when amdgpu sysfs or `bro.gpu` memory info is available).
- **File Systems**: Mounted volumes from `bro.vfs.volumes()` showing filesystem type, capacity progress bar, used/free bytes, and one-click **Open in Disk Usage** (`helm.diskusage`).

## Running

```bash
# Headless smoke check (from helmapps/)
../bro/build/Release/bro-headless.exe monitor -e "0"

# Run all headless acceptance and performance tests
bash scripts/run_tests.sh monitor
VERBOSE=1 bash scripts/run_tests.sh monitor perf
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+1` | Switch to **Processes** page |
| `Mod+2` | Switch to **Performance** page |
| `Mod+3` | Switch to **File Systems** page |
| `Mod+F` | Focus process filter field |
| `Escape` | Clear process filter |
| `Mod+T` | Toggle process **Tree Mode** (parent PID hierarchy) |
| `Alt+Enter` | Open **Properties** dialog for selected process |
| `Mod+Shift+C` | Copy selected process command line |
| `Delete` | **End Process** (`SIGTERM` / graceful termination) |
| `Shift+Delete` | **Kill Process** (`SIGKILL` / forceful termination, with confirmation) |
| `F5` / `Mod+R` | Refresh processes, performance, and volumes immediately |
| `Mod+N` | New window |
| `Mod+Q` | Quit |
