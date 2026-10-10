# Gaps found building the kit

Engine and platform gaps found while building `lib/` and the reference app.
Each app keeps its own `GAPS.md` in the same format (see AGENTS.md).

## Opening another bro app by id is Linux-only
- **Where:** bro (`bro.app`, `bro.apps`)
- **Expected:** `openApp('helm.files', [path])` starts the installed (or
  in-project) folder app `helm.files` on every platform.
- **Actual:** the kit uses `bro.apps.launch('<id>.desktop')`, which needs
  the desktop entry `bro --install` writes on Linux. Windows and macOS have
  no entries, and an app run from a checkout without installing has none.
- **Impact:** "Show in Files", "Open in Disk Usage" and the like fail off
  Linux; apps show a toast.
- **Belongs in:** bro: `bro.app.open(id, args)` (resolve like `bro <id>`,
  then fall back to the app's project siblings).

## No app-side desktop notifications
- **Where:** bro
- **Expected:** a way for an app to post a notification that helm shows
  (the web `Notification` API, or `bro.notify(...)`), with actions.
- **Actual:** `bro.sys.notifications` is the *server* side (helm listens).
  An app has nothing to call.
- **Impact:** Clocks, Music, Files (long operations) fall back to in-app
  toasts and window attention.
- **Belongs in:** bro

## No MPRIS player side
- **Where:** bro (`bro.mpris` is a controller only)
- **Expected:** an app can publish itself as an MPRIS2 player so helm's
  now-playing card and media keys reach it.
- **Belongs in:** bro / brompris

## brokit `os` lacks the system-information functions
- **Where:** brokit `os`
- **Expected (Node):** `os.cpus()`, `os.totalmem()`, `os.freemem()`,
  `os.loadavg()`, `os.uptime()`, `os.networkInterfaces()`.
- **Actual:** only `platform`, `arch`, `homedir`, `userInfo`, `tmpdir`,
  `hostname`, `EOL`.
- **Impact:** System Monitor reads `/proc` on Linux and has nothing on
  Windows.
- **Belongs in:** brokit

## No `process.kill`
- **Where:** brokit `process`
- **Expected:** `process.kill(pid, signal)` (Node).
- **Impact:** System Monitor cannot end a process.
- **Belongs in:** brokit

## No media tag reader
- **Where:** bro (`bro.media`)
- **Expected:** title/artist/album/track/cover from audio and video files.
- **Impact:** Music parses ID3 and Vorbis comments in JS.
- **Belongs in:** bro

## The clipboard has no doc page
- **Where:** docs
- **Expected:** a page for `navigator.clipboard` (text, and whether images
  and file lists are supported) like the other `*-api.js` files.
- **Belongs in:** docs

## Creating the app catalog blocks for ~400 ms
- **Where:** bro (`bro.apps`, broapps)
- **Expected:** the first `bro.apps` call (to open a file with its default
  app, or list what can open it) answers without stalling a frame.
- **Actual:** the catalog is built synchronously on first use, reading every
  desktop entry / registered application: ~400 ms on Windows.
- **Impact:** the first "Open with" in any app hitches once. Apps must not
  touch `bro.apps` at startup.
- **Belongs in:** bro / broapps (build it on a worker, return a promise).

## Startup is mostly the engine's
- **Where:** bro
- **Actual:** in headless, ~300 ms from process start to first frame for
  Disk Usage, of which the app's own work is ~15 ms. Creating the window and
  Vulkan device (~150 ms) and compiling the page (~90 ms) run one after the
  other.
- **Impact:** none for an app to fix; recorded so startup budgets in
  `docs/performance.md` are read as "the app's share".
- **Belongs in:** bro (overlap device creation with the compile).

## Fixed while building the kit
- Startup: system panels (inspector, preferences) are built the first time
  they are shown instead of at startup (~250 ms), and controllers are found
  the first time a page asks (~180 ms of HID enumeration on Windows).
- `BRO_APP_HOME` now isolates `bro.conf` too, so a test never reads the
  developer's own saved settings.
- `bro.app.startup` (`loadedMs`, `firstFrameMs`), and the agent-control
  trace, profiler and top-level `await` all work in headless, so startup and
  frame times are measured without a window (`docs/performance.md`).
- `bro.vfs.volumes()` and `bro.vfs.usage()` (brovfs): drives, and a native
  threaded disk-usage scan.
- `path.relative` was missing from brokit's `path` (added, with tests).
- A `bro --install` copy of an app inside a project lost the project's
  `/lib`; the copy now bundles it, a `--link` install finds its project
  through the symlink, and a walked-up project's `lib`/`system` names are
  honoured (bro `app_install.cpp`, `config_loader.cpp`).
- `BRO_PROJECT_ROOT` inherited from a parent bro (a terminal's shell, for
  one) no longer hands that project's `/lib` to an unrelated app; the
  nearest enclosing project wins.
- A right click was a `click` and counted toward double-clicks, so a left
  click and then a right click on one list row was a `dblclick` (Disk Usage
  opened the folder it was asked for a menu on). The right and middle buttons
  now make `auxclick`, as browsers do, and a right press no longer toggles a
  checkbox. `contextmenu` now goes to what is under the pointer, so a list
  that repaints its row on mouseup still receives it (bro
  `replaced_elements_input.cpp`, `tests/events/test_right_click.js`).
