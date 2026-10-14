# Disks (`helm.disks`)

Inspect physical drives, partition layouts, filesystem usage, and live disk I/O activity across Linux block devices (`/sys/block`, `/proc/mounts`, `/proc/partitions`, `/proc/diskstats`) and `bro.vfs.volumes()`.

## Features

- **Physical Drive Inventory**: Lists physical drives and logical volumes in the sidebar with capacity meters and media classification (`NVMe`, `SSD`, `HDD`, `Removable`, `Network`, `Local Drive`).
- **Visual Partition Layout Map**: Proportional horizontal bar displaying allocated partitions and unallocated space on the selected drive. Clicking any segment or using the arrow keys inspects that partition.
- **Partition & Volume Inspector**: Displays mount point, block device path, filesystem type, mount flags (`rw`/`ro`), capacity breakdown (Total, Used, Free, Available), and live read/write throughput and cumulative byte counters.
- **Desktop Integration**: One-click handoff to **Files** (`helm.files`) to browse a mounted volume or **Disk Usage** (`helm.diskusage`) to analyze what takes up space on it.

## Running & Testing

```bash
# Run all headless tests (from helmapps/)
bash scripts/run_tests.sh disks

# Run with performance numbers printed
VERBOSE=1 bash scripts/run_tests.sh disks perf
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+O` | Open selected volume in Files (`helm.files`) |
| `Mod+U` | Analyze selected volume in Disk Usage (`helm.diskusage`) |
| `Mod+Shift+C` | Copy selected volume's mount path (or device path) |
| `Mod+F` | Focus drive & volume filter |
| `Escape` | Clear active filter |
| `ArrowLeft` / `ArrowRight` | Select previous / next partition on current drive |
| `F5` / `Mod+R` | Refresh drives, volumes, and I/O counters |
| `Mod+N` | New Window |
| `Mod+Q` | Quit |
