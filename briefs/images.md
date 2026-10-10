# Brief: Image Viewer

| | |
|---|---|
| Folder | `helmapps/images/` |
| id | `helm.images` |
| Replaces | Gwenview, Eye of GNOME, Photos |
| Size | about 2000 lines |
| Permissions | none |

## What it is

Opens an image and lets you look at it: fit to the window, zoom, pan, step
through the other images in the same folder, rotate and flip, see its
details. It also has a thumbnail strip, and a folder grid when opened on a
folder. It is not an editor; it does no painting or adjustments.

## Read first

- `../AGENTS.md`, `../lib/README.md`, `../diskusage/`
- `../bro/docs/image-api.js`: decode, `decodeOriented`, `readExifOrientation`, `probeDimensions`, and `<img>` / `new Image()` behaviour
- `../bro/docs/imagebitmap-api.js`: `createImageBitmap`, drawImage sources
- `../bro/docs/thumb-api.js`: thumbnails for the strip and the grid
- `../bro/docs/vfs-api.js`: trash, watch
- `../bro/docs/apps-api.js`, `lib/files.js`: Open With, Show in Files

## Must have

1. **Open** from the command line (`bro images photo.jpg` or a folder), the
   Open command (Mod+O, native picker), or a drop onto the window. Declare
   `fileTypes` for png, jpeg, gif, webp, bmp, svg, tiff, ico, avif and heic,
   keeping only the ones bro decodes. Find out which ones by testing, and
   list the failures in GAPS.md.
2. **The view.** The image centred on `--surface-0`, fit to the window by
   default. Zoom with the wheel around the pointer, Mod+= / Mod+-, 1:1 (Mod+0
   is Fit, Mod+1 is 100%), and a zoom menu in the toolbar (Fit, 25%, 50%,
   100%, 200%, 400%). Pan by dragging when the image is larger than the
   window. Use crisp nearest-neighbour scaling above 200%
   (`image-rendering: pixelated` if bro supports it; otherwise note the gap).
   Draw with an `<img>` and CSS transforms, or a canvas, whichever bro
   renders well. Respect EXIF orientation.
3. **Browse the folder.** Left/Right (or Page Up/Down) for the previous and
   next image in the same folder, in name order, wrapping. Home and End for
   the first and last. The folder list refreshes when files change
   (`bro.vfs.watch`).
4. **Thumbnail strip** along the bottom (toggle with Mod+T), a horizontal
   `VirtualList` grid with one row, with the current image highlighted and
   scrolled into view. Click to go.
5. **Folder grid.** Opening a folder (or pressing Escape on an image) shows
   all its images as a thumbnail grid. Enter or double-click opens one.
6. **Rotate and flip** (R, Shift+R, H, V) affect the view only, and say so.
   Do not write the file.
7. **Fullscreen and slideshow.** F11 toggles fullscreen (`bro.window`), and
   F5 starts a slideshow with a 4 s interval (setting) that any key stops.
8. **Details panel** (Mod+I, a `SplitPane` on the right): name, folder,
   dimensions, file size, type, modified time, and the EXIF fields bro
   exposes.
9. **File actions:** Copy Image (pixels to the clipboard if bro supports
   it, else a GAPS entry and Copy Path only), Open With…, Show in Files,
   Rename (F2), and Move to Trash (Delete, then move to the next image, with
   an Undo toast).
10. Title: `photo.jpg — Image Viewer`. The status bar shows dimensions, zoom
    %, and position in the folder (`12 / 240`).

## Commands and shortcuts

Open Mod+O; Next / Previous Right / Left (also Space / Backspace); First /
Last Home / End; Zoom In / Out Mod+= / Mod+-; Fit Mod+0; 100% Mod+1;
Rotate R / Shift+R; Flip H / V; Fullscreen F11; Slideshow F5; Details
Mod+I; Thumbnails Mod+T; Rename F2; Trash Delete; Show in Files
Mod+Shift+O; Copy Mod+C; Close Mod+W.

## Settings

`showStrip`, `showDetails`, `slideshowSeconds`, `lastFolder`, `background`
(dark, mid or checker for transparent images).

## Missing APIs

Without `bro.thumb`, generate small previews by decoding (lazily, a few at a
time) or show file icons, whichever stays responsive. Without `bro.vfs`
there is no trash and no live folder refresh.

## Acceptance tests

Create test images with the headless `writeFile` (PNG bytes) or by drawing
into a canvas and encoding. A tiny PNG can also be committed under
`tests/fixtures/`.

1. Opening an image file shows it fitted, with a correct title and the
   status bar showing its dimensions.
2. Next and Previous move through the folder's images in name order,
   skipping non-images, and wrap at the ends.
3. Zoom In twice then Fit returns to the fitted scale. 100% shows a scale
   of 1 (assert on your view model, not pixels).
4. Rotate R four times returns to 0°. The file on disk is unchanged
   (compare bytes).
5. Opening a folder shows the grid with one cell per image, and Enter on a
   cell opens it.
6. Rename changes the file on disk and the title follows.
7. A new image written into the folder appears in the strip without a
   reload (where `bro.vfs` exists).
8. Escape from an image returns to the grid, with that image selected.

## Not in this pass

Editing (crop, adjust, draw), saving rotated copies, printing, wallpaper
setting (helm owns wallpaper), RAW formats, animated GIF/WebP playback if
bro does not animate `<img>` (a GAPS entry if not).
