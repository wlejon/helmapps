# Radio (`helm.radio`)

Endless generated instrumental music, steered by moving through a map of
sound. Design: [`../briefs/radio.md`](../briefs/radio.md).

YuE2-3B makes the music on the GPU, 10 s at a time (`yue.endless`, bro's
`docs/music-endless-api.js`). The map is an atlas of 120 anchors, each an
instrumental style prompt, placed by CLAP. You are the ring. The trail
behind you is where the music really went: each played chunk placed by
CLAP from its own audio.

The weights are CC BY-NC 4.0: personal use only.

## Using it

- **Click** the map: go there now. The strip says when it is heard (a
  style change lands at the next chunk that is not built yet, 6–16 s).
- **Shift+click**: add a point to the path ahead; the stream builds along
  it, one point every 20 s, on time.
- **Drag the ring**: wander. The style changes only when another anchor
  clearly owns the spot, so a drag along a border does not flap.
- **Fly to a sound…**: type a phrase; CLAP places it and you go there.
- **Energy / Density / Timbre**: the stream's steer knobs.
- **Axes**: principal components, or CLAP text axes (calm–intense ·
  dark–bright, acoustic–electronic · sparse–full).

Where you are, the knobs and the trail are kept between runs. The radio
starts paused.

| Keys | Command |
|---|---|
| Space | Play / Pause |
| Mod+→ | Skip far away |
| Escape | Clear the path ahead |
| Mod+0 | Fit the map |

## Models

Found by name with `bro.models`: `YuE2-3B`, `yue2-vae` and `clap`. Put the
folders in bro's models directory (`<bro user data>/models`), or point bro
at where they are with `BRO_MODELS` (or the `models.dirs` setting):

```bash
BRO_MODELS="D:/projects;D:/projects/brosoundml/weights" bro radio
```

Without them (or without an ML build of bro) the radio says what is
missing and where it looked.

## Tests

```bash
scripts/run_tests.sh radio          # UI + perf on a fake backend; the GPU smoke skips without models
BRO_MODELS="D:/projects;D:/projects/brosoundml/weights" scripts/run_tests.sh radio smoke
```

The GPU smoke plays 60 s with one far style change and checks the audio is
contiguous and that CLAP hears the music move toward the new place.
