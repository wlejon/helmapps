/**
 * Ogg Vorbis and Ogg Opus: the identification and comment packets at the
 * start of the first logical stream, and the length from the last page's
 * granule position.
 *
 *   readOgg(reader) → { codec: 'vorbis' | 'opus', tags, picture, duration, sampleRate } or null
 *
 * Pages are read one at a time, so only the headers are read however long
 * the file; a comment packet may run over many pages (a big picture) and is
 * put back together.
 */

import { u16le, u32le, isAscii } from './bytes.js';
import { emptyTags } from './id3.js';
import { readComments } from './vorbis.js';

const MAX_HEADERS = 32 * 1024 * 1024;
const TAIL = 64 * 1024;

/** The page at o: { serial, granule, segments, bodyAt, next } or null. */
function page(r, o) {
  const h = r.read(o, 27);
  if (h.length < 27 || !isAscii(h, 0, 'OggS')) return null;
  const n = h[26];
  const lacing = r.read(o + 27, n);
  if (lacing.length < n) return null;
  let body = 0;
  for (let i = 0; i < n; i++) body += lacing[i];
  return { serial: u32le(h, 14), granule: u32le(h, 6) + u32le(h, 10) * 2 ** 32, lacing, bodyAt: o + 27 + n, next: o + 27 + n + body };
}

/** The first two packets of the first logical stream (identification, comments). */
function headerPackets(r) {
  const packets = [];
  let cur = [];
  let curLen = 0;
  let o = 0, serial = -1;
  while (packets.length < 2 && o < r.size) {
    const p = page(r, o);
    if (!p) break;
    if (serial < 0) serial = p.serial;
    if (p.serial === serial) {
      let at = p.bodyAt;
      let seg = 0;
      for (let i = 0; i < p.lacing.length; i++) {
        seg += p.lacing[i];
        if (p.lacing[i] < 255) {
          // A packet ends here: its bytes are what was carried over plus this run.
          cur.push(r.read(at, seg));
          curLen += seg;
          at += seg;
          seg = 0;
          packets.push(join(cur, curLen));
          cur = [];
          curLen = 0;
          if (packets.length === 2) break;
        }
      }
      if (seg) { cur.push(r.read(at, seg)); curLen += seg; }
      if (curLen > MAX_HEADERS) break;
    }
    o = p.next;
  }
  return { packets, serial };
}

function join(parts, len) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** The granule position of the stream's last page: read backwards from the end. */
function lastGranule(r, serial) {
  const start = Math.max(0, r.size - TAIL);
  const b = r.read(start, r.size - start);
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] !== 0x4f || !isAscii(b, i, 'OggS')) continue;
    if (u32le(b, i + 14) !== serial) continue;
    const g = u32le(b, i + 6) + u32le(b, i + 10) * 2 ** 32;
    if (g > 0 && g < 2 ** 52) return g;
  }
  return 0;
}

export function readOgg(r) {
  if (!isAscii(r.read(0, 4), 0, 'OggS')) return null;
  const { packets, serial } = headerPackets(r);
  if (!packets.length) return null;
  const id = packets[0];
  const out = { codec: '', tags: emptyTags(), picture: null, duration: 0, sampleRate: 0 };
  let preskip = 0;
  if (id.length >= 16 && id[0] === 1 && isAscii(id, 1, 'vorbis')) {
    out.codec = 'vorbis';
    out.sampleRate = u32le(id, 12);
  } else if (isAscii(id, 0, 'OpusHead') && id.length >= 16) {
    out.codec = 'opus';
    out.sampleRate = 48000;                                        // Opus granules always count 48 kHz
    preskip = u16le(id, 10);
  } else {
    return out;
  }
  const c = packets[1];
  if (c) {
    if (out.codec === 'vorbis' && c[0] === 3 && isAscii(c, 1, 'vorbis')) Object.assign(out, readComments(c, 7));
    else if (out.codec === 'opus' && isAscii(c, 0, 'OpusTags')) Object.assign(out, readComments(c, 8));
  }
  const g = lastGranule(r, serial);
  if (g && out.sampleRate) out.duration = Math.max(0, g - preskip) / out.sampleRate;
  return out;
}
