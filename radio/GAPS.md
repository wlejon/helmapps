# Radio: engine and kit gaps

## Canvas 2D ignored oklch() colours (fixed)
- **Where:** bro canvas (`parseCSSColor`, `src/canvas/canvas2d.cpp`)
- **Expected:** `ctx.fillStyle = 'oklch(0.52 0.010 255)'` paints that colour, as a stylesheet does
- **Actual:** the assignment was ignored and the canvas kept black, so the kit's tokens (all oklch) could not colour a canvas
- **Repro:** `bro-headless radio -e "const g=document.createElement('canvas').getContext('2d'); g.fillStyle='oklch(0.5 0.1 200)'; console.log(g.fillStyle)"` printed `#000000`
- **Impact:** the atlas drew black on black
- **Belongs in:** bro. Fixed in bro `fc13f284`: colours the fast paths do not parse go through htmlayout's CSS Color 4 parser.
