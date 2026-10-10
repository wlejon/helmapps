# Building a helm app

Read this whole file before you write anything. Then read your brief in
[`briefs/`](briefs/), the kit's reference [`lib/README.md`](lib/README.md),
and the reference app [`diskusage/`](diskusage/), all of it, since it is
short.

## What you are building, and what you are not

**helm** is a desktop environment. Its apps are written in HTML, CSS and
JavaScript, but **they are not websites and do not run in a browser.**

Each app runs on **bro**, a native runtime (`../bro`). bro has its own
layout engine, draws with the GPU (Skia on Vulkan), and compiles JavaScript
with its own compiler (bronze). A helm app is:

- **A native desktop program.** It runs as its own process, has its own
  window, and is listed in launchers. On Linux under helm it is an ordinary
  Wayland window. helm draws the title bar and frame, so your app never draws
  one.
- **Given real system access.** It reads and writes real files with
  `require('fs')`, spawns processes with `require('child_process')`, and
  uses `bro.*` namespaces for system services: files and trash, the app
  catalog, thumbnails, audio, images, settings, and more.
- **Offline and self-contained.** It loads nothing from the network: no
  CDN, no npm, no bundler, no React, Vue or jQuery, no web fonts. Plain ES
  modules, plain DOM, and the helm kit in `lib/`.
- **Not a browser.** Do not assume Chromium. bro implements a large part of
  the web platform (flex, grid, custom properties, oklch, transitions,
  animations, `backdrop-filter`, Shadow DOM, Workers, `fetch` for files)
  but not all of it. When something is missing or behaves differently, you
  report it (see "Engine gaps" below). You never hack around it.

A whole desktop is being built at once, one app per agent, in parallel. Your
app must look and behave like it belongs with the others. That is why the
kit exists and why the rules below are strict.

## The repository

```
helmapps/
  AGENTS.md          this file
  bro.json           marks helmapps as a project: /lib is mounted for every app
  lib/               the helm app kit, shared by every app. Read-only for you.
  briefs/            one brief per app: what to build, how it is tested
  diskusage/         the reference app: copy its shape
  helmterm/          the terminal (older, predates the kit; do not copy its CSS)
  helmremote/        the remote viewer (same)
  <your app>/        yours
  scripts/run_tests.sh
```

Docs you will need, all in `../bro/docs/`:

| Doc | What |
|---|---|
| `apps.md` | Folder apps: `bro.json` keys, the per-app directories, permissions, install |
| `app-api.js` | `bro.app`: id, argv, cwd, directories, single instance, spawn |
| `brokit-api.js` | Node modules (`fs`, `path`, `os`, `child_process`) and web globals |
| `headless.md` | The test runner: headless globals, input simulation, screenshots |
| `<namespace>-api.js` | Every `bro.*` namespace. Your brief lists the ones you need. |
| `file-api.js`, `dialogs-api.js`, `menu-api.js`, `window-api.js` | Files, native pickers, the window |

The `*-api.js` docs are annotated examples. **Read the doc before you call
an API, and never guess an API's shape.** Where the doc and the running bro
disagree, the running bro is the truth: write down the difference in your
GAPS.md and code to what actually runs.

## The rules

1. **Stay in your folder.** Create and edit files only inside `helmapps/<your
   app>/`. Do not edit `lib/`, another app, `../bro`, or any sibling repo.
   If the kit lacks something, build it inside your app and add a GAPS.md
   entry saying it belongs in the kit.
2. **Use the kit for everything it covers.** The window layout, toolbar,
   sidebar, lists and grids (`VirtualList`), menus, dialogs, toasts,
   controls, settings, commands and shortcuts, formatting, file helpers and
   icons. Do not write your own list virtualizer, menu, modal or settings
   store.
3. **Use the kit's design tokens for every colour, size and duration**
   (`lib/css/tokens.css`): `var(--t2)`, `var(--surface-1)`, `var(--s3)`,
   `var(--r-ctl)`. Never write a hex colour or `rgb()` in an app's CSS. Your
   CSS should be short; the kit draws the controls.
4. **Every action is a command** (`app.commands.add`). Toolbar buttons,
   menus and keyboard shortcuts run commands by id, never by duplicating the
   code.
5. **No browser dialogs.** Never use `alert()`, `confirm()` or `prompt()`;
   use `lib/dialog.js`. Never use `localStorage` for settings; use
   `app.settings` (bro.conf). Native file pickers (`showOpenFileDialog`,
   `showSaveFileDialog`, `showOpenFolderDialog`) are fine.
6. **Optional and privileged APIs may be missing.** `bro.vfs`, `bro.apps`,
   `bro.thumb`, `bro.sys` and others can be compiled out, refused by
   permissions, or have no backend on the platform. Get them through
   `api('vfs')` from `lib/dom.js`, which returns null when unavailable. Then
   hide or disable that feature, or show an empty state saying why. Never
   crash, and never fake data.
7. **Engine gaps are reported, not worked around.** See below. In
   particular: no shelling out to system tools (`xdg-open`, `ls`, `du`,
   `ffmpeg`, `powershell`) to replace a missing bro API. No hand-written
   polyfills of missing web APIs. No drawing text into a canvas because a
   CSS feature is broken.
8. **Linux first, Windows must still run.** helm's home is Linux. Your app
   must also boot on Windows, with Linux-only features hidden. Use `path`,
   `os.homedir()` and `lib/files.js` for paths, and never hard-code `/home/…`
   or `C:\…`.
