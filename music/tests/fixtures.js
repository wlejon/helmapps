// Test music, made in memory: short WAV files (a header and a few hundred
// milliseconds of a sine), and tag fixtures as byte arrays (an ID3v2.4 tag
// with frames in several encodings, a FLAC whose metadata blocks carry a
// VORBIS_COMMENT). Nothing binary is committed and nothing touches the
// user's own Music folder: importing this module points the app's library
// at an empty fixture folder before any frame runs, and a test that wants
// songs calls useLibrary(app, dir) with its own.

import { fixtureDir } from '/lib/test.js';

const ENC = { latin1: 0, utf16: 1, utf16be: 2, utf8: 3 };

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function utf8(s) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function utf16(s, be, bom) {
  const out = bom ? (be ? [0xfe, 0xff] : [0xff, 0xfe]) : [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (be) out.push(c >> 8, c & 255); else out.push(c & 255, c >> 8);
  }
  return Uint8Array.from(out);
}

const latin1 = (s) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 255));
const u32be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const syncsafe = (n) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];

/** One ID3v2.4 text frame in `enc` ('latin1' | 'utf16' | 'utf16be' | 'utf8'). */
export function id3TextFrame(id, text, enc = 'utf8') {
  const e = ENC[enc];
  const body = e === 1 ? utf16(text, false, true) : e === 2 ? utf16(text, true, false) : e === 3 ? utf8(text) : latin1(text);
  const data = concat([Uint8Array.of(e), body]);
  return concat([latin1(id), Uint8Array.from(syncsafe(data.length)), Uint8Array.of(0, 0), data]);
}

/** An APIC frame holding `bytes` as the front cover. */
export function id3PictureFrame(bytes, mime = 'image/png') {
  const data = concat([Uint8Array.of(0), latin1(mime), Uint8Array.of(0, 3), latin1('cover'), Uint8Array.of(0), bytes]);
  return concat([latin1('APIC'), Uint8Array.from(syncsafe(data.length)), Uint8Array.of(0, 0), data]);
}

/** An ID3v2.4 tag of frames (Uint8Arrays from id3TextFrame), with some padding. */
export function id3v24(frames, padding = 32) {
  const body = concat([...frames, new Uint8Array(padding)]);
  return concat([latin1('ID3'), Uint8Array.of(4, 0, 0), Uint8Array.from(syncsafe(body.length)), body]);
}

/** A Vorbis comment block body (little-endian lengths). */
export function vorbisComment(fields, vendor = 'helm test') {
  const entries = Object.entries(fields).map(([k, v]) => utf8(`${k}=${v}`));
  return concat([Uint8Array.from(u32le(utf8(vendor).length)), utf8(vendor), Uint8Array.from(u32le(entries.length)),
    ...entries.map((e) => concat([Uint8Array.from(u32le(e.length)), e]))]);
}

/** A FLAC file's metadata: STREAMINFO (`seconds` long at `rate`) and a VORBIS_COMMENT. No audio frames. */
export function flacWithComments(fields, { seconds = 2, rate = 44100 } = {}) {
  const si = new Uint8Array(34);
  si[0] = 0x10; si[1] = 0; si[2] = 0x10; si[3] = 0;               // block sizes 4096
  si[10] = (rate >> 12) & 255;
  si[11] = (rate >> 4) & 255;
  si[12] = ((rate & 15) << 4) | (1 << 1) | 0;                       // 2 channels, bps high bit 0
  const total = Math.round(seconds * rate);
  si[13] = (15 << 4) | Math.floor(total / 2 ** 32);                 // 16 bits per sample
  si.set(u32be(total >>> 0), 14);
  const vc = vorbisComment(fields);
  const block = (type, last, body) => concat([Uint8Array.of((last ? 0x80 : 0) | type, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255), body]);
  return concat([latin1('fLaC'), block(0, false, si), block(4, true, vc)]);
}

const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();

