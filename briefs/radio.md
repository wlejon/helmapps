# Brief: Radio (design, first pass)

| | |
|---|---|
| Folder | `helmapps/radio/` |
| id | `helm.radio` |
| Replaces | nothing: there is no desktop app like it |
| Size | app about 3500 lines; the bro work it needs has landed (below) |
| Permissions | none (reads the Music folder like `helm.music`) |
| Status | **second version running** (`radio/`): genre + instruments + a mood plane (valence × arousal, knobs follow at once, mood with hysteresis), a timeline of chunks with each step and CLAP's verdict, go-to-a-sound, drift, in-app model download / choice, resume. The CLAP-placed atlas of v1 was dropped (the text/audio modality gap scattered the trail). Not yet: previews, hold the beat, Keep this, places, library rings, branches |

## What it is

An endless stream of generated instrumental music that you steer by
moving through a map, not by picking labels. There are no songs, no
genres, no tracks and no lyrics. You are a point on an atlas of sound.
The music is wherever you are, and it follows you, in 10 s chunks, when
you move. A trail shows where you have been, and a path ahead shows where
you are going. Optionally a score holds one tempo and key the whole time,
so the beat carries on while the sound changes around it.

YuE2-3B makes everything in it, on device. The weights are CC BY-NC 4.0,
so the app is for personal use and cannot sell anything it makes. The
About box says so.

## What the research gives us

Everything here was measured in `../yue2-research/FINDINGS.md` (sections
7–10, chiefly) on a 4090. These are the only things the design leans on.

| Capability | Measured | Where it lives |
|---|---|---|
| Endless stream of 10 s chunks | Seamless joins (flux z ≈ 0), never ends with 5–40 s of memory, 27–30% of the GPU; paced, no service gap of 0.2 s | `yue.endless` (`docs/music-endless-api.js`), byte-identical to the research harness |
| Style change without a score | Memory dropped to 0.5 s at the change: new style heard in 78% of its chunks, every change reached, no extra cost | `yue.endless` (`changeMode: 'auto'`) |
| Style change under a score | Bridge (a fresh clip plus a spliced transition): 84% of changes reached within 40 s, about 5 s of GPU per change | `yue.endless` (`changeMode: 'auto'` with a score) |
| Beat kept across a change | Under a score the tempo is exact (`Q:1/4=90` holds at 90.0). Cutting the fresh clip at the beat read from the bridge's own render puts 95% of joins within a quarter beat (plain bridge: 38%), about 1 s per bridge | `yue.endless` (measured bridge); the sensor is `bro.music.beat` |
| Continuous knobs | energy (latent offset, instant), texture, percussion (NAR), arrangement, density, timbre (AR), each clamped below where the music broke | `yue.endless` `setKnobs` / targets |
| Timed paths and branches | Targets queued at chunk times; alternatives built ahead and committed or dropped at a boundary (2.7 s seamless, 4.5–8.5 s with a crossfade) | `yue.endless` `setPath`, `branch` / `commitBranch` / `discardBranch` |
| Where a sound is | CLAP embeds 10 s in about 50 ms. A stream's chunks are labelled correctly against style references 91–100% of the time | `bro.ear.loadClap` (`embedAudio`, `embedText`) |
| Stems | htdemucs_ft: a 10 s chunk in 78 ms (vocals) or 297 ms (all four) | `bro.music.loadSeparator` (`docs/music-separate-api.js`) |
| Tempo | Only the score's `Q:` sets it. Style text "N bpm" is not held without a score | |

What does **not** exist and is not promised:
- YuE2 cannot be told "go to this CLAP point". It is conditioned on style
  text, a score and the steer knobs. The atlas therefore maps *prompts
  that were measured* (see below), and moving means choosing among them
  plus the knobs.
- No lyrics. A rolling lyric window was built and measured (FINDINGS
  10–12): following it from inside the model reads right but the stream
  drifts off the sheet and stays there, and the only way through was a
  timer. The radio is instrumental.
- No stems from the model itself. Stems come only from separation.
- Nothing has been measured on halo (AMD, Vulkan). Every number is a 4090
  under CUDA.

## The idea in one picture

