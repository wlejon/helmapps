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

## Kit (`../lib`)

### A hidden fluid grid lays out a cell for every item
- **Where:** `lib/list.js` `paint()`
- **Expected:** a list that is not shown (`display: none`, 0 px wide)
  paints nothing.
- **Actual:** the ResizeObserver repaints it at 0 px: a fluid grid then has
  one column with near-zero row height, and `clientHeight || 600` lets every
  row through. With 500 albums that was ~3500 elements restyled on every
  frame that changed anything (~100 ms per change of view).
- **Impact:** Music keeps only the list on screen in the document
  (`Views.mount`), which is good anyway: hidden lists are restyled too.
- **Belongs in:** the kit: `paint()` returns when the scroller is 0 px wide.

### A grid takes Alt+Left / Alt+Right as plain arrows
- **Where:** `lib/list.js` `onKey`
- **Expected:** arrows with Alt (Back / Forward) pass through to the commands.
- **Actual:** the grid moves its cursor and calls `preventDefault`, so the
  window's Back command never sees the key.
- **Impact:** on the artist page (an album grid) Alt+Left does not go back;
  Backspace does. The album grid at the top is not affected (nothing to go
  back to).
- **Belongs in:** the kit: ignore arrow keys with Alt/Ctrl/Meta.

### No drag to reorder in VirtualList
- **Where:** `lib/list.js`
- **Expected:** `reorderable: true` + `onReorder(from, to)` with a drop
  marker, as a queue or a playlist needs.
- **Impact:** the Queue page builds it (`js/queueview.js`: a grip column,
  a capture-phase pointerdown, a `.mu-drop` marker). Alt+Up / Alt+Down move
  a song from the keyboard.
- **Belongs in:** the kit

### No `repeat-one` or `grip` icon
- **Where:** `lib/icons.js`
- **Impact:** defined in `js/main.js` with `defineIcon`.
- **Belongs in:** the kit

## Not built

- **MPRIS player:** see `../GAPS.md` ("No MPRIS player side").
- **Waveform seek bar:** `bro.media.peaks` reads audio files now; the seek
  bar is still a plain slider.
