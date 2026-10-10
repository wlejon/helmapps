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
- **Waveform seek bar:** needs `bro.media.peaks` for audio (above).