/** One Ogg page (CRC filled in) carrying whole `packets`. */
function oggPage(serial, seq, granule, packets, flags) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  }
  const page = concat([latin1('OggS'), Uint8Array.of(0, flags), Uint8Array.from(u32le(granule)), Uint8Array.from(u32le(0)),
    Uint8Array.from(u32le(serial)), Uint8Array.from(u32le(seq)), Uint8Array.from(u32le(0)),
    Uint8Array.of(lacing.length), Uint8Array.from(lacing), ...packets]);
  let crc = 0;
  for (const b of page) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ b) & 255]) >>> 0;
  page.set(u32le(crc), 22);
  return page;
}

/**
 * An Ogg Opus file of `seconds` of silence (mono, 20 ms CELT silence frames,
 * as WebRTC sends) with Vorbis-style comments: a real file bro decodes.
 */
export function opus(seconds = 0.5, fields = {}) {
  const preSkip = 312;
  const head = concat([latin1('OpusHead'), Uint8Array.of(1, 1, preSkip & 255, preSkip >> 8), Uint8Array.from(u32le(48000)), Uint8Array.of(0, 0, 0)]);
  const tags = concat([latin1('OpusTags'), vorbisComment(fields)]);
  const total = Math.round(seconds * 48000);              // samples after the pre-skip
  const frames = Math.ceil((preSkip + total) / 960);
  const pages = [oggPage(1, 0, 0, [head], 2), oggPage(1, 1, 0, [tags], 0)];
  let done = 0;
  for (let seq = 2; done < frames; seq++) {
    const n = Math.min(50, frames - done);
    done += n;
    const granule = done === frames ? preSkip + total : done * 960;   // the last page trims the end
    pages.push(oggPage(1, seq, granule, Array.from({ length: n }, () => Uint8Array.of(0xf8, 0xff, 0xfe)), done === frames ? 4 : 0));
  }
  return concat(pages);
}

/**
 * A mono 16-bit WAV of `seconds` of a sine, at a low rate so files stay
 * small; `info` ({ title, artist, album, track }) adds a LIST/INFO chunk.
 */
export function wav(seconds = 0.5, { rate = 8000, freq = 440, info = null } = {}) {
  const n = Math.round(seconds * rate);
  const data = new Uint8Array(n * 2);
  const dv = new DataView(data.buffer);
  for (let i = 0; i < n; i++) dv.setInt16(i * 2, Math.round(Math.sin((i * freq * 2 * Math.PI) / rate) * 6000), true);
  const chunk = (id, body) => concat([latin1(id), Uint8Array.from(u32le(body.length)), body, body.length & 1 ? Uint8Array.of(0) : new Uint8Array(0)]);
  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, 1, true); fv.setUint16(2, 1, true); fv.setUint32(4, rate, true);
  fv.setUint32(8, rate * 2, true); fv.setUint16(12, 2, true); fv.setUint16(14, 16, true);
  const parts = [chunk('fmt ', fmt)];
  if (info) {
    const keys = { title: 'INAM', artist: 'IART', album: 'IPRD', track: 'ITRK' };
    const subs = Object.entries(info).filter(([k]) => keys[k]).map(([k, v]) => chunk(keys[k], concat([utf8(String(v)), Uint8Array.of(0)])));
    parts.push(chunk('LIST', concat([latin1('INFO'), ...subs])));
  }
  parts.push(chunk('data', data));
  const body = concat([latin1('WAVE'), ...parts]);
  return concat([latin1('RIFF'), Uint8Array.from(u32le(body.length)), body]);
}

/**
 * Point the app's library at `dir` and nowhere else. Call it first thing in
 * a test (before any frame runs), so the app never reads the user's Music.
 */
export function useLibrary(app, dirs) {
  app.settings.set('folders', Array.isArray(dirs) ? dirs : [dirs]);
}

useLibrary(window.app, fixtureDir({}));
