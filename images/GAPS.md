# Gaps

Engine, platform and kit gaps found building the Image Viewer. Each was
measured with `bro-headless`; the app does not work around any of them
beyond saying so in the window. Kit-level gaps shared by every app are in
`../GAPS.md`.

## No HEIC decoder on Linux (AVIF resolved)
- **Where:** broimage
- **Expected:** phone photos (HEIC) and AVIF open.
- **Actual:** AVIF now decodes everywhere (broimage's own HEIF reader, dav1d
  in bro; 8/10/12-bit, alpha, grids, irot/imir; an animated AVIF shows its
  first frame). HEIC decodes only through the system's decoder: WIC on
  Windows when the Microsoft Store's HEVC Video Extensions are installed,
  ImageIO on macOS. Linux has none (bro carries no HEVC decoder).
- **Impact:** where HEIC cannot be decoded it is listed with a placeholder
  tile and opening it shows `bro.image.decodeSupport`'s reason; the Open
  dialog leaves it out.
- **Belongs in:** broimage (an HEVC backend, if one with a usable licence is chosen)
