# Image Viewer

Opens an image and lets you look at it: fitted to the window, zoomed around
the pointer, panned, stepped through the other images in its folder,
rotated and flipped (the view only; the file is never changed), with its
details beside it. A thumbnail strip runs along the bottom, and opening a
folder (or pressing Escape on an image) shows the folder as a grid of
previews. Rename and Move to Trash (with Undo) are the only things it does
to a file.

PNG, JPEG, GIF, BMP, ICO, WebP, TIFF, SVG and AVIF open; an animated GIF or
WebP plays (an animated AVIF shows its first frame). HEIC opens where the
system can decode it (Windows with the HEVC Video Extensions, macOS); where
it cannot (`bro.image.decodeSupport`), a HEIC is still listed with a
placeholder tile, and opening it says why. The details panel shows the camera's EXIF (camera, lens,
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

## Stabilize a burst

A burst of photos of a moving subject (a bird bathing, shot at 10 frames a
second) becomes a short animation with the subject, or the scene, held
still:

1. **Select Subject** (S, the sparkles button) and click the subject; more
   clicks add to it, Alt+click removes an area. The mask shows over the
   photo. The strip selects the photo's own burst (photos whose EXIF times
   are close together); Shift+click in the strip extends the range from the
   photo, Ctrl+click adds or leaves out one frame.
2. **Stabilize Burst** (B) opens the frames. The subject is tracked frame to
   frame on a crop that follows it; across a gap between bursts it jumps.
   Each frame in the row along the bottom shows its mask and a badge: the
   tracker's confidence, *Check* when it is low, *Click subject* when it lost
   it. Go to such a frame and click the subject (C turns that on for any
   frame); tracking carries on from there. X leaves a frame out.
3. **Lock** (L): *Subject* holds the subject's position and size (its own
   alignment, pulled onto the mask and smoothed); *Scene* holds the
   surroundings (aligned with the subject left out) so the subject moves
   naturally through a steady scene. The last lock used is remembered.
4. **Crop**: drag the frame to move it, a corner to size it, in the shape
   chosen (Free, 1:1, 4:5, 3:2, 16:9). It stays inside what every included
   frame covers; what not every frame covers is shaded.
5. **Timing** comes from the EXIF times (to the hundredth of a second). A
   step longer than 0.4 s, or than 3x the typical step, is a gap between
   bursts and is trimmed to the hold (0.1 s by default). Speed scales it
   all; a frame's own hold overrides its time. The panel shows how long the
   photos took and how long the animation plays. Space plays and pauses,
   Left / Right step.
6. **Export** (Mod+E) a GIF (each frame its own delay) or a WebM (30 fps,
   frames repeated to keep the timing), at the size chosen (long side), to a
   file named for the first and last photo beside them. Frames are rendered
   from the full-resolution photos (the crop plus a margin, area-resized,
   then warped bicubic) and encoded on a worker.

The subject model comes from `bro.models`: SAM 2.1 (`sam2.1-hiera-*`) when
this bro has `bro.vision.loadSam2`, else SAM (`sam-vit-base`). Put the
weights folder in one of `bro.models.dirs` (the `BRO_MODELS` path list, the
`models.dirs` setting, or the per-user models folder); without one, Select
Subject says where it looked. Tracking, decoding and alignment run on a
worker (`js/burst/track-worker.js`), previews and export on another
(`js/burst/media-worker.js`); the page only draws.

| Keys | Stabilize |
|---|---|
| S | Select Subject (on a photo) |
| B | Stabilize Burst |
| Space / Left / Right | Play or pause / previous / next frame |
| C | Correct the frame's subject (click it) |
| X | Leave the frame out (or back in) |
| L | Hold the scene still / the subject |
| Mod+E | Export |
| Escape | Back to the photo |

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
| `js/burst/burst.js` | Stabilize a burst: the feature's commands, the subject tool and the strip's burst selection |
| `js/burst/subject-tool.js` | Select Subject: clicks on the photo, the mask over it |
| `js/burst/session.js` | The burst: frames, EXIF times, seeds, tracking out from the reference |
| `js/burst/track-worker.js` | The tracking thread: crops at the model's size, subject and scene alignment, the model |
| `js/burst/model.js` | The subject model behind one interface: SAM 2.1, SAM, or a colour key (tests) |
| `js/burst/frames.js` | Decoding, crops, mask resampling and measuring (worker side) |
| `js/burst/stabilize.js` | Transforms for the subject and scene locks, the common area, the crop |
| `js/burst/timing.js` | EXIF times, bursts and gaps, the schedule, GIF delays and WebM repeats |
| `js/burst/view.js` | The stabilize view: the held-still frame, the crop, playback, corrections |
| `js/burst/frame-row.js` / `panel.js` | Its frame row (masks and badges) and side panel |
| `js/burst/exporter.js` / `media-worker.js` | Export: the save dialog; rendering and encoding on a worker |
| `js/burst/affine.js` / `draw.js` / `rpc.js` | 2x3 matrices and polygons, mask drawing, worker calls |
| `tests/` | Headless acceptance tests and `test_perf.js`; `tests/burst.js` makes synthetic bursts |
