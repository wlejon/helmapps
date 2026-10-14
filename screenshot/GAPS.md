# Gaps Found While Building Screenshot (`helm.screenshot`)

## 1. `bro.wl.hasScreencopy()` returns `true` in `bro-headless`, and `captureOutput` hangs
- **Where:** `bro.wl` (`hasScreencopy`, `captureOutput`) under `bro-headless`
- **Expected:** In `bro-headless` (`bro.window.displayMode === 'headless'`), `bro.wl.hasScreencopy()` should return `false` (or `captureOutput` should either pump the Wayland queue or reject immediately).
- **Actual:** When `WAYLAND_DISPLAY` is set in the environment, `bro.wl.hasScreencopy()` returns `true` in `bro-headless`, and calling `bro.wl.captureOutput(0)` returns a Promise that never settles because the Wayland event queue is not pumped under the headless video backend.
- **Repro:** `bro-headless screenshot -e "console.log(bro.window.displayMode, bro.wl.hasScreencopy())"`
- **Impact:** Checked `bro.window.displayMode === 'headless'` in `hasScreencopy()` so headless runs cleanly report screencopy unavailable unless a synthetic capture source is installed.
- **Belongs in:** `bro`

## 2. Image clipboard write (`ClipboardItem` / `navigator.clipboard.write`) is missing
- **Where:** Web / clipboard API (`navigator.clipboard`, `ClipboardItem`)
- **Expected:** `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])` copies PNG image data to the system clipboard.
- **Actual:** `ClipboardItem` is `undefined` and `navigator.clipboard` only implements text clipboard operations (`writeText`, `readText`).
- **Repro:** `bro-headless screenshot -e "console.log(typeof ClipboardItem, typeof navigator.clipboard.write)"`
- **Impact:** When `ClipboardItem` is unavailable, `Copy` (`Mod+C`) saves the screenshot (if not already saved) and copies the saved file path to the clipboard via `navigator.clipboard.writeText`, informing the user with a toast.
- **Belongs in:** `bro`

## 3. `new Uint8Array(typedArray)` is ~60x slower than `typedArray.slice()` on large buffers
- **Where:** Bronze JS runtime (`TypedArray` constructor from another `TypedArray`)
- **Expected:** `new Uint8Array(rgbaBuffer)` on an 8.3 MB (`1920×1080×4`) `Uint8Array` should use a fast bulk copy (`memcpy`) like `rgbaBuffer.slice()` (~1.7 ms).
- **Actual:** `new Uint8Array(rgbaBuffer)` takes ~101 ms on an 8.3 MB `Uint8Array` whereas `rgbaBuffer.slice()` and `dst.set(rgbaBuffer)` take ~1.7 ms.
- **Repro:** `bro-headless screenshot -e "const a = new Uint8Array(1920*1080*4); let t = perf.now(); new Uint8Array(a); console.log(perf.now() - t); t = perf.now(); a.slice(); console.log(perf.now() - t);"`
- **Impact:** Used `baseImage.pixels.slice()` when cloning the image buffer in `renderFlattenedPixels()`.
- **Belongs in:** `bro`

## 4. Annotation stroke icons missing from `/lib/icons.js`
- **Where:** `helmapps/lib/icons.js`
- **Expected:** Standard drawing/annotation icons (`pointer`, `rect`, `ellipse`, `arrow-up-right`, `line`, `pen`, `highlighter`, `pixelate`, `counter`).
- **Actual:** Not present in `lib/icons.js`.
- **Impact:** Registered locally at startup via `defineIcon()` in `screenshot/js/tools.js`.
- **Belongs in:** `kit`
