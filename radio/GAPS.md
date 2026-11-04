# Radio: engine and kit gaps

## calc() inside translate() is ignored
- **Where:** htmlayout `css/transform.cpp` (`parseLength` reads a number and a unit; no calc(), and em/rem are taken as px)
- **Expected:** `transform: translate(-50%, calc(-100% - 12px))` moves a 20px-tall box up 32px (Chromium)
- **Actual:** the y term is dropped: the box does not move vertically
- **Repro:** `bro-headless radio -e "const d=document.createElement('div'); d.style.cssText='position:absolute;left:100px;top:100px;width:40px;height:20px;transform:translate(-50%, calc(-100% - 12px))'; document.body.appendChild(d); advanceTime(32); console.log(d.getBoundingClientRect().top)"` prints 100, expected 68
- **Impact:** the mood words sat on their points instead of above them; the app uses `translate(-50%, -100%)` with a negative margin-top instead (the same placement, no calc)
- **Belongs in:** htmlayout

## A canvas paints over a dialog while the dialog fades in
- **Where:** bro compositor (a 2D canvas's own layer against a later, higher element with animating opacity)
- **Expected:** the kit dialog's scrim and card (z-index above the content) cover the mood plane's canvas from the first frame of their fade-in
- **Actual:** for the fade (~150 ms) the canvas draws on top of the half-transparent dialog; once the opacity reaches 1 the order is right
- **Repro:** run the radio on the fake backend, press Mod+, and `screenshot()` within a few frames (`tests/fake_backend.js`, then `press(mod+',')`)
- **Impact:** a flash of map over every dialog opened above it; nothing worked around
- **Belongs in:** bro
