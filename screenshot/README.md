# Screenshot (`helm.screenshot`)

Screen capture, region crop, and lightweight image annotation utility for the **helm** desktop environment.

## Features

- **Capture Modes:** Full Screen, Current Display, and interactive Region selection, with configurable capture delay (`0 s`, `3 s`, `5 s`, `10 s`) and pointer inclusion option.
- **Window Hiding:** Automatically hides its own window for two frames before invoking `bro.wl.captureOutput` so the Screenshot app never appears in the captured frame.
- **Region Selection Overlay:** Dimmed fullscreen scrim with an undimmed selection rectangle, live pixel dimensions pill (`W × H`), rule-of-thirds grid, 8 resize handles, and pixel-accurate arrow-key nudging (`1 px`, or `10 px` with `Shift`).
- **Non-Destructive Annotations:** Object-based vector annotations with 50-step Undo/Redo history (`Mod+Z` / `Mod+Shift+Z`), burned into the full-resolution RGBA8 buffer at save time:
  - Select & Move (`V`)
  - Rectangle (`R`)
  - Ellipse (`O`)
  - Arrow (`A`)
  - Line (`L`)
  - Freehand Pen (`P`)
  - Highlighter (`H`)
  - Text Label (`T`)
  - Pixelate / Redact (`B`)
  - Numbered Callout Counter (`N`)
- **CLI Actions:**
  - `bro screenshot --full`: captures the full screen, saves directly to the configured folder, shows a toast, and quits.
  - `bro screenshot --region`: captures and opens the Region selection overlay immediately.
  - `bro screenshot <file.png>`: opens an existing image for annotation and cropping.

## Running & Testing

```bash
# Verify clean headless boot
/home/j/projects/bro/build-release/bro-headless screenshot -e "0"

# Run acceptance & performance tests
VERBOSE=1 /home/j/projects/helmapps/scripts/run_tests.sh screenshot
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+Shift+N` | Take Screenshot |
| `Mod+N` | New Screenshot (Home view) |
| `Mod+O` | Open Image… |
| `Mod+S` | Save to configured Screenshots folder |
| `Mod+Shift+S` | Save As… |
| `Mod+C` | Copy to Clipboard |
| `Mod+Z` | Undo annotation |
| `Mod+Shift+Z` / `Mod+Y` | Redo annotation |
| `C` | Crop Region |
| `V`, `R`, `O`, `A`, `L`, `P`, `H`, `T`, `B`, `N` | Select annotation tool |
| `ArrowKeys` / `Shift+ArrowKeys` | Nudge region selection by `1 px` / `10 px` |
| `Enter` / `Escape` | Confirm / Cancel region selection |
| `Mod+Q` | Quit |
