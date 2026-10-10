/**
 * ID3 tags: ID3v2.2, v2.3 and v2.4 at the start of a file (MP3, and now and
 * then FLAC or WAV), and the 128-byte ID3v1 at the end.
 *
 *   const t = readId3v2(reader);    // { tags, picture, size } or null
 *   const v1 = readId3v1(reader);   // tags or null
 *   id3Size(bytes10)                // a v2 tag's whole length from its 10-byte header, or 0
 *
 * Text frames are read in every encoding ID3 allows: ISO-8859-1, UTF-16 with
 * a byte-order mark, UTF-16BE and UTF-8. A frame with several values (v2.4
 * separates them with a zero) keeps the first, except the artist, whose
 * values are joined with ", ". Unsynchronisation (whole-tag in v2.3, per
 * frame in v2.4) is undone; compressed and encrypted frames are skipped.
 */

import { u24be, u32be, syncsafe, isAscii, ascii, latin1, utf8, utf16, terminator, numberPair, yearOf } from './bytes.js';

/** Largest tag read (a tag carrying a huge picture is cut, not read whole). */
const MAX_TAG = 32 * 1024 * 1024;

export function emptyTags() {
  return { title: '', artist: '', album: '', albumArtist: '', track: 0, trackTotal: 0, disc: 0, discTotal: 0, year: 0, genre: '' };
}

/** A v2 tag's whole length (header, body, footer) from its first 10 bytes, or 0. */
export function id3Size(b) {
  if (!b || b.length < 10 || !isAscii(b, 0, 'ID3')) return 0;
  if (b[3] < 2 || b[3] > 4) return 0;
  return 10 + syncsafe(b, 6) + (b[5] & 0x10 ? 10 : 0);
}

const IDS = {
  // v2.3 / v2.4                     v2.2
  TIT2: 'title', TPE1: 'artist', TALB: 'album', TPE2: 'albumArtist', TRCK: 'track', TPOS: 'disc',
  TYER: 'year', TDRC: 'year', TORY: 'origYear', TDOR: 'origYear', TCON: 'genre',
  TT2: 'title', TP1: 'artist', TAL: 'album', TP2: 'albumArtist', TRK: 'track', TPA: 'disc', TYE: 'year', TCO: 'genre',
};

/** Undo unsynchronisation: every FF 00 back to FF. */
export function unsync(b) {
  let n = 0;
  for (let i = 0; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === 0) n++;
  if (!n) return b;
  const out = new Uint8Array(b.length - n);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0) i++;
  }
  return out;
}

/** A string in ID3 text encoding `enc` (0 latin-1, 1 UTF-16 BOM, 2 UTF-16BE, 3 UTF-8). */
function decode(enc, b) {
  if (enc === 1) return utf16(b, false);
  if (enc === 2) return utf16(b, true);
  if (enc === 3) return utf8(b);
  return latin1(b);
}

/** A text frame's values (zero-separated in v2.4), trailing zeros dropped. */
export function textValues(data) {
  if (!data.length) return [];
  const enc = data[0];
  const wide = enc === 1 || enc === 2;
  const out = [];
  let o = 1;
  while (o < data.length) {
    const end = terminator(data, o, wide);
    // Each UTF-16 value carries its own byte-order mark; one without follows the first's.
    const s = (enc === 1 && out.length && !(data[o] === 0xff || data[o] === 0xfe)
      ? utf16(data.subarray(o, end), data[1] === 0xfe)
      : decode(enc, data.subarray(o, end))).trim();
    if (s) out.push(s);
    o = end + (wide ? 2 : 1);
  }
  return out;
}

/** An attached picture: APIC (v2.3+) or PIC (v2.2). */
function picture(data, v22) {
  if (data.length < 4) return null;
  const enc = data[0];
  let o = 1, mime;
  if (v22) {
    const fmt = ascii(data, 1, 3).toLowerCase();
    mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    o = 4;
  } else {
    const end = terminator(data, 1, false);
    mime = latin1(data.subarray(1, end)).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = `image/${mime === 'jpg' ? 'jpeg' : mime}`;
    o = end + 1;
  }
  const type = data[o++];
  const wide = enc === 1 || enc === 2;
  o = terminator(data, o, wide) + (wide ? 2 : 1);
  if (o >= data.length) return null;
  return { mime, type, data: data.subarray(o) };
}

