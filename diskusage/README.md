# Disk Usage

See what takes up space. Pick a folder (or a place or drive in the
sidebar); every folder inside it is totalled, biggest first, and you can
walk into the big ones, open what you find, or move it to the Trash.

It is also the helm app kit's **reference app**: it uses every part of
`/lib` the way a new app should, and is short enough to read in full before
starting one.

```bash
bro diskusage                 # from helmapps/
bro diskusage ~/Downloads     # straight to a folder
scripts/run_tests.sh diskusage
```

| Keys | |
|---|---|
| Enter, double-click | Open the folder, or the file with its default app |
| Alt+Left, Backspace | Back |
| Alt+Up | Enclosing folder |
| F5, Mod+R | Scan again |
| Mod+O | Choose a folder |
| Mod+H | Count hidden files |
| Mod+Shift+C | Copy the selected paths |
| Delete | Move to Trash (asks first; Undo in the toast) |
| Mod+N / Mod+Q | New window / Quit |

## Files

| File | |
|---|---|
| `js/main.js` | The window, commands, navigation and actions |
| `js/scan.js` | The folder walker and tree helpers (no DOM; unit-tested) |
| `css/app.css` | The size bar and the summary line, all else is the kit |
| `tests/test_scan.js` | The scanner: totals, hidden files, symlinks, detach |
| `tests/test_ui.js` | End to end: open, sort, walk in and back, menus, trash prompt |
