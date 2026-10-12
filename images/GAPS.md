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

## Burst carry-over matches boxes, not tracks
- **Where:** this app (`js/wildlife/crops.js`, `editor.js`)
- **Expected:** a name given to one animal of a burst follows that animal
  through the other frames, even where it moved far or overlaps another.
- **Actual:** each other frame's crop that overlaps the named box most (IoU
  0.3 or more) is taken as the same animal; a frame where it moved farther
  is left alone. bro.vision's SAM 2.1 tracking (one object across frames)
  could follow it instead; not built, as overlap holds for bursts shot
  0.1-0.5 s apart.
- **Belongs in:** this app (using `bro.vision` SAM 2.1 tracking)

## Fixed after corrections (your answers)
- `String.prototype.normalize` did nothing, so `normalize('NFD')` folded
  no accents in name matching (`mine.js` `fold`). bronze 5b0fa20 has
  NFC/NFD/NFKC/NFKD (UAX #15, checked against NormalizationTest.txt); bro
  tests/intl/test_string_normalize.js.
- brokit `fs.fsyncSync` was missing and `fs.writeSync(fd, string)` threw.
  brokit 0402b34 has both (and `fdatasyncSync`, `fs.fsync`, `fs.write`),
  so the answers store writes its text straight and syncs it before the
  rename, always (`answers-worker.js` `writeDurably`).
- brokit `fs.mkdtempSync` was missing: brokit 0402b34 has it (and
  `fs.mkdtemp`, `fs.promises.mkdtemp`). `lib/test.js` `fixtureDir` still
  makes its own names, which it needs under one test home anyway.
- No `<datalist>`: bro now has it (`input.list`, `datalist.options`, the
  suggestions under the field as she types, Up / Down / Enter, a click,
  `input` with `insertReplacementText`; tests/dom/test_datalist.js). The
  name field keeps the kit's `Combobox`: its matching is fuzzy, its rows
  carry a detail, and the lists are thousands of names.
- "Looks like your Blue Jay" looked only in the open folder (a folder's
  crop embeddings are in its cache). Her named crops are now kept in the
  data dir (`js/wildlife/examples.js`: `wildlife/examples.json` and the
  float32 rows it names), made again from her answers as each photo's
  crops are known (a revert, Remove or Undo follows), at most 8 of a name;
  tests/test_animals_examples.js.
- Three saves in a row were three toasts over the thumbnail strip. The
  kit's `toast` takes a `key`: a toast replaces the one shown with its key,
  and her answers' toasts share one (the latest, its Undo the latest's).

## Fixed while building corrections (your answers)
- A key whose keydown the page cancelled still typed its character: N
  opened the name field and an "n" landed in it. bro now drops the text
  input of a cancelled keydown (tests/events/test_key_text_after_cancelled_keydown.js).
- A press moved the focus before the page saw the mousedown, so a
  suggestion list under the field could not keep the field focused: the
  field blurred and the edit was cancelled before the click. bro now
  dispatches mousedown first and moves the focus only as its default
  action, as browsers do (tests/events/test_mousedown_prevent_focus.js).
- `bro.vision.wildlife.nameEntries()` / `nameIndex()`: every name a person
  can give an animal (species rows, their groups) and a matcher over them,
  so the app does not carry its own copy of the lists' names.
- `analyze(img, { embeddings: true })` and `bro.vision.wildlife.nearest()`
  (bro 87af743e): each crop's image embedding, and the rows most like one,
  for "looks like your Blue Jay from May 1".
- The kit has a `Combobox` (`lib/combobox.js`): a text field with a list
  of suggestions, free text allowed.

## Fixed while building Find Animals
- `bro.vision.wildlife.locate()` without a species list now names the
  list as missing when `bro.models` has no `species` folder (bro d35b63cb).
  It answered available on a machine with owlv2 and bioclip-2 but no list,
  so the app never offered the list for download.
- Menu items had no count column, so the Animals menu put each species'
  photo count in the shortcut slot. The kit's menu items take `count` now,
  in its own tabular column before the shortcut.

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
- A 2D canvas taken out of the document and put back kept nothing: bro's
  frame sweep dropped its scene, so it painted nothing and its context drew
  into nothing. Every recycled cell of the stabilize frame row (a virtual
  list) went blank after about the 18th frame. bro 168be1b1 keeps a canvas's
  bitmap and context until its element is gone; tests/test_burst_thumbs.js
  checks every picture of a 120-frame timeline in the presented frame.