function setField(tags, field, values) {
  if (!values.length) return;
  const v = values[0];
  switch (field) {
    case 'track': case 'disc': {
      const p = numberPair(v);
      if (field === 'track') { tags.track = p.n; tags.trackTotal = p.of; } else { tags.disc = p.n; tags.discTotal = p.of; }
      break;
    }
    case 'year': if (!tags.year) tags.year = yearOf(v); break;
    case 'origYear': break;
    case 'artist': tags.artist = values.join(', '); break;
    case 'genre': tags.genre = v.replace(/^\((\d+)\)/, ''); break;
    default: tags[field] = v;
  }
}

/** Keep the front cover; else the first picture. */
function better(cur, pic) {
  if (!pic) return cur;
  if (!cur) return pic;
  return cur.type !== 3 && pic.type === 3 ? pic : cur;
}

/**
 * The ID3v2 tag at `offset` (normally 0), or null when there is none.
 * { tags, picture: { mime, type, data } | null, size } where size is the
 * tag's whole length, so the audio starts at offset + size.
 */
export function readId3v2(r, offset = 0) {
  const head = r.read(offset, 10);
  const size = id3Size(head);
  if (!size) return null;
  const ver = head[3];
  const flags = head[5];
  let body = r.read(offset + 10, Math.min(size - 10, MAX_TAG));
  if (ver < 4 && (flags & 0x80)) body = unsync(body);
  let o = 0;
  if (flags & 0x40) {
    // Extended header: v2.3 counts the bytes after its size field, v2.4 its whole length.
    o = ver === 4 ? syncsafe(body, 0) : u32be(body, 0) + 4;
  }
  const tags = emptyTags();
  let pic = null;
  const v22 = ver === 2;
  const idLen = v22 ? 3 : 4;
  const headLen = v22 ? 6 : 10;
  while (o + headLen <= body.length) {
    if (body[o] === 0) break;                                     // padding
    const id = ascii(body, o, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let len = v22 ? u24be(body, o + 3) : ver === 4 ? syncsafe(body, o + 4) : u32be(body, o + 4);
    const fflags = v22 ? 0 : (body[o + 8] << 8) | body[o + 9];
    o += headLen;
    if (len <= 0 || o + len > body.length) {
      // Some v2.4 writers store plain sizes; try that before giving up.
      if (ver === 4 && !v22) len = u32be(body, o - 6);
      if (len <= 0 || o + len > body.length) break;
    }
    let data = body.subarray(o, o + len);
    o += len;
    if (ver === 3 && (fflags & 0x00c0)) continue;                 // v2.3 compressed / encrypted
    if (ver === 4) {
      if (fflags & 0x000c) continue;                              // v2.4 compressed / encrypted
      if (fflags & 0x0001) data = data.subarray(4);               // data length indicator
      if ((fflags & 0x0002) || (flags & 0x80)) data = unsync(data);
    }
    if (id === 'APIC' || id === 'PIC') { pic = better(pic, picture(data, v22)); continue; }
    const field = IDS[id];
    if (field) setField(tags, field, textValues(data));
  }
  return { tags, picture: pic, size };
}

/** The 128-byte ID3v1 tag at the end of a file, or null. */
export function readId3v1(r) {
  if (r.size < 128) return null;
  const b = r.read(r.size - 128, 128);
  if (!isAscii(b, 0, 'TAG')) return null;
  const field = (o, n) => latin1(b.subarray(o, o + n)).replace(/\0.*$/s, '').trim();
  const tags = emptyTags();
  tags.title = field(3, 30);
  tags.artist = field(33, 30);
  tags.album = field(63, 30);
  tags.year = yearOf(field(93, 4));
  if (b[125] === 0 && b[126] !== 0) tags.track = b[126];          // ID3v1.1
  return tags;
}
