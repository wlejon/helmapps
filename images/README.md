# Image Viewer

Opens an image and lets you look at it: fitted to the window, zoomed around
the pointer, panned, stepped through the other images in its folder,
rotated and flipped (the view only; the file is never changed), with its
details beside it. A thumbnail strip runs along the bottom, and opening a
folder (or pressing Escape on an image) shows the folder as a grid of
previews. Rename and Move to Trash (with Undo) are the only things it does
to a file.

PNG, JPEG, GIF, BMP, ICO, WebP, TIFF and SVG open; an animated GIF or WebP
plays. AVIF and HEIC do not decode in bro, so they are not offered (see
`GAPS.md`). The details panel shows the camera's EXIF (camera, lens,
exposure, date taken, location), and Mod+C copies the picture itself.

```bash
bro images photo.jpg                       # an image, with its folder to step through
bro images ~/Pictures                      # a folder, as a grid
scripts/run_tests.sh images                # from helmapps/: every test, headless
IV_PERF_DIR=~/Pictures VERBOSE=1 scripts/run_tests.sh images perf   # also time a real folder
```

How it stays responsive (`../docs/performance.md`):

- The window is built before anything touches the disk; the file from the
  command line opens on the next tick.
- Decoding runs on a decoder thread (`js/decode-worker.js`). A picture
  arrives as a transferred ImageBitmap (a handle: bro moves the pixels and
  uploads them to the GPU ahead of the draw) no bigger than the screen, so
  the neighbours kept for Next and Previous stay small. Zoomed in past
  that, the whole picture comes at full resolution the same way.
- An animated GIF or WebP is an `<img>`, which bro plays (and pauses while
  it is not on screen).
- The images either side of the one on screen are decoded while you look,
  so Next and Previous show at once.
- Previews come from `bro.thumb` on its own threads, only for the cells on
  screen, six at a time; without `bro.thumb` the decoder thread makes them.

| Keys | |
|---|---|
| Right, Page Down, Space | Next image (wraps) |
| Left, Page Up, Backspace | Previous image (wraps) |
| Home / End | First / last image |
| Mod+= / Mod+- | Zoom in / out (the wheel zooms around the pointer) |
| Mod+0 / Mod+1 | Fit / 100% |
| R / Shift+R | Rotate right / left (view only) |
| H / V | Flip horizontally / vertically (view only) |
| Escape | Leave full screen; else show the folder grid |
| Enter, double-click | Open the image selected in the grid |
| F11 | Full screen |
| F5 | Slideshow (any key stops it; interval in the `slideshowSeconds` setting) |
| Mod+I | Details panel |
| Mod+T | Thumbnail strip |
| F2 | Rename |
| Delete | Move to Trash (Undo in the toast) |
| Mod+C | Copy the picture (as a PNG) |
| Mod+Shift+C | Copy the path |
| Mod+Shift+O | Show in Files |
| Mod+O | Open an image or folder |
| Mod+W | Close the window |

Drag the picture to pan it when it is larger than the window; double-click
switches between Fit and 100%. The background (dark, grey, or a
checkerboard behind transparent pixels) is in the More menu.

## Files

| File | |
|---|---|
| `js/main.js` | The window, commands, toolbar, opening and stepping, file action wiring |
| `js/viewer.js` | The view: fit, zoom, pan, rotate, flip; draws into a canvas (or lays out an SVG or animation) |
| `js/decoder.js` | Pictures from the decoder thread, the neighbours' prefetch, full resolution, PNG for copying |
| `js/decode-worker.js` | The decoder thread: bro.image decode (EXIF upright), EXIF, previews, PNG |
| `js/folder.js` | The folder's images in name order, refreshed by `bro.vfs.watch` |
| `js/thumbs.js` | Previews for the grid and the strip (`bro.thumb`, else the decoder thread) |
| `js/gallery.js` | Preview cells, and the strip: a one-row horizontal `VirtualList` |
| `js/details.js` | The details panel |
| `js/actions.js` | Rename, Move to Trash, Copy Image, Copy Path, Open With, Show in Files |
| `js/presentation.js` | Full screen and the slideshow |
| `js/formats.js` | Which formats open and how, name order |
| `tests/` | Headless acceptance tests and `test_perf.js` |
