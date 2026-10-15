# Gaps

Engine, platform and kit gaps found building Music. Each was measured with
`bro-headless`; the app works around none of them beyond saying so in the
window. Gaps every app shares (the MPRIS player side) are in `../GAPS.md`.

## Engine (bro, broaudio)

### A view switch still restyles ~50–90 elements in full
- **Where:** bro (`htmlayout::css::Cascade::resolve`, a full resolve)
- **Expected:** switching back to a view whose list is unchanged costs about
  what putting its element back costs: ~1 ms.
- **Actual:** putting a built list back is now cheap. Its elements keep their
  styles and layout subtrees: swapping the songs and albums lists on the
  stage costs ~1 ms of style and layout for ~220 elements (bro's
  tests/style/test_restyle_cost.js measures ~2 µs an element, down from ~17).
  A real switch (Mod+1..5, steady state) still spends ~3.5–5 ms in style and
  ~0.7 ms in layout. The style goes on 40–90 elements resolved in full (the
  head, sidebar, toolbar, and the list's own changed rows) at ~25 µs each,
  over two style passes, because the list's paint() reads clientWidth in the
  middle of the update. The key's JS is another ~4 ms. A list's first visit
  after a scan builds its rows fresh (~8 µs an element to style).
- **Impact:** test_perf's view-switch "frame" (the key's work plus a frame) is
  ~16–19 ms mean and ~28–37 ms worst, down from ~23 / ~35. Music keeps only
  the list on screen in the document and fills only the rows shown.
- **Belongs in:** bro

## Resolved

- **MPRIS2 player service (`bro.mpris.createService`):** Resolved in `brompris`. `js/mpris.js` publishes `"Music"` (`desktopEntry: "helm.music"`), syncs playback status, metadata, position, volume, loop status, shuffle, capabilities, and `Seeked` signals, and routes incoming MPRIS commands to the player.
- **Waveform seek bar (`bro.media.peaks`):** Resolved. `js/library-worker.js` extracts normalized waveform peaks via `bro.media.peaks` off the main thread and `js/nowplaying.js` renders subtle waveform peak bars on the seek slider.
