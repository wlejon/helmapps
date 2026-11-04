# Radio: engine and kit gaps

## A canvas paints over a dialog while the dialog fades in
- **Where:** bro compositor (a 2D canvas's own layer against a later, higher element with animating opacity)
- **Expected:** the kit dialog's scrim and card (z-index above the content) cover the mood plane's canvas from the first frame of their fade-in
- **Actual:** for the fade (~150 ms) the canvas draws on top of the half-transparent dialog; once the opacity reaches 1 the order is right
- **Repro:** run the radio on the fake backend, press Mod+, and `screenshot()` within a few frames (`tests/fake_backend.js`, then `press(mod+',')`)
- **Impact:** a flash of map over every dialog opened above it; nothing worked around
- **Belongs in:** bro
