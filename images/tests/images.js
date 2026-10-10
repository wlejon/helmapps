// Test images, made in memory: PNG and JPEG through bro.image's encoders,
// and tiny files of the other formats from their bytes, so no binary
// fixtures need committing.

/** RGBA pixels: a w x h image in one colour with a darker diagonal (so it is not uniform). */
export function pixels(w, h, rgb = [200, 80, 40]) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.abs(x * h - y * w) < Math.max(w, h) ? 0.4 : 1;
      px[i] = rgb[0] * d; px[i + 1] = rgb[1] * d; px[i + 2] = rgb[2] * d; px[i + 3] = 255;
    }
  }
  return px;
}

export function png(w, h, rgb) {
  return bro.image.encodePng(pixels(w, h, rgb), w, h, 4);
}

export function jpeg(w, h, rgb, quality = 85) {
  return bro.image.encodeJpeg(pixels(w, h, rgb), w, h, 4, quality);
}

/** A JPEG carrying an EXIF Orientation tag (6 = shot rotated, shown turned 90° right). */
export function orientedJpeg(w, h, orientation) {
  const jpg = jpeg(w, h, [40, 120, 200]);
  const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, len >> 8, len & 255, ...payload];
  const out = new Uint8Array(jpg.length + app1.length);
  out.set(jpg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpg.subarray(2), 2 + app1.length);
  return out;
}

/**
 * A JPEG whose EXIF names the camera (Make, Model), and in the Exif IFD the
 * aperture (FNumber f/2.8) and ISO 400. Little-endian TIFF.
 */
export function cameraJpeg(w, h, make = 'Canon', model = 'Canon EOS R5') {
  const jpg = jpeg(w, h, [120, 90, 60]);
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const mk = ascii(make), md = ascii(model);
  // Layout: header 8 | IFD0 (3 entries) at 8 | Exif IFD (2 entries) | data.
  const ifd0 = 8, ifd0Size = 2 + 3 * 12 + 4;
  const exif = ifd0 + ifd0Size, exifSize = 2 + 2 * 12 + 4;
  const makeAt = exif + exifSize, modelAt = makeAt + mk.length, fnAt = modelAt + md.length;
  const t = new Uint8Array(fnAt + 8);
  const dv = new DataView(t.buffer);
  t.set([0x49, 0x49, 0x2a, 0]); dv.setUint32(4, ifd0, true);
  const entry = (at, tag, type, count, value) => {
    dv.setUint16(at, tag, true); dv.setUint16(at + 2, type, true); dv.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(at + 8, value, true); else dv.setUint32(at + 8, value, true);
  };
  dv.setUint16(ifd0, 3, true);
  entry(ifd0 + 2, 0x010f, 2, mk.length, makeAt);
  entry(ifd0 + 14, 0x0110, 2, md.length, modelAt);
  entry(ifd0 + 26, 0x8769, 4, 1, exif);
  dv.setUint16(exif, 2, true);
  entry(exif + 2, 0x829d, 5, 1, fnAt);
  entry(exif + 14, 0x8827, 3, 1, 400);
  t.set(mk, makeAt); t.set(md, modelAt);
  dv.setUint32(fnAt, 28, true); dv.setUint32(fnAt + 4, 10, true);
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
  const len = payload.length + 2;
  const app1 = [0xff, 0xe1, len >> 8, len & 255, ...payload];
  const out = new Uint8Array(jpg.length + app1.length);
  out.set(jpg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpg.subarray(2), 2 + app1.length);
  return out;
}

/** A 24-bit BMP. */
export function bmp(w, h) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set([40, 160, 90], 54 + y * row + x * 3);
  return b;
}

/** A Windows icon holding one PNG image. */
export function ico(size) {
  const p = png(size, size, [90, 90, 220]);
  const b = new Uint8Array(22 + p.length);
  const dv = new DataView(b.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, 1, true);
  b[6] = size >= 256 ? 0 : size; b[7] = size >= 256 ? 0 : size;
  dv.setUint16(10, 1, true); dv.setUint16(12, 32, true);
  dv.setUint32(14, p.length, true); dv.setUint32(18, 22, true);
  b.set(p, 22);
  return b;
}

