// Acceptance 1: the ID3v2.4 parser reads title, artist, album and track from
// a handcrafted tag, including UTF-16 text frames; and the rest of what MP3
// files carry: ID3v2.3 sizes, unsynchronisation, a cover, ID3v1, the length.

import { eq } from '/lib/test.js';
import { readTags, bytesReader } from '/app/js/tags/index.js';
import { readId3v2, readId3v1, unsync } from '/app/js/tags/id3.js';
import { readMp3 } from '/app/js/tags/mp3.js';
import { id3v24, id3TextFrame, id3PictureFrame } from '/app/tests/fixtures.js';

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---- ID3v2.4, every text encoding ----------------------------------------------------
const picture = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
const tag = id3v24([
  id3TextFrame('TIT2', 'Ünïcode Söng ♪', 'utf16'),        // UTF-16 with a byte-order mark
  id3TextFrame('TPE1', 'Björk', 'utf16be'),                // UTF-16BE, no BOM
  id3TextFrame('TALB', 'Café Album', 'latin1'),
  id3TextFrame('TPE2', 'Various Ärtists', 'utf8'),
  id3TextFrame('TRCK', '3/12', 'latin1'),
  id3TextFrame('TPOS', '2/2', 'utf8'),
  id3TextFrame('TDRC', '2021-05-03', 'utf8'),
  id3PictureFrame(picture),
]);
const t = readId3v2(bytesReader(tag));
assert(t, 'the tag is found');
eq(t.tags.title, 'Ünïcode Söng ♪', 'title (UTF-16 with BOM)');
eq(t.tags.artist, 'Björk', 'artist (UTF-16BE)');
eq(t.tags.album, 'Café Album', 'album (Latin-1)');
eq(t.tags.albumArtist, 'Various Ärtists', 'album artist (UTF-8)');
eq([t.tags.track, t.tags.trackTotal], [3, 12], 'track 3 of 12');
eq([t.tags.disc, t.tags.discTotal], [2, 2], 'disc 2 of 2');
eq(t.tags.year, 2021, 'year from TDRC');
eq(t.size, tag.length, 'the tag knows its own length');
assert(t.picture && t.picture.mime === 'image/png' && t.picture.type === 3, 'the front cover is found');
eq(Array.from(t.picture.data), Array.from(picture), 'the picture bytes are intact');

// The same tag in front of an MP3 frame, through the format sniffer.
const frame = new Uint8Array(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);                       // MPEG-1 layer III, 128 kbps, 44.1 kHz
const frames = concat(...Array.from({ length: 8 }, () => frame));
const mp3 = concat(tag, frames);
const all = readTags(bytesReader(mp3), 'mp3');
eq(all.format, 'mp3', 'sniffed as MP3');
eq([all.title, all.artist, all.album, all.track], ['Ünïcode Söng ♪', 'Björk', 'Café Album', 3], 'readTags gives the same fields');
const expect = (frames.length * 8) / 128000;
assert(Math.abs(all.duration - expect) < 0.01, `CBR length from the bit rate: ${all.duration} vs ${expect}`);

// v2.4 values separated by a zero: several artists.
const multi = readId3v2(bytesReader(id3v24([id3TextFrame('TPE1', 'One\u0000Two', 'utf8')])));
eq(multi.tags.artist, 'One, Two', 'several artists are joined');

// ---- ID3v2.3: plain frame sizes, UTF-16 per value ------------------------------------------
function frame23(id, enc, body) {
  const data = concat(Uint8Array.of(enc), body);
  const n = data.length;
  return concat(Uint8Array.from([...id].map((c) => c.charCodeAt(0))), Uint8Array.of(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, 0, 0), data);
}
const utf16le = (s) => Uint8Array.from([0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
const body23 = concat(frame23('TIT2', 1, utf16le('Wide Title')), frame23('TPE1', 0, Uint8Array.from([...'Plain'].map((c) => c.charCodeAt(0)))),
  frame23('TRCK', 0, Uint8Array.of(0x37)), frame23('TYER', 0, Uint8Array.from([...'1999'].map((c) => c.charCodeAt(0)))));
const ss = (n) => Uint8Array.of((n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127);
const tag23 = concat(Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0), ss(body23.length), body23);
const t23 = readId3v2(bytesReader(tag23));
eq([t23.tags.title, t23.tags.artist, t23.tags.track, t23.tags.year], ['Wide Title', 'Plain', 7, 1999], 'ID3v2.3');

// Unsynchronisation: FF 00 comes back as FF.
eq(Array.from(unsync(Uint8Array.of(1, 0xff, 0, 2, 0xff, 0, 0))), [1, 0xff, 2, 0xff, 0], 'unsync undone');

// ---- ID3v1 at the end, filling what v2 left empty ----------------------------------------------
const v1 = new Uint8Array(128);
v1.set([0x54, 0x41, 0x47]);
const put = (o, s) => { for (let i = 0; i < s.length; i++) v1[o + i] = s.charCodeAt(i); };
put(3, 'Old Title'); put(33, 'Old Artist'); put(63, 'Old Album'); put(93, '1987');
v1[125] = 0; v1[126] = 5;
const r1 = readId3v1(bytesReader(concat(frames, v1)));
eq([r1.title, r1.artist, r1.album, r1.year, r1.track], ['Old Title', 'Old Artist', 'Old Album', 1987, 5], 'ID3v1.1');
const both = readMp3(bytesReader(concat(id3v24([id3TextFrame('TIT2', 'New', 'utf8')]), frames, v1)));
eq([both.tags.title, both.tags.artist], ['New', 'Old Artist'], 'v2 wins, v1 fills the gaps');

// ---- a Xing header: the length of a variable-bit-rate file ------------------------------------
const xing = new Uint8Array(417);
xing.set([0xff, 0xfb, 0x90, 0x64]);
xing.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0, 0, 0x03, 0xe8], 4 + 32);     // 'Xing', frames flag, 1000 frames
const vbr = readMp3(bytesReader(concat(xing, frames)));
assert(Math.abs(vbr.duration - (1000 * 1152) / 44100) < 0.001, `Xing frame count gives the length: ${vbr.duration}`);

// Garbage is not a tag.
eq(readId3v2(bytesReader(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))), null, 'no tag in garbage');
eq(readTags(bytesReader(new Uint8Array(64)), 'mp3').title, '', 'an unreadable file gives empty tags, not an exception');

console.log('test_tags_id3 PASSED');
