# Fast and responsive: how to build it, how to check it

A helm app must show its window quickly and must never stop answering the
user, whatever it is doing: scanning a drive, loading a 10 000-row folder,
waiting on a sleeping disk. This guide gives the rules and the
**headless-only** way to measure them. `diskusage/` follows every rule here,
and its `tests/test_perf.js` is the model for your own perf test.

## Why a window freezes

bro runs your page's JavaScript, its timers and `requestAnimationFrame`
callbacks, style, layout and paint **on one thread**, one frame at a time.
While a function runs, nothing else happens: no input, no repaint. A
200 ms function is a window that ignores the user for 200 ms. A loop over a
million files is a window the OS marks "Not Responding".

So there are two numbers to keep small:

| What | Budget | Measured by |
|---|---|---|
| Time to the first frame | the app's own share under 100 ms | `bro.app.startup` |
| The worst frame during the app's heaviest work | under 50 ms in a test, under 16.7 ms typically | `measureFrames()` |

## Never launch the windowed app to check this

Everything below runs in **bro-headless**: the same engine, layout, GPU
pipeline and frame loop, with no window. Do not start `bro <app>` to time or
try things. A windowed run measures nothing you can read back, and with a
single-instance app it may not even start: it hands its arguments to an
instance that is already running.

```bash
# from helmapps/
../bro/build/Release/bro-headless.exe myapp -e "0"            # boots cleanly? (Linux: ../bro/build-release/bro-headless)
scripts/run_tests.sh myapp                                     # every test
VERBOSE=1 scripts/run_tests.sh myapp perf                      # the perf test, with the numbers it prints
```

## Measuring

### Startup

The engine stamps two times, in ms since the process started:

```js
bro.app.startup   // { loadedMs, firstFrameMs }: the page's scripts ran / its first frame was drawn
```

Every run also logs `app <id>: first frame N ms after start (page loaded at M ms)`.
Most of that time is the engine's (GPU device, compiler); your app's share
is what it adds on top. Measure it against the kit's own test app:

```bash
for i in 1 2 3; do bro-headless kit-tests -e "console.log(JSON.stringify(bro.app.startup))"; done
for i in 1 2 3; do bro-headless myapp     -e "console.log(JSON.stringify(bro.app.startup))"; done
```

The difference between the two is your app: keep it under 100 ms. (Run each
a few times. The first run after a rebuild compiles your scripts and is
slower; later runs hit the code cache. The log line `compiled js/main.js in
N ms (code cache hit)` says which you got.)

### Frames

`measureFrames(pred, what, ms)` from `lib/test.js` is `waitFor` that times
every frame on the way: each frame is one `advanceTime(16)`, which runs your
timers, `requestAnimationFrame` callbacks, style, layout and paint.

```js
import { app, measureFrames } from '/lib/test.js';
app.openPath(bigFolder);
const f = measureFrames(() => app.state.done, 'loading the big folder');
console.log(`worst ${f.maxMs.toFixed(1)} ms, ${f.slow} frames over 16.7 ms of ${f.frames}`);
assert(f.maxMs < 50, `no frame over 50 ms (worst ${f.maxMs.toFixed(1)})`);
```

Wall time in a test is `perf.now()`. `performance.now()` is the page's
**virtual** clock in headless: it moves only with `advanceTime`, which is
what makes a test's timers deterministic, and it reads 0 ms across a slow
function.

Give the test real work. Creating files costs real time (mostly the OS's,
per file), so a fixture of a few thousand files is the most a test should
make. For more, let the test take an optional real folder from the
environment, as `diskusage/tests/test_perf.js` does with `DU_PERF_ROOT`:

```bash
DU_PERF_ROOT='C:\' VERBOSE=1 scripts/run_tests.sh diskusage perf
```

### Finding what a slow frame spent its time on

**The frame trace** splits frames into phases. It is bro's agent-control
`trace` command, which a headless script can call:

```js
// A control command answers on a later frame.
const ask = (...argv) => {
  const id = controlCommand(...argv);
  let r = null;
  while (r == null) { advanceTime(16); r = controlResult(id); }
  return r.payload;
};
const t0 = ask('now');                                   // the trace's clock, before the work
const f = measureFrames(() => app.state.done, 'loading the big folder');
console.log(ask('trace', `--since=${t0}`, '--worst=3'));  // the frames since t0
```

The trace looks back: `trace 20` is the frames of the **last** 20 seconds,
not the next ones, so a trace asked for before the work finds nothing in
its window. Bracket the work instead: `now` before it (the trace's clock,
real milliseconds, not the virtual `performance.now()`), then `trace
--since=<that>` after it (`--until=` closes the window early).

