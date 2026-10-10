# Gaps found building the kit

Engine and platform gaps found while building `lib/` and the reference app.
Each app keeps its own `GAPS.md` in the same format (see AGENTS.md).

## Notifications have no click or actions
- **Where:** bro (`Notification`, `bro.window.notify`)
- **Expected:** `click` on a notification (and its actions) reaches the app,
  so "Download finished" can open the file.
- **Actual:** the web `Notification` API posts under the app's identity on
  every platform (toast, notification center, D-Bus), but the platforms'
  activation callbacks are not wired up: `click` never fires and `actions`
  is empty.
- **Impact:** a notification informs; acting on it means switching to the app.
- **Belongs in:** bro

## No MPRIS player side
- **Where:** bro (`bro.mpris` is a controller only)
- **Expected:** an app can publish itself as an MPRIS2 player so helm's
  now-playing card and media keys reach it.
- **Belongs in:** bro / brompris

## The clipboard has no doc page
- **Where:** docs
- **Expected:** a page for `navigator.clipboard` (text, and whether images
  and file lists are supported) like the other `*-api.js` files.
- **Belongs in:** docs

## Startup is mostly the engine's
- **Where:** bro
- **Actual:** headless now brings the Vulkan device up on a thread while it
  creates the window (`bro.app.startup.graphics`): an empty page's first
  frame went from ~240 ms to ~220 ms on Windows. The device is the long pole
  (~160 ms, most of it loading the Vulkan loader and the GPU driver), and the
  page is compiled and run (~50 ms) only after it. The windowed `bro` still
  creates the device after the window (it picks the device against the
  window's surface).
- **Impact:** none for an app to fix; recorded so startup budgets in
  `docs/performance.md` are read as "the app's share".
- **Belongs in:** bro: compile and run the page while the device comes up
  (the GPU is first needed at the first frame or a canvas/WebGL context, so
  every use of the context would wait on it); in the windowed path, load the
  driver and create the instance alongside the window.

## Fixed while building the kit
- `openApp(id, args)` is `bro.app.open`: another app by id on every platform
  (installed, else in this project), single-instance hand-off included.
- Apps post desktop notifications with the web `Notification` API (toast,
  notification center, D-Bus); helmterm's notify-send/osascript fallback is
  gone.
- brokit `os` has Node's system information (`cpus`, `totalmem`, `freemem`,
  `uptime`, `loadavg`, `networkInterfaces`, `release`, `version`,
  `machine`), and `process.kill(pid, signal)` exists.
- `path.join` and friends are native (~0.5 µs a join, was ~7-15 µs).
- `bro.apps` builds its catalog on a worker (`bro.apps.ready()`,
  `appsReady()` in `lib/files.js`); `openFile` and Images' Open With await it.
- Music decides which formats it plays from `bro.media.canDecode`, not the
  platform name.
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