```
┌───────────────────────────────────────────────────────────────────┐
│  ·   ·      ·  ·        ·      ◦ library             [axes ▾] [⌕] │
│     ·    ·      · ·  ·      ◦     ◦                                │
│  ·     ●━━━━━━━━━━━━━━━●━━━━━━◉ - - - - ○ - - - - ○                │
│     trail (chunks flown,     you  path ahead (built ○ / planned ◌) │
│      each at its CLAP spot)                                        │
│   ·      ·    ·     ◦      ·    ·   ·       ·    ·     ·          │
├───────────────────────────────────────────────────────────────────┤
│ ▮▮▯▯ beat   ~~~~~~~~~~~~~~~ waveform ~~~~~~~~~~~~~~~~~~~      ⏸ ⏭ │
│ [hold the beat ◼ 90]   energy ━━●━━  density ━●━━━  timbre ━━━●━  │
└───────────────────────────────────────────────────────────────────┘
```

Dots (`·`) are measured places: a style prompt rendered once and embedded
by CLAP. Rings (`◦`) are the user's own music, embedded the same way: real
sound, landed in the same space, as the kokoro and qwen-tts labs placed
real voices. The listener (`◉`) has a trail of the chunks actually played,
each placed by its own CLAP embedding (where the music really went, not
where it was asked to go), and a path ahead. No dot carries a word.
Hovering a dot plays its stored 10 s preview at once.

## How moving works

**The atlas.** A set of *anchors*. Each anchor is an instrumental style
prompt (built internally from a large vocabulary of genre,
instrumentation and mood; the prompt text is never the UI), its fresh
10 s render, and that render's CLAP vector. With a score held, a second
set of vectors comes from scored renders, because under a score the
styles land closer together (FINDINGS 8). The map is a 2D projection of
the vectors, with the axes chosen by the listener (the kokoro lab's axis
picker):

- the first two principal components (the default);
- a CLAP text axis, the direction between two phrases ("calm" to
  "intense", "acoustic" to "electronic", anything typed);
- a model axis: the energy, density or timbre steer, measured by
  rendering an anchor at ±1 and taking the CLAP difference.

The search box (`⌕`) embeds typed text with CLAP and flies to where it
lands ("rain on a tin roof", "a sad waltz"). That is a place, not a tag.

**A position becomes a stream target** as:
- the **style** of the nearest anchor, with hysteresis: the target changes
  only when another anchor is clearly nearer, so a drag never flaps;
- **knobs** from the position inside that anchor's neighbourhood, along
  the projected model axes. They are continuous and cost nothing at a
  chunk boundary;
- energy also applies **at once**, as a latent offset at decode (0.05 s),
  so a drag is felt before the next chunk exists.

A move to a new anchor is a **style change**, made as the research says:
- with no score held: the 0.5 s memory drop, at no extra cost;
- with a score held: the measured-phase bridge (the fresh clip cut at the
  beat), about 5 s of GPU, which needs that much lead.

**Latency, honestly.** A change is heard at the first chunk boundary that
is not built yet. The stream says where that is (`stats.openChunk` /
`openSample`, confirmed by its `planned` event). Measured: a drop change
is heard 10–15 s after it is asked for, a bridge 10–20 s. The energy
offset is instant. Three things make dragging feel live:
1. **Trajectories.** Drawing a path ahead (drag from the listener, or
   click a destination) lets the stream build along it, on time, with
   nothing to wait for. This is the main way to steer.
2. **Branches.** At 30% of the GPU per stream, two branches can be built
   ahead toward where the cursor is heading. If the drag ends near one, it
   is committed at a chunk boundary (2.7 s when seamless); otherwise it is
   dropped.
3. Shorter chunks (5 s) would halve the wait. Not measured yet (below).

**Holding the beat** (a toggle with a tempo) puts one score into every
chunk's prefix. The tempo is then exact across every style, and bridges
cut at the beat. The score is built once (`yue.plan`) from the tempo and
the instrumental structure, and is re-planned only when the tempo
changes. Off, each style keeps its own tempo, and the drop is the change.

## Later: pads

A grid of pads, each a short saved path through the atlas (record a
flight, save it to a pad). Pressing a pad queues its path at the next bar,
on the held beat. Pressed ahead of time it is built ahead, so it lands on
time. This needs the bar position (which beat of the bar the stream is
on), which has not been measured; only beats have.

## What bro grew for it

App capabilities go into bro, never into the app, so all of the
streaming lives in brosoundml and `bro.music`. The app only decides where
to go. All of this has landed:

