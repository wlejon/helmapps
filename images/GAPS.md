# Gaps

Engine, platform and kit gaps found building the Image Viewer. Each was
measured with `bro-headless`; the app does not work around any of them
beyond saying so in the window. Kit-level gaps shared by every app are in
`../GAPS.md`.

## No HEIC decoder on Linux (AVIF resolved)
- **Where:** broimage
- **Expected:** phone photos (HEIC) and AVIF open.
- **Actual:** AVIF now decodes everywhere (broimage's own HEIF reader, dav1d
  in bro; 8/10/12-bit, alpha, grids, irot/imir; an animated AVIF shows its
  first frame). HEIC decodes only through the system's decoder: WIC on
  Windows when the Microsoft Store's HEVC Video Extensions are installed,
  ImageIO on macOS. Linux has none (bro carries no HEVC decoder).
- **Impact:** where HEIC cannot be decoded it is listed with a placeholder
  tile and opening it shows `bro.image.decodeSupport`'s reason; the Open
  dialog leaves it out.
- **Belongs in:** broimage (an HEVC backend, if one with a usable licence is chosen)

## No SAM 2.1 tracker yet
- **Where:** brovisionml / bro (`bro.vision`)
- **Expected:** Stabilize tracks the subject with SAM 2.1's video memory
  (`bro.vision.loadSam2`, weights `sam2.1-hiera-*`).
- **Actual:** only SAM 1 (ViT-B) is in `bro.vision`. Each frame is prompted
  afresh with the box and point predicted from the last frame's mask and
  the alignment, and the proposal nearest the expected area is kept. On the
  real 14-photo robin sequence that held through all five bursts, but a
  splashing frame scores ~0.5.
- **Impact:** none to work around: `js/burst/model.js` has the SAM 2.1
  backend behind the same interface and `findModelSpec` prefers it once
  `loadSam2` exists.
- **Belongs in:** brovisionml (the Hiera encoder, memory attention and
  memory encoder), bro (`bro.vision.loadSam2`)

## bro.media.tags does not read WebM
- **Where:** bro (`bro.media.tags`, docs/video-api.js)
- **Expected:** a WebM's length (and any tags) like the other containers.
- **Actual:** `bro.media.tags(file.webm)` answers null. The tests read the
  exported WebM back through `<video>` (duration, `stepFrame`) instead.
- **Belongs in:** bro (a Matroska/WebM reader in the tags code)

## fs.mkdtempSync is missing
- **Where:** brokit (`fs`)
- **Expected:** Node's `fs.mkdtempSync(prefix)`.
- **Actual:** undefined; tests make their folders with `mkdirSync` and a
  pid/time name (`lib/test.js` `fixtureDir`).
- **Belongs in:** brokit

## Menu items have no count column
- **Where:** kit (`lib/menu.js`)
- **Expected:** a menu item can carry a count at its trailing edge, as the
  Animals filter's "Blue Jay 3" does in a file manager's sidebar.
- **Actual:** the trailing slot is the shortcut (`keys`). The Animals menu
  puts each species' photo count there, so it reads like a key hint.
- **Belongs in:** kit (a `count` field on a menu item, styled apart from `keys`)

## Fixed while building Find Animals
- `bro.vision.wildlife.locate()` without a species list now names the
  list as missing when `bro.models` has no `species` folder (bro d35b63cb).
  It answered available on a machine with owlv2 and bioclip-2 but no list,
  so the app never offered the list for download.

## Fixed while building Stabilize
- `GifEncoder` / `VideoEncoder` work in a Worker (`addFrameRGBA`), so the
  export renders and encodes off the page thread.
- `bro.models.find(name)` / `bro.models.dirs`: where model weights live
  (`BRO_MODELS`, the `models.dirs` setting, the per-user models folder), so
  the app asks for `sam-vit-base` instead of carrying a path.
- `bro.models.fetch(name, {onProgress, signal})`: a machine without weights
  installs SAM 2.1 from the bro model datasets (verified, resumable, renamed
  into place), so Select Subject downloads it on a click instead of telling
  the user where to put a folder.
- The kit's `VirtualList` takes `typeAhead: false`: with the thumbnail strip
  focused, letters were jumping through the strip instead of reaching the
  app's shortcuts (R, H, V, and now S, B).
