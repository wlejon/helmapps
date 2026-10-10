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

/** A 1x1 lossless WebP. */
export function webp() {
  return Uint8Array.from(atob('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='), (c) => c.charCodeAt(0));
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
