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
