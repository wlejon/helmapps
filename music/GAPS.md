# Gaps

Engine, platform and kit gaps found building Music. Each was measured with
`bro-headless`; the app works around none of them beyond saying so in the
window. Gaps every app shares (the MPRIS player side) are in `../GAPS.md`.

## Engine (bro, broaudio)

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

## Not built

- **MPRIS player:** see `../GAPS.md` ("No MPRIS player side").
- **Waveform seek bar:** `bro.media.peaks` reads audio files now; the seek
  bar is still a plain slider.
