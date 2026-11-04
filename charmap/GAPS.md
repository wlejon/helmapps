# Engine and Kit Gaps Found While Building Character Map (`helm.charmap`)

## `Ctrl+Shift+C` is intercepted by the engine before reaching the page
- **Where:** `bro` input router (`keyDown` with `KMOD_CTRL | KMOD_SHIFT` + `SDLK_C`)
- **Expected:** Pressing `Ctrl+Shift+C` dispatches a `keydown` event on `window` so `app.commands` can run a command bound to `Mod+Shift+C` (`copy-buffer`).
- **Actual:** `Ctrl+Shift+C` is consumed by the engine's built-in DevTools / Element Picker shortcut and never dispatches `keydown` to the page DOM.
- **Repro:** `bro-headless charmap -e "window.addEventListener('keydown', e => console.log(e.key)); keyDown(99, 6, 0x0041);"` (prints nothing, whereas `keyDown(98, 5, 0x0041)` prints `B`).
- **Impact:** Bound `copy-buffer` to `['Mod+Shift+C', 'Mod+Shift+B']` so the button displays `Ctrl+Shift+C` and `Mod+Shift+B` (or clicking the `Copy Buffer` button) works in headless and windowed runs.
- **Belongs in:** bro
