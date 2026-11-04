# Gaps

Engine, platform and kit gaps found building the Image Viewer. Each was
measured with `bro-headless`; the app does not work around any of them
beyond saying so in the window.

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