| Work | Where | API |
|---|---|---|
| Endless chunk stream: 10 s chunks by `splice`, memory, NAR windows, just-in-time decode, playhead and emit lead, pacing and gap stats | brosoundml `Yue2Endless` | `yue.endless(opts)` |
| Targets and timed paths; style change by drop or measured bridge; a held score | brosoundml | `setTarget`, `setPath`, `setScore`, `setKnobs` |
| Branches built ahead, committed or dropped at a boundary | brosoundml | `branch`, `commitBranch`, `discardBranch` |
| The spectral/energy-flux beat sensor | brosoundml, bro | `bro.music.beat`, `bro.ear.beat` |
| htdemucs_ft separation | brosoundml (+ brotensor STFT, conv, attention kernels) | `bro.music.loadSeparator` |
| Docs and tests | bro | `docs/music-endless-api.js`, `docs/music-separate-api.js`, `tests/music/` |

## Must have (app, first version)

1. **Atlas** canvas: the anchors, the library rings, the listener, the
   trail and the path ahead. Pan and zoom, and the axes picker. Hovering a
   dot plays its preview through a second output that ducks the stream.
2. **Atlas building**: ship the anchor list (prompts plus CLAP vectors,
   unscored and under the default score) so the map draws at first start.
   Previews render in the background on first run (about 3 s each, a few
   hundred anchors, about 15 minutes of GPU once), cached in
   `bro.app.cacheDir`. The library is scanned in a Worker: 10 s from the
   middle of each track, decoded and embedded, incremental like
   `helm.music`.
3. **Flying**: click to set a destination, drag to draw a path, or drag
   the listener itself. The path shows built (solid) and planned (dashed)
   chunks.
4. **Now strip**: play/pause, skip (a jump to a random far anchor), a beat
   light, a waveform or visualizer (the lab's `radio_visual.js` is the
   starting point), and the energy, density and timbre knobs, which move
   with the listener and can be set by hand.
5. **Hold the beat**: a toggle with a tempo.
6. **Places**: pin the current spot (anchor, knobs, score), shown as a
   star on the map, with fly-to.
7. **Keep this**: save the last 1–10 minutes as FLAC or WAV (the
   recorder's WAV codec).
8. **Resume**: start where the last session ended (paused), trail
   included.
9. **No model**: if `bro.music` is unavailable or the weights are missing,
   the app says so and offers `bro.models.fetch`. It never pretends.

## Not in this pass

Pads (above), MPRIS (the same gap as `helm.music`), sharing, and any
cloud service.

## Open questions to answer before dispatch

Each is a short yue2-research experiment, not a design question:

1. **By ear**: is a residual 0.2-beat join audible? Listen to
   `runs/exp7/stour_m250_phasespec_s*` against `stour_m250_bridge_s*`.
2. **Do anchors spread?** Render 200 instrumental prompts and check that
   CLAP places them apart, and whether a prompt's renders (seeds) stay
   together. If the cloud collapses, the atlas needs fewer, stronger
   anchors.
3. **5 s chunks**: seams, cost and style hold at half the length. This
   decides the drag latency.
4. **Other scores**: the beat fix is measured on the folk score only.
5. **halo**: chunk cost and VRAM under Vulkan on AMD. If one stream does
   not fit in about 30% of halo's GPU, branches go first.
6. **Drop plus trimmed bridge** combined under a score, which might move
   further than either.
7. **Instrumental hold**: do instrumental streams stay wordless over
   minutes, or does a style with a voice in it start singing? FINDINGS 9
   found instrumental streams' vocal stems wordless; check over the
   anchor vocabulary.

## Acceptance tests (for when it is dispatched)

With a fake stream (a stub of `yue.endless` that emits silent chunks and
events on virtual time) for UI tests, and one real smoke test on the GPU:

1. The atlas draws the shipped anchors and the library rings. Changing the
   axes re-projects them.
2. A path of three points makes three timed targets on the stream, in
   order, at the right chunk boundaries.
3. Dragging within an anchor's neighbourhood changes knobs only. Crossing
   into another's makes one style change (hysteresis: a drag back and
   forth across the line makes at most one).
4. Each played chunk adds a trail point at its CLAP position.
5. Hold the beat on makes every target carry the score, and style changes
   use the bridge.
6. Keep this writes a valid WAV of the requested length.
7. Resume restores the position, trail and toggles.
8. Smoke (GPU): 60 s of stream with one style change, audio contiguous,
   the change heard (CLAP nearer the new anchor's preview than the old).
