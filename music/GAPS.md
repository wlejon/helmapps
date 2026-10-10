# Gaps

Engine, platform and kit gaps found building Music. Each was measured with
`bro-headless`; the app works around none of them beyond saying so in the
window. Gaps every app shares (opening another app by id, notifications,
the MPRIS player side) are in `../GAPS.md`.

## Engine (bro, broaudio)

### No tag reader: every app that shows music must parse ID3/Vorbis itself
- **Where:** bro (`bro.media`)
- **Expected:** `bro.media.tags(path)` → `{ title, artist, album,
  albumArtist, track, disc, year, genre, duration, picture }` for the
  formats broaudio plays, from native code, callable from a worker.
- **Actual:** nothing. `bro.media` has peaks and filmstrips only.
- **Impact:** `js/tags/` is about 800 lines of ID3v2.2–2.4, ID3v1, FLAC,
  Ogg Vorbis/Opus, WAV INFO and MP3 frame parsing in JS (unit tests:
  `test_tags_id3.js`, `test_tags_flac.js`), run on the scan worker.
- **Belongs in:** bro (`bro.media.tags`), probably over broaudio's decoders.

### Opus and M4A/AAC do not play
- **Where:** broaudio (`createStreamFromFile`, `decodeAudioData`)
- **Expected:** `.opus` (and Opus in `.ogg`) and `.m4a` stream like MP3/FLAC.
- **Actual:** `createStreamFromFile` throws "Ogg Opus cannot be disk-streamed"
  for Opus and "unrecognized" for M4A; `decodeAudioData` returns null for both.
- **Impact:** the scan counts and leaves them out ("N files Music cannot play
  (OPUS, M4A) left out" in the sidebar); an `.ogg` holding Opus is told apart
  by its header and left out too. `bro.json` offers mp3/flac/ogg/oga/wav only.
- **Belongs in:** broaudio

### A disk stream has no duration, and a looping one counts on past its end
- **Where:** broaudio (`AudioContext` streams)
- **Expected:** a stream's duration, and a position in the file
  (`getPlaybackPosition` 0..1, `getPlaybackPositionSeconds` wrapping at the end
  of a looping stream).
- **Actual:** no duration call; `getPlaybackPosition` is 0 for streams; with
  `loop: true` `getPlaybackPositionSeconds` keeps counting (1.82 s into a
  0.4 s file after four loops).
- **Impact:** the length comes from the tag parser. Repeat One does not loop
  the stream (the seek bar would run off its end); it opens the song again at
  its end, with a small gap.
- **Belongs in:** broaudio

### `isClipPlaying` stays true after a disk stream finishes
- **Where:** broaudio
- **Expected:** false at the end, as `docs/audio-engine-api.js` says.
- **Actual:** stays true; only `getStreamStats(pb).finished` says it ended.
- **Impact:** the player reads `finished` once a frame.
- **Belongs in:** broaudio

### `bro.media.peaks` returns null for audio-only files
- **Where:** bro (`bro.media`)
- **Expected:** peaks for MP3/FLAC/Ogg/WAV, for a waveform seek bar.
- **Actual:** null for every audio-only file tried (video files work).
- **Impact:** the seek bar is a plain slider.
- **Belongs in:** bro

### Media keys arrive without names
- **Where:** bro (keyboard events from SDL)
- **Expected:** `e.key` `MediaPlayPause` / `MediaTrackNext` /
  `MediaTrackPrevious` / `MediaStop`, as browsers give.
- **Actual:** `e.key` is a number as a string and `e.code` is `Unknown262`,
  `Unknown263`, ... (SDL scancodes 262/263/267/268/269/271).
- **Impact:** the commands are bound to the standard names, so they will work
  when bro names the keys; today the keys do nothing.
- **Belongs in:** bro (SDL scancode → `key`/`code` table)

### `setTimeout(0)` in a worker takes about 500 ms to come back
- **Where:** bro (worker event loop)
- **Expected:** a zero timer runs on the worker's next turn (well under 1 ms
  when the worker is otherwise idle).
- **Actual:** ~500 ms each under `bro-headless`. A scan that yielded every 32
  files spent 27 s of a 28 s scan of 1500 files waiting (`lastScan.waitMs`).
- **Impact:** the scan worker yields (so a newer scan can stop it) once per
  second of work instead; 1500 files now scan in ~1.2 s.
- **Belongs in:** bro

### The worker loader mistakes any line starting with `await` for top-level await
- **Where:** bro (`src/bronze_host/host_worker.cpp`, `hasAwaitStmt`)
- **Expected:** a module worker is compiled as a module, as written.
- **Actual:** if any line's first word is `await` (an ordinary `await x();`
  inside an async function), the whole source is wrapped in
  `(async () => { ... })()`, and the module's imports then fail with
  "an import or export declaration may only appear at the top level of a
  module" (pointing at a line that is fine).
- **Impact:** `js/library-worker.js` has no line that starts with `await`
  (they read `if (due()) await pause();`). A comment there says why.
- **Belongs in:** bro: only wrap classic scripts, and only for real top-level
  `await` (bronze's parser knows).

### `bro.conf` rewrites the whole store on every `set`
- **Where:** bro (`bro.conf`)
- **Expected:** a cheap write, or writes batched off the thread.
- **Actual:** each `set` is synchronous and costs ~1-4 ms, and grows with
  everything else in the store: with a 1500-path queue saved as a setting,
  every `set` (the position, the queue index) took ~7 ms and a skip ~35 ms.
  (`../images/GAPS.md` has the synchronous part.)
- **Impact:** the queue's paths are not a setting: they are `queue.json` in
  `bro.app.dataDir`, written atomically by the scan worker. The brief listed
  the queue among the settings; the place in it (`queueIndex`) and
  `position` are settings.
- **Belongs in:** bro

### A `width: 100%` child adds nothing to a content-sized parent's width, so menus cut labels short
- **Where:** bro / htmlayout (intrinsic sizing)
- **Expected:** as in browsers, a percentage width counts as `auto` when the
  parent's width comes from its content: a `position: fixed` box holding a
  `width: 100%` flex row is as wide as the row's content.
- **Actual:** the row adds 0, and the box falls to its `min-width`. Repro: a
  fixed `div` (`min-width: 50px`) around a flex row of two 100 px spans and the
  text "Play Next" is 258 px wide, but only 50 px once the row has
  `width: 100%`.
- **Impact:** kit menus (`.menu-item { width: 100% }`) never grow past their
  200 px minimum, so "Play Next  Ctrl+Shift+N" shows as "Play N…  Ctrl+Shift+N"
  in Music's song menu. Every app's menus with shortcuts are affected; the
  labels are the brief's, so Music leaves them as they are.
- **Belongs in:** htmlayout (or the kit could drop `width: 100%` on menu items)

### `<img>` decodes synchronously
- **Where:** bro (`HTMLImageElement`), as in `../images/GAPS.md`
- **Impact:** covers are 320 px JPEGs made by the scan worker, and decoded
  `<img>` elements are kept on a shelf (`js/covers.js`) and moved between
  grid cells instead of re-pointed.

### `fs.openSync` / `readSync` / `fstatSync` / `closeSync` are undocumented
- **Where:** bro docs (`docs/brokit-api.js`)
- **Actual:** they exist and work (`readSync(fd, u8, offset, length, position)`)
  but are not listed.
- **Impact:** the tag readers read only the bytes they need through them,
  found by trying.
- **Belongs in:** bro docs

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
- **Waveform seek bar:** needs `bro.media.peaks` for audio (above).
