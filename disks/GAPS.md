# Gaps Found While Building Disks (`helm.disks`)

## 1. Privileged disk management operations (mount / unmount / eject / SMART)
- **Where:** `bro.vfs` / `bro.sys`
- **Expected:** Unprivileged or polkit-brokered methods on `bro.vfs` or `bro.sys` to mount, unmount, and power-off/eject removable block devices (UDisks2 `org.freedesktop.UDisks2` on Linux) and query SMART health attributes (`temperature`, `powerOnHours`, `wearLevel`).
- **Actual:** `bro.vfs.volumes()` enumerates mounted volumes with space usage and flags (`isReadOnly`, `isRemovable`, `isNetwork`), and `/sys/block` + `/proc` provide physical block topology and live I/O counters on Linux, but there is no API to mount/unmount or read SMART telemetry without root or shelling out.
- **Impact:** Disks is an inspection and navigation utility (physical drives, partition layout map, live I/O rates, and handoff to `helm.files` and `helm.diskusage`) without destructive format/partition or mount/unmount actions.
- **Belongs in:** `bro` (`bro.vfs` / `bro.sys`)
