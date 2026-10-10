/**
 * Byte helpers the tag parsers share: a reader over a file or a byte array,
 * text decoding in the encodings tags use, and integers in both byte orders.
 *
 *   const r = bytesReader(u8);              // tests, and data already in memory
 *   const r = fileReader(fs, fd, size);     // the scan worker: reads only what a parser asks for
 *   r.read(offset, length)                  // a Uint8Array, shorter at the end of the file
 */

export function bytesReader(u8) {
  return {
    size: u8.length,
    read(pos, len) {
      const a = Math.max(0, Math.min(u8.length, pos));
      return u8.subarray(a, Math.max(a, Math.min(u8.length, pos + len)));
    },
  };
}

/** A reader over an open file: each read is one fs.readSync at an offset. */
export function fileReader(fs, fd, size) {
  return {
    size,
    read(pos, len) {
      const n = Math.max(0, Math.min(len, size - pos));
      if (pos < 0 || n <= 0) return new Uint8Array(0);
      const b = new Uint8Array(n);
      const got = fs.readSync(fd, b, 0, n, pos);
      return got < n ? b.subarray(0, Math.max(0, got)) : b;
    },
  };
}

export const u16be = (b, o) => (b[o] << 8) | b[o + 1];
export const u24be = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
export const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
export const u16le = (b, o) => b[o] | (b[o + 1] << 8);
export const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
/** A 28-bit "syncsafe" integer: four bytes of seven bits each (ID3v2). */
export const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

/** Whether the bytes at o spell the ASCII string s. */
export function isAscii(b, o, s) {
  if (o < 0 || o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
}

export function ascii(b, o, n) {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

export function latin1(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** UTF-8, decoded by hand so a worker without TextDecoder reads the same. */
export function utf8(b) {
  let s = '';
  let i = 0;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length) {
    const c = b[i++];
    let cp;
    if (c < 0x80) cp = c;
    else if (c >= 0xc0 && c < 0xe0 && i < b.length) cp = ((c & 0x1f) << 6) | (b[i++] & 0x3f);
    else if (c >= 0xe0 && c < 0xf0 && i + 1 < b.length) { cp = ((c & 0x0f) << 12) | ((b[i] & 0x3f) << 6) | (b[i + 1] & 0x3f); i += 2; }
    else if (c >= 0xf0 && i + 2 < b.length) { cp = ((c & 0x07) << 18) | ((b[i] & 0x3f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f); i += 3; }
    else cp = 0xfffd;
    s += String.fromCodePoint(cp);
  }
  return s;
}

/** UTF-16 with an optional byte-order mark; `bigEndian` when there is none. */
export function utf16(b, bigEndian = false) {
  let i = 0;
  let be = bigEndian;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) { be = false; i = 2; }
  else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { be = true; i = 2; }
  let s = '';
  for (; i + 1 < b.length; i += 2) s += String.fromCharCode(be ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8));
  return s;
}

/**
 * The end of a zero-terminated string starting at o: the index of its
 * terminator (one zero byte, or two aligned ones for UTF-16), or b.length.
 */
export function terminator(b, o, wide) {
  if (!wide) {
    for (let i = o; i < b.length; i++) if (b[i] === 0) return i;
    return b.length;
  }
  for (let i = o; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
  return b.length;
}

/** Standard base64 to bytes (METADATA_BLOCK_PICTURE), ignoring whitespace. */
export function base64(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const map = new Int16Array(128).fill(-1);
  for (let i = 0; i < A.length; i++) map[A.charCodeAt(i)] = i;
  map[45] = 62; map[95] = 63;                            // the URL-safe spellings too
  const out = new Uint8Array(Math.floor((s.length * 3) / 4) + 3);
  let n = 0, acc = 0, bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? map[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 0xff; }
  }
  return out.subarray(0, n);
}

/** "3/12" → { n: 3, of: 12 }; "" → { n: 0, of: 0 }. */
export function numberPair(s) {
  const m = /^\s*(\d+)\s*(?:\/\s*(\d+))?/.exec(String(s || ''));
  return m ? { n: Number(m[1]), of: m[2] ? Number(m[2]) : 0 } : { n: 0, of: 0 };
}

/** The year in a date ("2021", "2021-05-03", "2021-05-03T10:00") or 0. */
export function yearOf(s) {
  const m = /(\d{4})/.exec(String(s || ''));
  return m ? Number(m[1]) : 0;
}
