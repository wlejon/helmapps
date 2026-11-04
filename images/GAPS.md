# Gaps

Engine, platform and kit gaps found building the Image Viewer. Each was
measured with `bro-headless`; the app does not work around any of them
beyond saying so in the window.

## No HEIC decoder on Linux
- **Where:** broimage
- **Expected:** phone photos (HEIC) open.
- **Actual:** HEIC decodes only through the system's decoder: WIC on
  Windows when the Microsoft Store's HEVC Video Extensions are installed,
  ImageIO on macOS. Linux has none (bro carries no HEVC decoder).
- **Impact:** where HEIC cannot be decoded it is listed with a placeholder
  tile and opening it shows `bro.image.decodeSupport`'s reason; the Open
  dialog leaves it out.
- **Belongs in:** broimage (an HEVC backend, if one with a usable licence is chosen)

## Burst carry-over matches boxes, not tracks
- **Where:** this app (`js/wildlife/crops.js`, `editor.js`)
- **Expected:** a name given to one animal of a burst follows that animal
  through the other frames, even where it moved far or overlaps another.
- **Actual:** each other frame's crop that overlaps the named box most (IoU
  0.3 or more) is taken as the same animal; a frame where it moved farther
  is left alone. `bro.vision.loadSam2` / `Sam2Tracker` (one object across
  frames; `js/burst/model.js` already uses it for Stabilize) could follow it
  instead; carry-over does not use it yet, as overlap holds for bursts shot
  0.1-0.5 s apart.
- **Belongs in:** this app (using `bro.vision` SAM 2.1 tracking)
