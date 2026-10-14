# Color Picker (`helm.colorpicker`)

Color Picker, Oklch Harmony Generator, and WCAG 2.1 / APCA Contrast Inspector for the helm desktop.

## Features
- **2D Interactive Color Surface**: Switchable between **HSV** (Saturation × Value) and perceptual **Oklch** (Chroma × Lightness) planes with Hue and Alpha sliders.
- **Live Bi-Directional Format Conversions**: Inspect, edit, and one-click copy `HEX`, `RGB`, `HSL`, `OKLCH`, `OKLAB`, and CSS custom property snippets powered by `bro.themes` (with full pure-JS fallback math).
- **WCAG 2.1 & APCA Contrast Inspector**: Live Foreground vs Background comparison with Normal Text, Large Text, and UI Component badges (`AA 4.5:1`, `AAA 7.0:1`, `APCA Lc`), specimen preview, and one-click **Fix Contrast** in Oklch space.
- **Oklch Harmonies & 50–950 Scale**: Generates Complementary, Analogous, Triadic, Split-Complementary, and Tetradic harmonies plus an 11-step `50..950` Tints & Shades ramp.
- **Saved Palettes & Eyedropper**: Sample pixels from the screen (`bro.wl` screencopy) or test frame and save custom palettes in `bro.conf`.

## Running & Testing
```bash
../bro/build/Release/bro-headless.exe colorpicker -e "0"
scripts/run_tests.sh colorpicker
VERBOSE=1 scripts/run_tests.sh colorpicker perf
```

## Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl+1` .. `Ctrl+4` | Switch between Picker, Contrast, Harmonies, and Palettes views |
| `Ctrl+I` | Open Eyedropper sampler |
| `Ctrl+C` | Copy HEX value |
| `Ctrl+Shift+C` | Copy OKLCH value |
| `Ctrl+S` | Save current color to active palette |
| `Ctrl+N` | Create a new palette |
| `X` | Swap Foreground and Background colors in Contrast Inspector |
| `Ctrl+Q` / `Ctrl+W` | Quit |
