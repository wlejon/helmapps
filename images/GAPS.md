# Gaps

Engine, platform and kit gaps found building the Image Viewer. Each was
measured with `bro-headless`; the app does not work around any of them
beyond saying so in the window. Kit-level gaps shared by every app are in
`../GAPS.md`.

## No AVIF or HEIC decoder
- **Where:** broimage
- **Expected:** phone photos (HEIC) and AVIF open.
- **Actual:** broimage has no decoder for either (no samples were at hand to
  try `<img>`, but nothing in bro would decode them).
- **Impact:** not offered.
- **Belongs in:** broimage

## Kit: VirtualList has no horizontal orientation
- **Where:** `lib/list.js`
- **Impact:** the thumbnail strip is `StripList` (`js/gallery.js`), a
  subclass that lays cells out in one row.
- **Belongs in:** kit (`new VirtualList({ orientation: 'horizontal' })`)

## Kit: no flip-vertical icon
- **Where:** `lib/icons.js`
- **Impact:** `js/main.js` defines `flip-v`.
- **Belongs in:** kit

## docs/performance.md: the trace window is seconds
- **Where:** `../docs/performance.md`
- **Actual:** the example `controlCommand('trace', '20', ...)` says "the
  frames of the next 20 ms"; the argument is seconds of the past
  (`bro/docs/agent-control.md`), so a trace issued before the work reports
  "no frames in the window". Bracket with `controlCommand('now')` and
  `--since=` instead.
- **Belongs in:** docs
