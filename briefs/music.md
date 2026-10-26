# Brief: Music

| | |
|---|---|
| Folder | `helmapps/music/` |
| id | `helm.music` |
| Replaces | Elisa, Rhythmbox, Lollypop |
| Size | about 3000 lines |
| Permissions | `["files", "spawn"]`: the Music folder, showing a song in Files |

## What it is

A music player for the files in the user's Music folder. It builds a
library from the folder, browses by artist, album, folder and song, and
plays with a queue, shuffle and repeat. It keeps playing while you browse.

## Read first

- `../AGENTS.md`, `../lib/README.md`, `../diskusage/`
- `../bro/docs/audio-api.js`: `AudioContext`, `decodeAudioData` (WAV, FLAC, MP3 and Ogg decode), `AudioBufferSourceNode`, gain
- `../bro/docs/audio-engine-api.js`: clips, playbacks and **streams**. Prefer streaming playback for long files if the engine offers it; decoding a 60-minute FLAC into one buffer costs about 1.2 GB.
- `../bro/docs/video-api.js`: `bro.media.peaks` (a waveform for the seek bar, optional)
- `../bro/docs/vfs-api.js`: `watch` for library updates
- `../bro/docs/worker-api.js`: scan and parse tags in a Worker so the UI never stalls

## Must have

1. **Library.** On first run, scan `userDirs().music` (and any folders
   added in Settings) for audio files: mp3, flac, ogg, oga, opus, wav and
   m4a, keeping only the formats bro decodes (test it, and file the rest).
   Store the index as JSON in `bro.app.cacheDir`, so later starts are
   instant. Rescan incrementally on change (`bro.vfs.watch`), comparing
   mtime and size.
2. **Tags.** bro has **no tag-reading API**. Read the common tag formats in
   JS from the file bytes: ID3v2.3/2.4 (TIT2, TPE1, TALB, TRCK, TPOS, TYER
   or TDRC, APIC), FLAC Vorbis comments plus PICTURE, and Ogg Vorbis/Opus
   comments. This is file-format parsing, which is the app's job (a
   `js/tags/` module with its own unit tests). Fall back to
   `Artist/Album/NN Title.ext` from the folder layout. File a GAPS entry
   suggesting `bro.media.tags()` anyway. Cover art: embedded pictures, else
   `cover.jpg`/`folder.jpg` in the album folder.
3. **Browse.** Sidebar: Songs, Albums, Artists, Folders, Queue. Albums as a
   grid of covers (`VirtualList` grid), and Songs as a sortable list
   (Title, Artist, Album, Length, Track). An album page lists its tracks in
   disc/track order. Search (Mod+F) filters the current view.
4. **Playback.** Play, pause, next and previous (previous restarts the song
   if more than 3 s in), a seek bar, volume and mute, shuffle, and repeat
   (off, all, one). Gapless is nice but not required. Playback continues
   across navigation.
5. **Queue.** Double-clicking a song plays it with the rest of its view as
   the queue. "Play Next" and "Add to Queue" are in the context menu. The
   Queue page lists the queue, reorderable by drag (build it in-app and
   file a kit gap), with Remove.
6. **Now playing bar** along the bottom: cover, title and artist, the
   controls, the seek bar with elapsed and remaining time, and volume.
7. **Media keys.** XF86AudioPlay/Next/Prev if bro delivers them as key
   events. Space toggles play when not typing.
8. **Helm's now-playing card.** helm reads players over MPRIS
   (`bro.mpris` is a *controller*). bro has no way for an app to *be* an
   MPRIS player yet, so file the gap (Belongs in: bro). Meanwhile helm will
   not show this app; that is accepted.
9. **Resume** the last queue, song and position on start (paused).

## Settings

`folders` (json list), `volume`, `shuffle`, `repeat`, `view`, `queue`
(json), `position`.

## Acceptance tests

Make fixture audio by encoding short WAV files in the test (write a 44-byte
WAV header plus a few hundred ms of PCM, or render a SynthGraph offline),
and build tag fixtures as byte arrays: an ID3v2.4 header with frames, and a
FLAC with a VORBIS_COMMENT block.

1. The ID3v2.4 parser reads title, artist, album and track from a
   handcrafted tag, including UTF-16 text frames.
2. The FLAC Vorbis-comment parser reads the same fields.
3. Scanning a fixture music folder builds artists, albums and songs, with a
   folder-layout fallback for untagged files.
4. A second scan with one file changed reparses only that file (count the
   parses).
5. Playing a song sets the now-playing title. Next and Previous follow the
   queue, and repeat-one stays on the song at its end (advance virtual
   time).
6. Shuffle plays every queued song once before repeating.
7. Play Next inserts after the current song, and Add to Queue appends.
8. Resume restores queue and song after a restart.

## Not in this pass

Playlists files (m3u), internet radio, lyrics, an equalizer, CD ripping,
MPRIS server (blocked on bro), editing tags.
