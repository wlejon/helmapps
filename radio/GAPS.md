# Radio: engine and kit gaps

## A canvas paints over a dialog while the dialog fades in
- **Where:** bro compositor (a 2D canvas's own layer against a later, higher element with animating opacity)
- **Expected:** the kit dialog's scrim and card (z-index above the content) cover the atlas canvas from the first frame of their fade-in
- **Actual:** for the fade (~150 ms) the canvas draws on top of the half-transparent dialog; once the opacity reaches 1 the order is right
- **Repro:** run the radio on the fake backend, press Mod+, and `screenshot()` within a few frames (`tests/fake_backend.js`, then `press(mod+',')`)
- **Impact:** a flash of map over every dialog opened above it; nothing worked around
- **Belongs in:** bro

## YuE2 and its VAE could not be freed (fixed)
- **Where:** brosoundml `bro.music` (YuE2, YuE2Vae)
- **Expected:** a way to free several GB of VRAM when the listener picks other models
- **Actual:** only CLAP had `dispose()`; the others waited for a GC
- **Impact:** Models… → Load would have held two copies of YuE2
- **Belongs in:** brosoundml. Fixed: `dispose()` on both (brosoundml, bro docs + test `e6f15ba7`).

## Canvas 2D ignored oklch() colours (fixed)
- **Where:** bro canvas (`parseCSSColor`, `src/canvas/canvas2d.cpp`)
- **Expected:** `ctx.fillStyle = 'oklch(0.52 0.010 255)'` paints that colour, as a stylesheet does
- **Actual:** the assignment was ignored and the canvas kept black, so the kit's tokens (all oklch) could not colour a canvas
- **Repro:** `bro-headless radio -e "const g=document.createElement('canvas').getContext('2d'); g.fillStyle='oklch(0.5 0.1 200)'; console.log(g.fillStyle)"` printed `#000000`
- **Impact:** the atlas drew black on black
- **Belongs in:** bro. Fixed in bro `fc13f284`: colours the fast paths do not parse go through htmlayout's CSS Color 4 parser.