For each of the worst frames it reports `js` (your callbacks), `style`,
`layout`, `record` (paint) and **`forced layouts`**: how many times your
code read a box (`clientWidth`, `getBoundingClientRect`, `scrollTop`) after
changing the DOM, which makes the engine lay the page out again on the spot.
A frame with dozens of forced layouts is the classic slow list (see "Read,
then write" below).

**The profiler** names the functions. `bro.profiler` samples the thread
(`../bro/docs/profiler-api.js`):

```js
bro.profiler.start({ hz: 2000 });
for (let i = 0; i < 10; i++) { app.show(bigFolder); advanceTime(16); app.show(home); advanceTime(16); }
console.log(bro.profiler.stop({ report: true }).report);
```

Native entries show where the engine spent the time. For example
`htmlayout::css::Cascade::resolve` means style resolution for many new or
changed elements, and an allocator near the top means too many objects
built per frame.

## The rules

### 1. Paint first: nothing waits on the disk before the first frame

Build the whole window synchronously from the kit, then start everything
that touches the disk or a service. Its answers fill the window in as they
arrive.

- No synchronous I/O on the way to the first frame: no `readFileSync`,
  `statSync`, `existsSync`, `readdirSync`, and no sync `bro.*` calls that
  reach the disk or a device (`bro.vfs.listVolumes()`; use
  `bro.vfs.volumes()`).
- Use `fs.promises` (or the callback forms). They really run on brokit's
  I/O threads; the promise settles on a later frame.
- Do not `await` before the window is built. An `async` startup that
  awaits a stat before creating the toolbar shows an empty window instead.
- Remember the last state (`app.settings`) and restore it after the window
  is up: `app.onLaunch` runs on the next tick.

```js
// diskusage/js/main.js: the window is built above; these start I/O and return at once.
fillPlaces();   // fs.promises.stat of each place, then sidebar.setSections
fillDrives();   // await vfs.volumes(): a sleeping disk can take seconds to answer
app.onLaunch(({ argv }) => { ... openPath(settings.get('lastRoot'), { quiet: true }); });
```

### 2. Heavy work happens off the page's thread

The page's thread is for deciding what to show. Walking a tree, hashing,
decoding, parsing a large file, or any loop over more than a few thousand
items happens elsewhere:

- **A native API that does the job on its own threads**, when bro has one:
  `bro.vfs.usage` (sizes of a whole tree), `bro.vfs.scan`, `bro.vfs.copy`,
  `bro.thumb`, `bro.image` decoders, `bro.search`. You read its results;
  it does the work.
- **A `Worker`** (`../bro/docs/worker-api.js`) for CPU-bound JavaScript of
  your own. Post the result back; never block on it.
- **If bro lacks the native piece, that is an engine gap.** Write it in
  GAPS.md. Do not drive a million `await fs.promises.lstat()` calls from the
  page; even fully async, a JS object per file and a promise per call is
  too much for the thread that draws.

### 3. Show results while the work runs

Poll the work from a `requestAnimationFrame` loop and redraw **only when
something changed and at most every 200–250 ms**, so a redraw never happens
every frame:

```js
function pump(scan) {
  if (scan !== state.scan) return;                 // a newer scan took over: stop
  const p = scan.progress();
  const done = p.finished || p.cancelled;
  if (p.version !== state.shownVersion && (done || performance.now() - state.lastDraw >= REFRESH_MS)) drawFolder();
  showProgress(p);                                 // cheap: a text and a bar
  if (!done) requestAnimationFrame(() => pump(scan));
}
```

Let the user navigate, sort and cancel while it runs. A new request cancels
the old one (`scan.cancel()`).

### 4. Hold only what is on screen

Keep the folder (or page, or month) on screen in JS, not the whole data set.
Ask the native side for it already sorted and cut: `scan.children(dir, {
sort: 'bytes', limit: 5000 })`. When there are more items than the cap, say
so in the status bar.

### 5. Read, then write

Reading a box (`clientWidth`, `offsetHeight`, `scrollTop`,
`getBoundingClientRect`) after changing the DOM makes the engine lay out the
whole page first. In a loop, that is one full layout per iteration. Read
everything you need first, then make all the changes:

```js
// lib/list.js paint(): one layout, however many rows are written below.
const width = this.scroller.clientWidth;
const top = this.scroller.scrollTop;
const view = this.scroller.clientHeight;
for (...) { el.style.top = `${this.rectOf(i, width).y}px`; ... }
```

The trace's `forced layouts` count tells you when you got this wrong.

### 6. Change only what changed

`VirtualList.setItems()` keeps every on-screen row whose new item has the
same fields as its old one, so a list refreshed four times a second
rebuilds only the rows that changed. For that to be right, **a row shows
only its item's fields**: put derived values on the item (`row.share =
bytes / total`, rounded to what the row can show) rather than reading app
state in a cell. In the same spirit, do not rebuild the breadcrumbs, the
header or the sidebar on every redraw when they have not changed.

### 7. Optional services start late

Some `bro.*` services are slow to start the first time they are used (the
app catalog behind `bro.apps` reads every installed app). Use them from an
action or after the first frame, never on the way to it. If a call is
synchronous and slow, it is an engine gap: write it down.

## Checklist

- [ ] `bro.app.startup.firstFrameMs` is within 100 ms of `kit-tests`'.
- [ ] No sync I/O and no `await` before the window is built.
- [ ] Your app has a perf test: the heaviest scenario from your brief,
      wrapped in `measureFrames`, asserting a worst frame under 50 ms and
      logging its numbers.
- [ ] Long work shows progress, can be cancelled, and the window stays
      usable (navigation, menus) while it runs.
- [ ] Nothing holds a JS object per item of a large data set.
- [ ] The trace shows no frame with more than a couple of forced layouts.
