# App briefs

One brief per app, one agent per brief, one folder per app. Each brief says
what to build, which docs to read, what "missing API" behaviour is
expected, and the acceptance tests that define done. Every agent first
reads [`../AGENTS.md`](../AGENTS.md).

## Wave 1: the APIs exist

| Brief | Folder | id | Size | Notes |
|---|---|---|---|---|
| [files.md](files.md) | `files/` | `helm.files` | ~4000 | The biggest and most important. Everything else links to it. |
| [images.md](images.md) | `images/` | `helm.images` | ~2000 | |
| [texteditor.md](texteditor.md) | `texteditor/` | `helm.texteditor` | ~2500 | Built on `<textarea>`, no syntax highlighting |
| [music.md](music.md) | `music/` | `helm.music` | ~3000 | Parses tags in JS; no MPRIS server yet |
| [monitor.md](monitor.md) | `monitor/` | `helm.monitor` | ~2500 | Linux `/proc`; Windows degrades |
| [screenshot.md](screenshot.md) | `screenshot/` | `helm.screenshot` | ~2000 | Needs the `wl` permission |
| [calculator.md](calculator.md) | `calculator/` | `helm.calculator` | ~1500 | No platform APIs, a good first run |
| [clock.md](clock.md) | `clock/` | `helm.clock` | ~2000 | Alarms only while open |
| (done) | `diskusage/` | `helm.diskusage` | ~600 | The reference app |

Sizes are lines of app code plus tests, roughly what one agent produces in
one pass.

## Wave 2: blocked on bro, so not briefed yet

| App | Blocked on |
|---|---|
| Document viewer (PDF) | No PDF renderer in the stack |
| Video player | `<video>` plays WebM/VP9 only, and brovideo decodes on Windows only |
| Mail | brokit has no TLS client socket (fetch does HTTPS only) |
| Archive manager | Not blocked for zip and tar(.gz): `DecompressionStream('deflate-raw')` and `'gzip'` exist, and the containers are parsed in JS. 7z/rar/xz are blocked. A good Wave 1b brief. |
| App Center | No JS API for `bro --install` / `--uninstall` / `--list-apps` (the CLI exists) |
| Log viewer | No journald API, and shelling out to `journalctl` is not allowed |
| Passwords and keys | `bro.cred` Secret Service is privileged and its API needs a review for an app UI |
| Fonts | No font-enumeration API |

## Wave 3: things only bro can do

On-device AI built into the desktop, once Wave 1 has settled the kit:
system-wide dictation (`bro.stt`), a local assistant (`bro.lm`), voice
commands (`bro.kws`, `bro.wake`), and photo search and tagging
(`bro.vision`). The workshop labs in `../broworkshop/demos/` are the
starting points.

## Dispatching an agent

Give each agent this prompt, with the brief's name filled in. It assumes
the agent works in a checkout where `helmapps/` sits beside `bro/` (and
bro is built). Nothing in it is specific to any agent tool.

```
You are building one app of the helm desktop, in the helmapps repository.

1. Read helmapps/AGENTS.md completely. It explains what bro is (a native
   app runtime: these apps are NOT websites), the rules, and how to test.
2. Read helmapps/lib/README.md and the whole reference app helmapps/diskusage/.
3. Your brief is helmapps/briefs/<BRIEF>.md. Build exactly that, in
   helmapps/<FOLDER>/ and nowhere else.
4. Read every bro doc your brief lists before using the APIs it describes.
5. When bro or the kit cannot do something, write it in <FOLDER>/GAPS.md
   and carry on. Never work around the engine.
6. You are done when every item in AGENTS.md's "Done means" checklist holds
   and scripts/run_tests.sh <FOLDER> passes.
```

## After an agent finishes

1. Run `scripts/run_tests.sh <folder>` yourself, then look at the app
   windowed (and on halo under helm).
2. Read its `GAPS.md`. Engine gaps go to the bro/brokit/sibling backlog,
   and kit gaps (`Belongs in: kit`) are lifted into `lib/` by one owner,
   after which the app is moved onto the kit version.
3. Check the rules were followed: no hex colours in the app CSS
   (`grep -nE "#[0-9a-fA-F]{3,8}\b|rgb\(" <folder>/css`), no `alert(` /
   `confirm(` / `prompt(` / `localStorage`, no `child_process` used to
   stand in for a bro API, and nothing edited outside its folder.
