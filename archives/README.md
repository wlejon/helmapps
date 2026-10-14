# Archive Manager (`helm.archives`)

Create, inspect, browse, modify, and extract `.zip`, `.tar`, and `.tar.gz` (`.tgz`, `.gz`) archives in-process using web-standard `CompressionStream` / `DecompressionStream` and POSIX `ustar` TAR formatting.

## Running

```bash
# Headless boot check
../bro/build/Release/bro-headless.exe archives -e "0"

# Run all headless acceptance and performance tests
bash scripts/run_tests.sh archives
```

## CLI Arguments

- `archives <path>`: Open an archive in Archive Manager.
- `archives --extract-here <path>`: Extract `<path>` into a sibling subfolder named after the archive stem and open it.
- `archives --create <output> <inputs...>`: Create `<output>` from `<inputs...>` and open it in Archive Manager.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open Archive… |
| `Ctrl+N` | New Archive… |
| `Ctrl+E` | Extract All… |
| `Ctrl+Shift+E` | Extract Selected… |
| `Ctrl+I` | Add Files to Archive… |
| `Delete` | Delete Selected from Archive… |
| `Alt+Left` / `Backspace` | Back |
| `Alt+Up` | Enclosing Folder |
| `Ctrl+F` | Filter Archive Entries |
| `Ctrl+P` | Toggle Inspector / Preview Pane |
| `Ctrl+A` | Select All |
| `F5` / `Ctrl+R` | Reload Archive |
| `Ctrl+Q` / `Ctrl+W` | Quit |
