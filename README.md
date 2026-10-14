# helmapps

The core apps of the helm desktop, one folder per app. Each is a bro folder
app: a `bro.json` manifest plus HTML, CSS and JavaScript, run by the stock
`bro` binary. No app here has native code, a build step or pinned
dependencies; a native capability an app needs goes into bro (or a sibling
library exposed as `bro.<x>`), never into the app.

| App | id | What |
|-----|----|------|
| [term](term/) | `helm.term` | Terminal: tabs, splits, profiles and shell integration over bro's `<terminal>` element |
| [remote](remote/) | `helm.remote` | Remote desktop viewer: a helm session over broremote, shown in bro's `<remoteview>` (hardware decode, zero-copy on Windows), with keyboard and pointer capture and audio both ways |
| [diskusage](diskusage/) | `helm.diskusage` | Disk usage analyzer, and the kit's reference app |
| [files](files/) | `helm.files` | File manager with dual-pane browsing, tabs, search (`bro.search`), undo/redo journal, and XDG trash (`bro.vfs`) |
| [texteditor](texteditor/) | `helm.texteditor` | Multi-tab plain-text and code editor with line numbers, regex find/replace, and atomic session recovery |
| [images](images/) | `helm.images` | Image viewer and organizer with gallery, burst stabilization and wildlife tagging |
| [music](music/) | `helm.music` | Music library and player with tag scanner, album grid, queue and lyrics |
| [monitor](monitor/) | `helm.monitor` | System monitor: live processes (`/proc` and `bro.sys.processes`), CPU/memory/I/O/GPU performance graphs, and file systems |
| [disks](disks/) | `helm.disks` | Disks and volumes utility: physical drive topology, visual partition layout map, live disk I/O rates, and volume inspection |
| [logs](logs/) | `helm.logs` | System and application log viewer: desktop/app/system logs, JSONL & syslog parser, regex search, and live tailing |
| [archives](archives/) | `helm.archives` | Archive manager: inspect, extract, and create `.zip`, `.tar`, and `.tar.gz` archives |
| [recorder](recorder/) | `helm.recorder` | Voice and audio recorder with live waveform/spectrum meter, markers, non-destructive trim, and WAV export |
| [screenshot](screenshot/) | `helm.screenshot` | Screen and region capture (`bro.wl.captureOutput`), non-destructive annotations and export |
| [calculator](calculator/) | `helm.calculator` | Basic, scientific and programmer calculator with persistent history tape |
| [clock](clock/) | `helm.clock` | World clocks, countdown timers, high-precision stopwatch and alarms |
| [charmap](charmap/) | `helm.charmap` | Unicode character map and symbol browser with UTF-8/UTF-16/HTML/CSS/JS encoding inspector |
| [colorpicker](colorpicker/) | `helm.colorpicker` | Oklch/Oklab/sRGB color picker, palette manager, and WCAG 2.1 + APCA contrast checker |

## Building an app

[AGENTS.md](AGENTS.md) is the guide for anyone (person or agent) building a
helm app: what bro is, the rules, the anatomy of an app, testing, and how
engine gaps are reported. Apps share the **helm app kit** in
[lib/](lib/README.md): helm's look as design tokens and controls, plus
the window layout, virtual lists, menus, dialogs, settings, commands and
test helpers. bro mounts it at `/lib` because the root `bro.json` makes
this folder a project, and `bro --install` bundles it into the installed
copy. The apps still to build are in [briefs/](briefs/README.md), and the
gaps found so far are in [GAPS.md](GAPS.md).

## Running

```bash
bro term                     # from this directory
bro term -- htop             # arguments after the folder go to the app
bro --install term --link    # install it (Linux: also writes helm.term.desktop)
bro helm.term                # run an installed app by its id
```

The manifest keys (`id`, `singleInstance`, `actions`, `fileTypes`,
`permissions`, ...), the per-app directories, the install roots and the
generated `.desktop` entry are described in bro's
[docs/apps.md](https://github.com/wlejon/bro/blob/main/docs/apps.md);
the runtime side is `bro.app` ([docs/app-api.js](https://github.com/wlejon/bro/blob/main/docs/app-api.js)).

## Tests

```bash
scripts/run_tests.sh           # every app
scripts/run_tests.sh term      # one app
scripts/run_tests.sh term tabs # tests whose name contains "tabs"
```

Each `<app>/tests/test_*.js` runs under `bro-headless` (`BRO_HEADLESS`, else
`../bro`'s build tree) with its own `BRO_APP_HOME`, so the tests never touch
your settings. The terminal's tests drive a test child: bro's `bro_pty_child`
copied as `term-testchild`, the name that selects its reporting mode
(`BRO_TERM_TESTCHILD` overrides). Exit status 77 is a skip.
