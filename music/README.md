# Music

Plays the music in your Music folder (and any other folders you add in
Library Folders…). Browse by Songs, Albums, Artists or Folders; double-click
a song to play it with the rest of what you were looking at as the queue;
Play Next and Add to Queue from a song's menu; reorder the Queue by dragging.
The bar along the bottom has the song, the transport (shuffle, previous,
play/pause, next, repeat off/all/one), the seek bar, volume and mute. Music
comes back on the song and position you left, paused.

MP3, FLAC, Ogg Vorbis and WAV play. Opus and M4A do not play in bro, so the
scan counts them and leaves them out (see `GAPS.md`). Tags are read from
ID3v2.2–2.4/ID3v1, FLAC and Ogg Vorbis comments and WAV INFO; an untagged
file takes its artist, album, disc, track and title from an
`Artist/Album/NN Title` layout. Covers are the embedded picture, else a
`cover.jpg` / `folder.jpg` beside the songs.

```bash
bro music                                   # the library
bro music song.flac other.mp3               # play these now
scripts/run_tests.sh music                  # from helmapps/: every test, headless
VERBOSE=1 scripts/run_tests.sh music perf   # the perf numbers
```

How it stays responsive (`../docs/performance.md`):

- The window is built before anything touches the disk. The saved index
  (`library.json` in the cache folder) and the last queue come in on the
  next tick; the library folders are scanned after that.
- The scan runs on a worker (`js/library-worker.js`): it walks the folders,
  compares each file's size and mtime with the index, reads tags only from
  the files that changed (reading just the bytes it needs), shrinks covers
  to 320 px JPEGs and sends records in batches. The window redraws at most
  every 400 ms while it runs. `bro.vfs.watch` rescans when files change.
- Only the list on screen is in the document; album covers are decoded once
  and moved between grid cells.
- Settings are written only when a value changes; the queue (which can be
  thousands of paths) is a file the worker writes, not a setting.

| Keys | |
|---|---|
| Space | Play / pause (when not typing) |
| Mod+Right / Mod+Left | Next / previous (previous restarts a song more than 3 s in) |
| Shift+Right / Shift+Left | Forward / back 10 seconds |
| Mod+S | Shuffle |
| Mod+R | Repeat: off, the queue, one song |
| Mod+M | Mute |
| Mod+Up / Mod+Down | Volume |
| Mod+1 … Mod+5 | Songs, Albums, Artists, Folders, Queue |
| Enter, double-click | Play the song with the rest of the view; open an album, artist or folder |
| Alt+Left, Backspace | Back |
| Mod+F / Escape | Search the view / clear the search |
| Mod+Shift+N | Play Next |
| Mod+Shift+A | Add to Queue |
| Delete | Remove from the queue (Queue page) |
| Alt+Up / Alt+Down | Move a song up / down the queue |
| Mod+Shift+R | Scan the library again |
| Mod+, | Library folders |
| Mod+Q | Quit |

The media keys work too: `MediaPlayPause`, `MediaTrackNext`,
`MediaTrackPrevious` and `MediaStop`.

Settings: `folders` (null = the Music folder), `volume`, `muted`, `shuffle`,
`repeat`, `view`, `queueIndex`, `position`, `columns` (list column widths).
The queue itself is `queue.json` in the app's data folder.

## Files

| File | |
|---|---|
| `js/main.js` | The window, commands, sidebar, navigation, what is saved and resumed |
| `js/library.js` | The library on the page: records from the worker, albums/artists/folders views, watching |
| `js/library-worker.js` | The scan thread: walk, compare, read tags, make covers, save the index |
| `js/tags/` | Tag readers: `id3.js`, `mp3.js`, `flac.js`, `ogg.js`, `vorbis.js`, `wav.js`, `index.js` (sniffing, layout fallback) |
| `js/records.js` | A song record from a file's tags, sort keys, formats |
| `js/queue.js` | The queue: order, shuffle, repeat, Play Next / Add, move, remove |
| `js/player.js` | Playback over broaudio disk streams: transport, seek, volume, the end of a song |
| `js/views.js` | The lists: songs, album grid, artists, folders, album and artist pages, the head |
| `js/queueview.js` | The Queue page, with drag to reorder |
| `js/nowplaying.js` | The bar along the bottom |
| `js/covers.js` | Decoded covers, kept and moved between cells |
| `js/prefs.js` | Library folders: the setting and its dialog |
| `css/app.css` | Covers, the head, the bar; all else is the kit |
| `tests/fixtures.js` | Test music made in memory (WAV, FLAC, ID3 tags) |
| `tests/` | Headless acceptance tests and `test_perf.js`; `resume_check.js` is run by `test_resume.js` in a second process |
