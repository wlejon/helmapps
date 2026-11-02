# Gaps Found While Building Screenshot (`helm.screenshot`)

None remaining.

## Resolved
- Cross-platform screen capture fallback chain implemented in `js/capture.js`: checks `bro.window?.captureScreen`, `bro.wl?.captureOutput` (Wayland `wlr-screencopy`), `bro.portal?.screenshot` (XDG Desktop Portal), and native OS CLI capture via `child_process` (`screencapture -x` on macOS, PowerShell `System.Drawing.Bitmap` / `Graphics.CopyFromScreen` on Windows, and `grim` on Linux) saving to a temp PNG and decoding via `bro.image.decodeOriented`, falling back to `createSyntheticSource()` only when permissions or tools are unavailable.
- `bro.wl.hasScreencopy()` now returns `false` directly from the engine under `bro-headless`, and `captureOutput` rejects immediately if called in headless mode.
- Image clipboard read/write (`ClipboardItem` and `navigator.clipboard.write` / `read` with `'image/png'`) is now implemented in `bro` (`docs/clipboard-api.js`).
- `new Uint8Array(typedArray)` in Bronze now uses a fast bulk copy (`memcpy`) when constructing from a same-element `TypedArray`.
- Annotation stroke icons (`pointer`, `rect`, `ellipse`, `arrow-up-right`, `line`, `pen`, `highlighter`, `pixelate`, `counter`) have been lifted into `/lib/icons.js`.
