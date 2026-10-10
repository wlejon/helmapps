# Gaps

Engine, platform and kit gaps found building the Image Viewer. Each was
measured with `bro-headless`; the app does not work around any of them
beyond saying so in the window. Kit-level gaps shared by every app (opening
another app by id off Linux) are in `../GAPS.md`.

## TIFF does not decode
- **Where:** broimage (`bro.image.decode*`), `<img>`
- **Expected:** TIFF (uncompressed, LZW, JPEG-in-TIFF) opens like PNG.
- **Actual:** all three fail in `<img>` and in `bro.image.decodeOriented`.
- **Repro:** `tests/images.js` `tiff()`; `test_formats.js` asserts it is not offered.
- **Impact:** TIFF is left out of `bro.json` fileTypes and the Open dialog.
- **Belongs in:** broimage

## No AVIF or HEIC decoder
- **Where:** broimage
- **Expected:** phone photos (HEIC) and AVIF open.
- **Actual:** broimage has no decoder for either (no samples were at hand to
  try `<img>`, but nothing in bro would decode them).
- **Impact:** not offered.
- **Belongs in:** broimage

## bro.image does not read WebP or SVG
- **Where:** broimage (`decodeOriented`, `probeDimensions`)
- **Expected:** the same formats `<img>` loads.
- **Actual:** WebP and SVG come back 0x0 or 1x1 from `decodeOriented`, and
  `probeDimensions` fails on them, though `<img>` shows both.
- **Impact:** WebP decodes on the page with an `<img>` instead of on the
  decoder worker; the grid shows the WebP itself as its preview when
  `bro.thumb` has none.
- **Belongs in:** broimage

## Only the EXIF orientation is readable
- **Where:** broimage
- **Expected:** camera, lens, exposure, ISO, date taken, GPS.
- **Actual:** `readExifOrientation` is the one EXIF field exposed.
- **Impact:** the details panel shows Orientation and says that is all bro
  reads.
- **Belongs in:** broimage (`bro.image.readExif`)

## GIF and WebP do not animate
- **Where:** bro (`<img>`), broimage
- **Expected:** an animated GIF/WebP plays (or frames are decodable).
- **Actual:** the first frame only, with no frame API.
- **Impact:** the first frame is shown.
- **Belongs in:** bro / broimage

## The clipboard cannot hold an image
- **Where:** bro (`navigator.clipboard`)
- **Expected:** `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`.
- **Actual:** only `readText` / `writeText`; no `write`, no `ClipboardItem`.
- **Impact:** Mod+C is "Copy Path".
- **Belongs in:** bro

## Taking delivery of a big ImageBitmap costs the page a frame
- **Where:** bro (Worker transfer, canvas upload)
- **Expected:** a transferred bitmap is a handle; the page pays nothing
  until it draws, and the upload does not stall the frame.
- **Actual:** receiving costs about 0.3 ms per MB (a 24 MP photo is 96 MB:
  22-30 ms), and the first draw of it another ~50 ms of upload.
- **Impact:** the worker sends a screen-sized preview, and full resolution
  comes as 1024 px tiles only for the part on screen, one per frame.
- **Belongs in:** bro

## brokit `path.join` is slow (~15 µs a call)
- **Where:** brokit `path`
- **Actual:** joining 400 names to a folder takes about 6 ms.
- **Impact:** the folder list builds paths by concatenation.
- **Belongs in:** brokit

## Kit: VirtualList has no horizontal orientation
- **Where:** `lib/list.js`
- **Impact:** the thumbnail strip is `StripList` (`js/gallery.js`), a
  subclass that lays cells out in one row.
- **Belongs in:** kit (`new VirtualList({ orientation: 'horizontal' })`)

## Kit: no flip-vertical icon
- **Where:** `lib/icons.js`
- **Impact:** `js/main.js` defines `flip-v`.
- **Belongs in:** kit

## docs/performance.md: the trace window is seconds
- **Where:** `../docs/performance.md`
- **Actual:** the example `controlCommand('trace', '20', ...)` says "the
  frames of the next 20 ms"; the argument is seconds of the past
  (`bro/docs/agent-control.md`), so a trace issued before the work reports
  "no frames in the window". Bracket with `controlCommand('now')` and
  `--since=` instead.
- **Belongs in:** docs
