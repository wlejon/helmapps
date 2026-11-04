# Engine & Kit Gaps (`helm.monitor`)

## Disk I/O and Network throughput counters on Windows
- **Where:** `brokit` `os` module (`require('os')`) / `bro.sys`
- **Expected:** Cross-platform disk read/write byte counters and network interface rx/tx byte counters (similar to `/proc/diskstats` and `/proc/net/dev` on Linux).
- **Actual:** `os.networkInterfaces()` returns interface addresses (`IPv4`/`IPv6`/`mac`), not byte counters, and `os` has no disk I/O counters on Windows.
- **Repro:** `bro-headless monitor -e "console.log(Object.keys(require('os').networkInterfaces()))"`
- **Impact:** Disk I/O and Network throughput graphs populate from `/proc/diskstats` and `/proc/net/dev` on Linux (and in fixture tests), and remain at `0 B/s` on Windows.
- **Belongs in:** `brokit`
