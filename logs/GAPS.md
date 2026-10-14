# Engine & Kit Gaps (`helm.logs`)

## Binary systemd journald reader API is not in `bro`
- **Where:** `bro` native namespaces (`bro.sys` / `bro.vfs`)
- **Expected:** A native reader API for binary systemd journal files (`/var/log/journal/*/*.journal` via `libsystemd` `sd_journal_*`) to query and stream structured systemd journal records without spawning external processes.
- **Actual:** `bro` does not expose a native journald reader API, and per project rules apps never shell out to `journalctl`, `dmesg`, or `wevtutil` via `child_process`.
- **Impact:** `helm.logs` discovers and reads plain-text and JSONL (`*.log`, `*.jsonl`) logs directly via `fs.promises` from `/var/log/` (`syslog`, `messages`, `dmesg`, `kern.log`, `Xorg.0.log`, `pacman.log`, `auth.log`, `boot.log`), desktop/app state directories (`$XDG_STATE_HOME`, `~/.local/state`, `%LOCALAPPDATA%`), `bro.app.logFile`, and user-opened log files.
- **Belongs in:** `bro`

## `fs.promises.open` (`FileHandle`) is not in `brokit`
- **Where:** brokit `fs` module (`require('fs').promises`)
- **Expected:** `await fs.promises.open(path, 'r')` returning a `FileHandle` with `.read(buffer, offset, length, position)` and `.close()` for positioned async reads.
- **Actual:** `fs.promises` provides `readFile`, `writeFile`, `appendFile`, `stat`, `lstat`, `readdir`, `mkdir`, `rmdir`, `rm`, `unlink`, `rename`, `copyFile`, `chmod`, `realpath`, `access`, `mkdtemp`, while positioned descriptor reads use `fs.openSync` / `fs.readSync` / `fs.closeSync`.
- **Impact:** Used `fs.promises.readFile` for full async reads and `fs.openSync` + `fs.readSync` + `fs.closeSync` for bounded tail/delta slices.
- **Belongs in:** `brokit`
