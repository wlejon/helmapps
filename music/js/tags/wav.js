/**
 * WAV: the length from the fmt and data chunks, and tags from a LIST/INFO
 * chunk (INAM title, IART artist, IPRD album, ITRK / IPRT track, ICRD date)
 * or an "id3 " chunk, wherever in the file they are.
 *
 *   readWav(reader) → { tags, picture, duration, sampleRate } or null
 */

import { u16le, u32le, isAscii, ascii, latin1, utf8, numberPair, yearOf, bytesReader } from './bytes.js';
import { emptyTags, readId3v2 } from './id3.js';

const INFO = { INAM: 'title', IART: 'artist', IPRD: 'album', ITRK: 'track', IPRT: 'track', ICRD: 'year', IGNR: 'genre' };

/** INFO text: UTF-8 when it decodes as such, else Latin-1. */
function infoText(b) {
  const s = utf8(b);
  return (s.includes('�') ? latin1(b) : s).replace(/\0+$/, '').trim();
}

export function readWav(r) {
  const head = r.read(0, 12);
  if (!isAscii(head, 0, 'RIFF') || !isAscii(head, 8, 'WAVE')) return null;
  const out = { tags: emptyTags(), picture: null, duration: 0, sampleRate: 0 };
  let byteRate = 0, dataLen = 0;
  let o = 12;
  for (let guard = 0; guard < 256 && o + 8 <= r.size; guard++) {
    const ch = r.read(o, 8);
    if (ch.length < 8) break;
    const id = ascii(ch, 0, 4);
    const len = u32le(ch, 4);
    const body = o + 8;
    if (id === 'fmt ') {
      const f = r.read(body, 16);
      out.sampleRate = u32le(f, 4);
      byteRate = u32le(f, 8);
      if (!byteRate) byteRate = out.sampleRate * u16le(f, 2) * (u16le(f, 14) >> 3);
    } else if (id === 'data') {
      dataLen = Math.min(len, r.size - body);
    } else if (id === 'LIST' && len >= 4 && len < 1 << 20) {
      const b = r.read(body, len);
      if (isAscii(b, 0, 'INFO')) {
        for (let i = 4; i + 8 <= b.length;) {
          const key = ascii(b, i, 4);
          const n = u32le(b, i + 4);
          const field = INFO[key];
          if (field) {
            const v = infoText(b.subarray(i + 8, i + 8 + n));
            if (field === 'track') out.tags.track = numberPair(v).n;
            else if (field === 'year') out.tags.year = yearOf(v);
            else out.tags[field] = v;
          }
          i += 8 + n + (n & 1);
        }
      }
    } else if ((id === 'id3 ' || id === 'ID3 ') && len < 1 << 25) {
      const t = readId3v2(bytesReader(r.read(body, len)), 0);
      if (t) {
        for (const [k, v] of Object.entries(t.tags)) if (v && !out.tags[k]) out.tags[k] = v;
        out.picture = t.picture;
      }
    }
    o = body + len + (len & 1);
  }
  if (byteRate && dataLen) out.duration = dataLen / byteRate;
  return out;
}
