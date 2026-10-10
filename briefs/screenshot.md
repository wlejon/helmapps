# Brief: Screenshot

| | |
|---|---|
| Folder | `helmapps/screenshot/` |
| id | `helm.screenshot` |
| Replaces | Spectacle, GNOME Screenshot, Snipping Tool |
| Size | about 2000 lines |
| Permissions | `["wl"]` (screencopy) |

## What it is

Takes a picture of the screen (the whole screen or a region), lets you
annotate it lightly, and saves, copies or opens it. Screen recording comes
later.

## How capture works

Under helm on Linux, the app is a Wayland client and captures through
`bro.wl.captureOutput(outputIndex)` (wlr-screencopy), which returns RGBA
pixels. That needs `"permissions": ["wl"]` in `bro.json`, plus trust (see
`../bro/docs/apps.md`, Permissions; during development, run with
`BRO_TRUST_ALL=1` or list the app in your permissions file). If
`bro.wl.hasScreencopy()` is false (another compositor, Windows, a test),
the app shows an empty state saying capture is unavailable here. It can
still open and annotate an existing image, so it is useful anyway and
testable.

**Your own window must not be in the shot.** Hide it before capturing (move
it off-screen or minimise it with `bro.window`, then wait for two frames).
File a gap if bro cannot hide and re-show it reliably.

## Read first

- `../AGENTS.md`, `../lib/README.md`, `../diskusage/`
- `../bro/docs/wl-api.js`: `captureOutput`, `hasScreencopy`
- `../bro/docs/window-api.js`: borderless, always-on-top, fullscreen, minimize, displays (for the region-selection overlay and hiding)
- `../bro/docs/image-api.js`: `encodePng`, `encodePngFile`, `encodeJpegFile`
- `../bro/docs/apps-api.js`, `lib/files.js`: open with the image viewer, Show in Files

## Must have

1. **Modes:** Full screen, Current display, and Region. A delay of 0, 3, 5
   or 10 s (with a countdown in a toast before hiding). A main window with
   big mode buttons and a "Take Screenshot" primary button.
2. **Region selection.** After capture, show the frozen screenshot in a
   borderless fullscreen always-on-top window (or the main window made
   fullscreen) dimmed by a scrim, and drag a rectangle that stays undimmed,
   showing its size in px, resizable from its handles, and nudged by the
   arrow keys. Enter accepts and Escape cancels.
3. **Result view.** The captured image fitted in the window, with a toolbar:
   Save (Mod+S, to `~/Pictures/Screenshots/Screenshot YYYY-MM-DD HH-MM-SS.png`
   by default, folder in Settings), Save As, Copy (to the clipboard as an
   image if bro supports it, else a GAPS entry and copy the saved path),
   Open With…, Show in Files, and New Screenshot.
4. **Annotate** (simple): arrow, rectangle, highlighter, text, and blur box,
   in one colour from a small palette, with Undo/Redo (Mod+Z / Mod+Shift+Z).
   Draw on a canvas over the image, keeping the annotations as objects so
   they can be undone, and burn them in at save time.
5. **Command-line modes** for helm keybindings: `bro screenshot --full`
   captures and saves immediately, then shows a toast and quits, and
   `--region` goes straight to selection. A single-instance launch while
   open runs the requested mode.
6. Remember the last mode, delay, folder and format (png or jpg, plus jpg
   quality).

## Acceptance tests

Capture cannot run headless, so structure the code so the capture source is
replaceable: `captureSource()` returns `{width, height, pixels}`, and tests
supply a synthetic gradient via `app.expose`.

1. With screencopy unavailable, the app boots and shows the "capture
   unavailable" state, and Open Image still works.
2. With the synthetic source, Full Screen produces a result view of the
   source's size.
3. Region: a simulated drag from (100,100) to (300,250) then Enter gives a
   200×150 result, and the arrow keys nudge the rectangle by 1 px (10 with
   Shift).
4. Save writes a PNG of the right dimensions (`bro.image.probeDimensions`
   on the file) to the configured folder with the dated name.
5. Annotate: two rectangles, then Undo leaves one, and saving burns in only
   one (check a pixel in the saved file's decoded data).
6. `--full` with the synthetic source saves without showing the result
   view.

## Not in this pass

Screen recording (`VideoEncoder` exists; a later brief), window capture
(pick a window), OCR, uploading.
