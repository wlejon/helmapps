/**
 * FLAC: the metadata blocks before the audio. STREAMINFO gives the length,
 * VORBIS_COMMENT the tags, PICTURE the cover. A FLAC with an ID3v2 tag in
 * front of "fLaC" (some taggers write one) is read past it.
 *
 *   readFlac(reader) → { tags, picture, duration, sampleRate, channels } or null
 */

import { u24be, u32be, isAscii } from './bytes.js';
import { id3Size, emptyTags } from './id3.js';
import { readComments, readPictureBlock } from './vorbis.js';

const MAX_BLOCK = 32 * 1024 * 1024;

export function readFlac(r) {
  let o = id3Size(r.read(0, 10));
  if (!isAscii(r.read(o, 4), 0, 'fLaC')) return null;
  o += 4;
  const out = { tags: emptyTags(), picture: null, duration: 0, sampleRate: 0, channels: 0 };
  for (let guard = 0; guard < 128 && o + 4 <= r.size; guard++) {
    const head = r.read(o, 4);
    if (head.length < 4) break;
    const last = !!(head[0] & 0x80);
    const type = head[0] & 0x7f;
    const len = u24be(head, 1);
    o += 4;
    if (type === 0 && len >= 18) {
      const b = r.read(o, 18);
      out.sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      out.channels = ((b[12] >> 1) & 7) + 1;
      // 36 bits of total samples: the low 4 bits of byte 13, then 4 bytes.
      const total = (b[13] & 0x0f) * 2 ** 32 + u32be(b, 14);
      if (out.sampleRate) out.duration = total / out.sampleRate;
    } else if (type === 4 && len <= MAX_BLOCK) {
      out.tags = readComments(r.read(o, len), 0).tags;
    } else if (type === 6 && len <= MAX_BLOCK) {
      const pic = readPictureBlock(r.read(o, len));
      if (pic && (!out.picture || (out.picture.type !== 3 && pic.type === 3))) out.picture = pic;
    }
    o += len;
    if (last) break;
  }
  return out;
}
