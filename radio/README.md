# Radio (`helm.radio`)

Endless generated instrumental music that you steer with a genre, a few
instruments and a mood.

YuE2-3B makes the music on the GPU, 10 s at a time (`yue.endless`, bro's
`docs/music-endless-api.js`). Every chunk is written from a style prompt
built from what you picked: `jazz, piano, upright bass, calm, instrumental`.
CLAP listens to each chunk as it plays and says what it sounds like.

The weights are CC BY-NC 4.0: personal use only.

## The screen

- **Genres** (sidebar), grouped acoustic / band / electronic. The playing
  genre carries a dot. Under them, that genre's **instruments**: one to
  three of them are in the prompt.
- **The mood plane.** Up is more intense, down more relaxed; right is
  brighter, left darker. Each mood word owns the region nearest it.
  - The ring is you; drag it or click anywhere.
  - The knobs (energy, density, timbre) follow the ring at once.
  - The mood word changes only when you settle in another region (or let
    go), so a drag along a border does not flap.
  - Click a word to go to it.
  - The dot is where the playing music was made. The dashed line joins
    it to the ring while your change is still on its way, and the faint
    trail is where the music has been.
- **The timeline**: one card per 10 s chunk, oldest left. Each card shows
  its style and its step:
  - *played*, with CLAP's verdict ("sounds like calm jazz ✓");
  - *now*, with a progress bar;
  - *ready*;
  - *rendering*;
  - *writing* (YuE2 is sampling it);
  - *planned*, with when it will be heard.

  A card that starts a new style is marked, and says how it changes:
  a clean change, or bridged on the beat.
- **The strip**: play, somewhere else, what is playing, what comes next
  and in how long, **Drums** (the percussion knob), **Drift** (it wanders
  on its own: a step on the plane every 30 s, another genre of the same
  family every 4 minutes).
- **Go to a sound…**: type a phrase; CLAP picks the genre and mood
  nearest it.

A change is heard at the next chunk that is not written yet, 6–16 s
away; the timeline shows exactly which one. The style, your place, the
drums and drift are kept between runs. The radio starts paused.

| Keys | Command |
|---|---|
| Space | Play / Pause |
| Mod+→ | Somewhere else (another family, another mood) |
| Mod+D | Drift |
| Mod+, | Models… |

## Models

The radio needs YuE2-3B, the YuE2 VAE and CLAP. When one is missing the
start screen lists all three:

- **Download** fetches it with `bro.models` from the `wlejon/brosoundml-data`
  dataset (`yue2/YuE2-3B`, `yue2/vae`, `clap`; about 8.6 GB together), with
  progress and Cancel. **Download Missing** gets them all and loads.
- The folder icon picks a folder you already have (a folder without that
  model's files is refused, saying why). × goes back to the default.

A model not chosen is looked for by name with `bro.models` (also the old
local names `YuE2-3B`, `yue2-vae`) in bro's models directories
(`BRO_MODELS`, the `models.dirs` setting, `<bro user data>/models`).
**Models…** (Mod+,) opens the same panel at any time, with the AR decode
weights (int8, fp8, bf16); **Load** stops the music, frees the models in
use and loads the chosen ones. Without an ML build of bro the radio says it
cannot run.

## Tests

```bash
scripts/run_tests.sh radio          # UI, models and perf on a fake backend; the GPU smoke skips without models
BRO_MODELS="D:/projects;D:/projects/brosoundml/weights" scripts/run_tests.sh radio smoke
```

The GPU smoke plays 60 s from calm jazz to aggressive metal, checks the
audio is contiguous, and that CLAP hears more metal in the chunks after
the change than before it.
