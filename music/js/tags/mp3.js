/**
 * MP3: the ID3v2 tag in front, ID3v1 at the back as a fallback, and the
 * length from the first frame: a Xing/Info or VBRI header's frame count for
 * a variable bit rate, else the bit rate over the audio's size.
 *
 *   readMp3(reader) → { tags, picture, duration, sampleRate } or null
 */

import { u32be, isAscii } from './bytes.js';
import { readId3v2, readId3v1, emptyTags } from './id3.js';

const BITRATES = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

/** The frame header at b[o], or null when it is not one. */
export function frameHeader(b, o) {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const v = (b[o + 1] >> 3) & 3;
  const layerBits = (b[o + 1] >> 1) & 3;
  const bi = b[o + 2] >> 4;
  const si = (b[o + 2] >> 2) & 3;
  if (v === 1 || layerBits === 0 || bi === 0 || bi === 15 || si === 3) return null;
  const version = v === 3 ? 1 : v === 2 ? 2 : 2.5;
  const layer = 4 - layerBits;
  const kbps = BITRATES[`${version === 1 ? 1 : 2}-${layer}`][bi];
  const sampleRate = RATES[version][si];
  const pad = (b[o + 2] >> 1) & 1;
  const mono = (b[o + 3] >> 6) === 3;
  const samples = layer === 1 ? 384 : layer === 2 || version === 1 ? 1152 : 576;
  const length = layer === 1
    ? Math.floor((12 * kbps * 1000) / sampleRate + pad) * 4
    : Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + pad;
  return { version, layer, kbps, sampleRate, mono, samples, length };
}

/** The first real frame at or after `from` (two in a row when the second fits). */
function firstFrame(r, from) {
  const b = r.read(from, 128 * 1024);
  for (let i = 0; i + 4 <= b.length; i++) {
    if (b[i] !== 0xff) continue;
    const h = frameHeader(b, i);
    if (!h || h.length < 24) continue;
    const next = i + h.length;
    if (next + 4 <= b.length && !frameHeader(b, next)) continue;
    return { at: from + i, h, b: b.subarray(i) };
  }
  return null;
}

export function readMp3(r) {
  const v2 = readId3v2(r, 0);
  const start = v2 ? v2.size : 0;
  const f = firstFrame(r, start);
  if (!v2 && !f) return null;
  const out = { tags: v2 ? v2.tags : emptyTags(), picture: v2 ? v2.picture : null, duration: 0, sampleRate: 0 };
  const v1 = readId3v1(r);
  if (v1) {
    // ID3v1 fills only what the v2 tag left empty.
    for (const k of ['title', 'artist', 'album', 'year', 'track']) if (!out.tags[k] && v1[k]) out.tags[k] = v1[k];
  }
  if (!f) return out;
  const { h, b } = f;
  out.sampleRate = h.sampleRate;
  const side = h.version === 1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17);
  const x = 4 + side;
  if (isAscii(b, x, 'Xing') || isAscii(b, x, 'Info')) {
    const flags = u32be(b, x + 4);
    if (flags & 1) {
      out.duration = (u32be(b, x + 8) * h.samples) / h.sampleRate;
      return out;
    }
  }
  if (isAscii(b, 36, 'VBRI')) {
    out.duration = (u32be(b, 36 + 14) * h.samples) / h.sampleRate;
    return out;
  }
  const audio = r.size - f.at - (v1 ? 128 : 0);
  out.duration = audio > 0 ? (audio * 8) / (h.kbps * 1000) : 0;
  return out;
}
