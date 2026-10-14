# Logs (`helm.logs`)

System and application log viewer for the Helm desktop environment. Inspects, filters, tails, and exports logs from Helm apps, the Bro runtime, system log files (`/var/log`), and custom `.log`, `.jsonl`, or `.txt` files.

## Features

- **Automatic Source Discovery**: Discovers readable log files across `Desktop & Apps` (`$XDG_STATE_HOME`, `~/.local/state`, `%LOCALAPPDATA%`, `bro.app.logFile`), `System` (`/var/log/syslog`, `messages`, `dmesg`, `kern.log`, `Xorg.0.log`, `pacman.log`, `auth.log`, `boot.log`), and user-opened files, plus an **All Sources** combined view.
- **Multi-Format Log Parser**: Parses JSONL (`{...}`), Bro/Helm bracketed and ISO logs, RFC 5424 & RFC 3164 Syslog, kernel `dmesg`, `pacman.log`, and plain text logs, automatically grouping multi-line stack traces and indented continuation lines onto their parent entry.
- **Fast Filtering & Search**: Instant severity filtering (`All`, `Errors`, `Warnings`, `Info`, `Debug`), case-insensitive substring search, and linear-time regular expression search powered by `bro.search.Regex`.
- **Detail Drawer**: Inspect full log messages, pretty-printed structured JSON fields, attached stack traces, and raw log text.
- **Live Follow (Tail)**: Watches active log sources via `bro.vfs.watch` and streams newly appended lines to the bottom of the virtualized list.
- **Tail-Capped Async I/O**: Reads at most the trailing 2 MB of any single log file asynchronously via `fs.promises` so multi-gigabyte logs never block the UI thread.

## Running & Testing

```bash
# Run all headless tests for helm.logs (from helmapps/)
bash scripts/run_tests.sh logs

# Run with verbose output (including performance timings)
VERBOSE=1 bash scripts/run_tests.sh logs
```

## Keyboard Shortcuts

| Shortcut | Command | Description |
|---|---|---|
| `Ctrl+O` | `open-file` | Open a `.log`, `.jsonl`, or `.txt` file |
| `Ctrl+F` | `focus-search` | Focus the search box |
| `Ctrl+Alt+R` | `toggle-regex` | Toggle regular expression search (`.*`) |
| `Escape` | `clear-filter` | Clear active search query, reset filter, or close detail drawer |
| `Ctrl+T` | `toggle-tail` | Toggle Live Follow (Tail) mode |
| `Ctrl+C` / `Ctrl+Shift+C` | `copy-entry` | Copy selected log entry raw text to clipboard |
| `Ctrl+S` | `export-filtered` | Export currently filtered log entries to a file |
| `Ctrl+K` | `clear-view` | Clear currently displayed entries in view |
| `F5` / `Ctrl+R` | `refresh` | Reload active log source from disk |
| `Ctrl+N` | `new-window` | Open a new Logs window |
| `Ctrl+Q` | `quit` | Quit Logs |
