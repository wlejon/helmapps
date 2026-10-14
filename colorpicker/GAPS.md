# GAPS — Color Picker (`helm.colorpicker`)

## Kit lacks a reusable color-picker popover control
- **Where:** `helmapps/lib`
- **Expected:** A compact color swatch + popover picker control in `/lib/controls.js` for apps that let users choose a tint or annotation color.
- **Actual:** Listed in `lib/README.md` under "What the kit does not have (yet)".
- **Impact:** Built `ColorPlane` (2D HSV & Oklch canvas) and format converters inside `colorpicker/js/`; can be lifted into `/lib/` when another app needs an embedded color control.
- **Belongs in:** kit
