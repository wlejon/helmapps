# helmapps

The core apps of the helm desktop, one folder per app. Each is a bro folder
app: a `bro.json` manifest plus HTML, CSS and JavaScript, run by the stock
`bro` binary. No app here has native code, a build step or pinned
dependencies; a native capability an app needs goes into bro (or a sibling
library exposed as `bro.<x>`), never into the app.

| App | id | What |
|-----|----|------|
| [helmterm](helmterm/) | `helm.term` | Terminal: tabs, splits, profiles and shell integration over bro's `<terminal>` element |

## Running

```bash
bro helmterm                     # from this directory
bro helmterm -- htop             # arguments after the folder go to the app
bro --install helmterm --link    # install it (Linux: also writes helm.term.desktop)
bro helm.term                    # run an installed app by its id
```

The manifest keys (`id`, `singleInstance`, `actions`, `fileTypes`,
`permissions`, ...), the per-app directories, the install roots and the
generated `.desktop` entry are described in bro's
[docs/apps.md](https://github.com/wlejon/bro/blob/main/docs/apps.md);
the runtime side is `bro.app` ([docs/app-api.js](https://github.com/wlejon/bro/blob/main/docs/app-api.js)).

## Tests

```bash
scripts/run_tests.sh               # every app
scripts/run_tests.sh helmterm      # one app
scripts/run_tests.sh helmterm tabs # tests whose name contains "tabs"
```

Each `<app>/tests/test_*.js` runs under `bro-headless` (`BRO_HEADLESS`, else
`../bro`'s build tree) with its own `BRO_APP_HOME`, so the tests never touch
your settings. helmterm's tests drive a test child: bro's `bro_pty_child`
copied as `helmterm-testchild`, the name that selects its reporting mode
(`HELMTERM_TESTCHILD` overrides). Exit status 77 is a skip.
