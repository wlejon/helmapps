# Text Editor (`helm.texteditor`)

Plain-text editor for notes, configuration files, and quick code edits in **helm**.

## Features

- **Document Tabs**: Open multiple files, create untitled buffers, see dirty indicators (`•`), and switch tabs with `Ctrl+Tab` / `Ctrl+Shift+Tab`.
- **Encoding & Line Endings**: Detects and preserves `UTF-8` and `UTF-8 with BOM`, as well as `LF` and `CRLF` line endings (clickable in the status bar to convert). Binary or non-UTF-8 files open read-only with an informational banner.
- **Safe Atomic Saves**: Writes to a temporary file in the same directory and renames over the target so crashes never leave truncated files.
- **Crash Recovery & Session Restore**: Autosaves modified buffers after 5 seconds of idle time to `bro.app.dataDir/recovery/` and offers to restore them on the next launch. Remembers open tabs and caret positions across launches.
- **External Change Detection**: Watches open files with `fs.watch`; clean buffers reload automatically, while modified buffers show a banner offering **Reload** or **Keep mine**.
- **Find & Replace and Go to Line**: Incremental search (`Mod+F`) and replace (`Mod+H`) with Match Case, Whole Word, and Regular Expression capture-group support, plus Go to Line (`Mod+G`).

## Running

```bash
# Run headless acceptance and performance tests (from helmapps/)
bash scripts/run_tests.sh texteditor
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+N` / `Mod+T` | New Tab |
| `Mod+O` | Open File(s)… |
| `Mod+S` | Save |
| `Mod+Shift+S` | Save As… |
| `Mod+Alt+S` | Save All |
| `Mod+W` | Close Tab |
| `Ctrl+Tab` / `Ctrl+PageDown` | Next Tab |
| `Ctrl+Shift+Tab` / `Ctrl+PageUp` | Previous Tab |
| `Mod+F` | Find… |
| `Mod+H` | Find and Replace… |
| `F3` / `Shift+F3` | Find Next / Find Previous |
| `Mod+G` | Go to Line… |
| `Alt+Z` | Toggle Word Wrap |
| `Mod+=` / `Mod+-` / `Mod+0` | Zoom In / Zoom Out / Reset Zoom |
| `Mod+Q` | Quit |
