# Gaps

Engine, platform and kit gaps found building Music. Each was measured with
`bro-headless`; the app works around none of them beyond saying so in the
window. Gaps every app shares (notification clicks, the MPRIS player side)
are in `../GAPS.md`.

## Engine (bro, broaudio)

### `<img>` decodes synchronously
- **Where:** bro (`HTMLImageElement`), as in `../images/GAPS.md`
- **Impact:** covers are 320 px JPEGs made by the scan worker, and decoded
  `<img>` elements are kept on a shelf (`js/covers.js`) and moved between
  grid cells instead of re-pointed.

### Style and layout cost ~22 µs per element put back in the document
- **Where:** bro (`Document::resolveStylesRecursive`, `htmlayout::css::Cascade`)
- **Expected:** a view of ~300 elements (25 song rows, or an album grid
  page) is styled and laid out in a ms or two.
- **Actual:** re-inserting 25 list rows of 5 columns (277 elements) costs a
  median 5.9 ms of style and layout, 1102 elements 24.9 ms (kit-tests page,
  `bro-headless`): ~22 µs an element. Profiling a run of view switches:
  ~40% of the samples are in style resolution, ~10% flex layout, ~15% GC.
- **Impact:** a change of view (Mod+1..4) costs 15–25 ms on the page
  thread, most of it this, and test_perf's view-switch "frame" (the key's
  work plus a frame) is ~23 ms mean, ~35 ms worst on a quiet box. With
  other work on the machine it has reached 52–63 ms. Music already keeps
  only the list on screen in the document and fills only the rows shown.
- **Belongs in:** bro

### `stat().mtimeMs` of an untouched file can change by 1 ms
- **Where:** brokit `fs` (`js_statSync` in `src/api/fs.cpp`, `mtimeMsOf` in
  `src/api/fs_async.cpp`)
- **Expected:** stat of a file nobody wrote answers the same `mtimeMs`
  every time.
- **Actual:** the file time is converted as
  `mtime - file_clock::now() + system_clock::now()`, two clocks sampled at
  slightly different moments, then cut to whole ms. When the gap between the
  two samples moves (the thread is preempted between them, or the clocks
  tick at different resolutions), a file time near a ms boundary lands in
  the neighbouring ms. Measured: of 20 000 untouched files stat'ed 50 times
  each, one `fs.promises.stat` answered `...856` for a file whose time is
  `15:28:15.8570016` (statSync: `...857`). A deterministic conversion is
  `std::chrono::clock_cast<std::chrono::system_clock>(mtime)` (C++20).
- **Impact:** a rescan now and then reads a file again that did not change
  (test_perf saw 1 of 1500 once). Music compares `size` and `mtime` exactly
  and keeps doing so: a tolerance would hide real edits made within a ms.
- **Belongs in:** brokit

## Not built

- **MPRIS player:** see `../GAPS.md` ("No MPRIS player side").
- **Waveform seek bar:** `bro.media.peaks` reads audio files now; the seek
  bar is still a plain slider.
