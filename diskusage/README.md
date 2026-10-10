# Disk Usage

See what takes up space. Pick a folder (or a place or drive in the
sidebar); every folder inside it is totalled, biggest first, and you can
walk into the big ones, open what you find, or move it to the Trash.

It is also the helm app kit's **reference app**: it uses every part of
`/lib` the way a new app should, and is short enough to read in full before
starting one. It is also the model for staying responsive under a big job:
a whole drive of a million files is scanned with the window live, the list
filling in as folders are counted (see [`../docs/performance.md`](../docs/performance.md)):

- The window is built before anything touches the disk; the places and
  drives fill in from async calls (`fs.promises.stat`, `bro.vfs.volumes()`).
- The scan is native (`bro.vfs.usage`): it runs on its own threads, and the
  page reads only the folder on screen, sorted and capped natively.
- A `requestAnimationFrame` loop shows progress every frame and redraws the
  list only when the scan moved on and 250 ms have passed.
- You can walk into folders, sort, stop or start another scan at any time.

```bash
scripts/run_tests.sh diskusage                               # from helmapps/
DU_PERF_ROOT='C:\' VERBOSE=1 scripts/run_tests.sh diskusage perf   # time a real drive too
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
| `js/main.js` | The window, commands, the scan loop, navigation and actions |
| `css/app.css` | The size bar, the summary line and a still-counting size; all else is the kit |
| `tests/test_ui.js` | End to end: open, sort, walk in and back, menus, trash prompt |
| `tests/test_perf.js` | Startup time, and the worst frame while a large tree is scanned and walked |