9. **Keep files small.** Aim for under 600 lines per file and split by
   responsibility (`main.js` wires things up; models, views and I/O live in
   their own modules). Nothing over 1000 lines.
10. **Tests are part of the app.** Your brief lists acceptance scenarios.
    Each becomes a headless test in `<app>/tests/`, and all of them pass
    before you are done. Tests never touch the user's real files: make
    everything with `fixtureDir()` from `lib/test.js`.

## Anatomy of an app

```
myapp/
  bro.json           id, name, icon, categories, window size, permissions
  index.html         links /lib/kit.css and css/app.css, loads js/main.js
  assets/icon.svg    a 64x64 rounded-square icon in the helm style
  css/app.css        only what the kit does not draw
  js/main.js         startApp(), the window, commands, wiring
  js/*.js            the app's own modules
  tests/test_*.js    headless acceptance tests
  GAPS.md            engine and kit gaps you hit (may stay empty)
```

`bro.json`. The `id` is `helm.<name>` (lower-case, no dashes). `"app": "."`
is required. Window size and limits follow `diskusage/bro.json`.

```json
{
    "id": "helm.imageviewer",
    "name": "Image Viewer",
    "version": "0.1.0",
    "description": "One line, shown by launchers",
    "icon": "assets/icon.svg",
    "categories": ["Graphics", "Viewer"],
    "keywords": ["image", "photo", "picture"],
    "singleInstance": true,
    "fileTypes": [{ "name": "Images", "mimeTypes": ["image/png", "image/jpeg"], "extensions": ["png", "jpg", "jpeg"] }],
    "permissions": [],
    "app": ".",
    "width": 1000, "height": 700, "minWidth": 480, "minHeight": 320,
    "resizable": true, "splash": false, "watch": false
}
```

`index.html` is always this shape. The page builds its DOM from `main.js`.

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Image Viewer</title>
    <link rel="stylesheet" href="/lib/kit.css">
    <link rel="stylesheet" href="css/app.css">
</head>
<body>
    <script type="module" src="js/main.js"></script>
</body>
</html>
```

`js/main.js` starts with `startApp()` and is organised the way
`diskusage/js/main.js` is: state, the window (`appFrame`), commands, the
toolbar, rendering, actions, then `app.onLaunch` and `app.expose(...)`.

- `/lib/...` is the kit (mounted by bro from `helmapps/lib`).
- `/app/...` is your own folder, if you need an absolute path to it.
  Relative paths (`./model.js`) work too.
- `require('fs')`, `require('path')`, `require('os')` and
  `require('child_process')` work in any module.
- `app.expose({ ... })` puts your state and key functions on `window.app`,
  which is what tests drive.

## Running and testing

bro binaries: Windows `../bro/build/Release/bro.exe` and `bro-headless.exe`;
Linux `../bro/build-release/bro` and `bro-headless` (or `bro` on the PATH).

```bash
bro myapp                              # windowed, from helmapps/
bro myapp some/file.png                # with arguments: app.argv
scripts/run_tests.sh myapp             # every test of one app, headless
scripts/run_tests.sh myapp ui          # tests whose name contains "ui"
```

Headless tests run the real app with no window. A test is an ES module that
imports helpers from `/lib/test.js`, drives the app with simulated input,
and asserts on the DOM and on `window.app`. See `diskusage/tests/` and
`../bro/docs/headless.md`. Assert on state and structure ("three rows",
"the dialog asked", "the file was renamed"), never on pixels. A
`screenshot('tests/out/x.png')` is fine for looking at your work yourself.
Exit code 77 (`skipTest(reason)`) means "cannot test here" (for example a
Linux-only feature on Windows), and is never a pass.

## Engine gaps

You will find things bro does not do yet: a missing web API, a CSS property
that does not lay out right, a `bro.*` call whose behaviour differs from its
doc, a kit component that does not exist. This is expected. Finding them is
one of the main products of this work.

For each one, add an entry to your app's `GAPS.md`:

(The example below is a real gap the reference app hit; it has been fixed
since.)

```markdown
## path.relative is missing
- **Where:** brokit `path` module (`require('path')`)
- **Expected:** `path.relative('/a/b', '/a/b/c')` → `'c'` (Node)
- **Actual:** `TypeError: undefined is not a function`
- **Repro:** `bro-headless myapp -e "require('path').relative('/a','/a/b')"`
- **Impact:** breadcrumbs cannot compute a relative path; worked by keeping full paths instead
- **Belongs in:** brokit
```

Then carry on. If the feature can be built without the missing piece in an
honest way (a simpler design, not a workaround that reimplements the
engine), do that and say so under Impact. If it cannot, leave the feature
out or disabled, and say so. "Belongs in" is one of: `bro` (engine),
`brokit`, `<sibling library>`, `kit` (`helmapps/lib`), or `docs` (the doc is
wrong).

## Done means

- [ ] Every acceptance scenario in your brief is a passing headless test.
- [ ] `scripts/run_tests.sh <app>` passes, and the app boots with no errors
      in its log (`bro-headless <app> -e "0"` exits 0).
- [ ] The app runs windowed and looks like the reference app: kit frame,
      kit controls, tokens only.
- [ ] Every action is a command, with shortcuts where the brief says.
- [ ] Missing optional APIs leave a clear empty or disabled state, not an
      exception.
- [ ] `GAPS.md` lists every engine or kit gap you hit, or says "None found".
- [ ] A short `README.md` in your folder covers what the app does, how to
      run it, and its keyboard shortcuts.