/** A 1x1 GIF. */
export function gif() {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0xff, 0, 0, 0, 0, 0,
    0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b]);
}

/** A 1x1 animated GIF: two frames (red, then blue from a local palette), 100 ms each, looping. */
export function animatedGif() {
  const frame = (local) => [0x21, 0xf9, 4, 0, 10, 0, 0, 0,
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, local ? 0x80 : 0, ...(local ? [0, 0, 0xff, 0, 0xff, 0] : []),
    2, 2, 0x44, 1, 0];
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0xff, 0, 0, 0, 0, 0xff,
    0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0,
    ...frame(false), ...frame(true), 0x3b]);
}

/** A 1x1 lossless WebP. */
export function webp() {
  return Uint8Array.from(atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='), (c) => c.charCodeAt(0));
}

const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A 64x48 8-bit 4:2:0 AVIF, solid #C03020 (libaom, from bro's tests/image/fixtures). */
export function avif() {
  return fromBase64('AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAdAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAABAAAAAMAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAlbWRhdAoGGBV/vbAIMhMSgAAAQAAAAADrzV3shLmkk32H');
}

/**
 * A 64x48 HEIC (written by Windows' HEIF encoder): red top-left, green
 * bottom-left, blue right. It decodes only where the system has a decoder.
 */
export function heic() {
  return fromBase64('AAAAIGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZk1pSEIAAAE9bWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAAaUAAACWAAAAwWlwcnAAAACjaXBjbwAAABRpc3BlAAAAAAAAAEAAAAAwAAAAd2h2Y0MBAUAAAACwAAAAAAAD8AD8/fj4AQALA6AAAQAYQAEMAf//AUAAAAMAsAAAAwAAAwADKgJAoQABACpCAQEBQAAAAwCwAAADAAADAAOgIIMXKk7cuTcBDQIEAAADAZAAAAMBkCCiAAEAB0QBwHGAmyAAAAAQcGl4aQAAAAADCAgIAAAAFmlwbWEAAAAAAAAAAQABAwGCAwAAAEBmcmVlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACebWRhdAAAAJIoAa8FcO9doHF/nqd//8cf6H8WFe/19HDieRXy1nTZ9tXvTb1XuNeLAlMzmH57t+5ffwfU6/lGypdCYHuPOJ9zD4P3inN5D1znQf+vtY58cAfMxQ9cB/R2Bs8gValKSPo/4YfX/syn//2bgvkEcwrVXj5ot2ntJNT4b1urX//vx/lCFaZ6U+LRlcR432DFP5ZV3A==');
}

export function svg(w = 32, h = 24) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="4" fill="#4a6"/></svg>`;
}

/** A minimal baseline TIFF (uncompressed RGB). bro does not decode it. */
export function tiff(w, h) {
  const entries = [[256, 3, 1, w], [257, 3, 1, h], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 2],
    [273, 4, 1, 0], [277, 3, 1, 3], [278, 3, 1, h], [279, 4, 1, w * h * 3]];
  const ifd = 8;
  const dataAt = ifd + 2 + entries.length * 12 + 4;
  const b = new Uint8Array(dataAt + w * h * 3);
  const dv = new DataView(b.buffer);
  b.set([0x49, 0x49, 0x2a, 0]); dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const o = ifd + 2 + i * 12;
    dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true);
    if (tag === 273) value = dataAt;
    if (type === 3) dv.setUint16(o + 8, value, true); else dv.setUint32(o + 8, value, true);
  });
  b.fill(128, dataAt);
  return b;
}

/** Wait until the image on screen is `name` and decoded. */
export function shown(app, waitFor, name, what) {
  waitFor(() => app.state.mode === 'image' && app.state.pic && app.state.path.endsWith(name) &&
    app.state.pic.path === app.state.path, what || `${name} on screen`);
}
