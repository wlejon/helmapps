// Acceptance 1: MP3 tags through bro.media.tags (the scan worker's reader):
// an ID3v2.4 tag with title, artist, album and track in every text encoding,
// a cover; ID3v2.3 sizes, unsynchronisation, ID3v1, the length (CBR and a
// Xing header); garbage is null, not an exception.

import { eq, fixtureDir } from '/lib/test.js';
import { id3v24, id3TextFrame, id3PictureFrame } from '/app/tests/fixtures.js';

const path = require('path');

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

// ---- ID3v2.4, every text encoding, in front of eight CBR frames -----------------------------
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
const frame = new Uint8Array(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);                       // MPEG-1 layer III, 128 kbps, 44.1 kHz
const frames = concat(...Array.from({ length: 8 }, () => frame));

// ---- ID3v2.3: plain frame sizes, UTF-16 per value; and whole-tag unsynchronisation ----------
function frame23(id, enc, body) {
  const data = concat(Uint8Array.of(enc), body);
  const n = data.length;
  return concat(ascii(id), Uint8Array.of(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, 0, 0), data);
}
const utf16le = (s) => Uint8Array.from([0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
const ss = (n) => Uint8Array.of((n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127);
const body23 = concat(frame23('TIT2', 1, utf16le('Wide Title')), frame23('TPE1', 0, ascii('Plain')),
  frame23('TRCK', 0, Uint8Array.of(0x37)), frame23('TYER', 0, ascii('1999')));
const tag23 = concat(ascii('ID3'), Uint8Array.of(3, 0, 0), ss(body23.length), body23);
// "A\xffB" as Latin-1, written unsynchronised (FF 00): the reader gives back FF.
const unsyncBody = concat(frame23('TIT2', 0, Uint8Array.of(0x41, 0xff, 0x00, 0x42)), new Uint8Array(8));
unsyncBody.set([0, 0, 0, 4], 4);                           // the frame's size before unsynchronisation
const tagUnsync = concat(ascii('ID3'), Uint8Array.of(3, 0, 0x80), ss(unsyncBody.length), unsyncBody);

// ---- ID3v1 at the end, filling what v2 left empty -------------------------------------------
const v1 = new Uint8Array(128);
v1.set([0x54, 0x41, 0x47]);
const put = (o, s) => { for (let i = 0; i < s.length; i++) v1[o + i] = s.charCodeAt(i); };
put(3, 'Old Title'); put(33, 'Old Artist'); put(63, 'Old Album'); put(93, '1987');
v1[125] = 0; v1[126] = 5;

// ---- a Xing header: the length of a variable-bit-rate file ----------------------------------
const xing = new Uint8Array(417);
xing.set([0xff, 0xfb, 0x90, 0x64]);
xing.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0, 0, 0x03, 0xe8], 4 + 32);     // 'Xing', frames flag, 1000 frames

const dir = fixtureDir({
  'v24.mp3': concat(tag, frames),
  'multi.mp3': concat(id3v24([id3TextFrame('TPE1', 'One\u0000Two', 'utf8')]), frames),
  'v23.mp3': concat(tag23, frames),
  'unsync.mp3': concat(tagUnsync, frames),
  'v1.mp3': concat(frames, v1),
  'both.mp3': concat(id3v24([id3TextFrame('TIT2', 'New', 'utf8')]), frames, v1),
  'vbr.mp3': concat(xing, frames),
  'garbage.mp3': Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
  'zeros.mp3': new Uint8Array(64),
});
const tags = (name) => bro.media.tags(path.join(dir, name));

const t = tags('v24.mp3');
assert(t, 'the tag is read');
eq(t.title, 'Ünïcode Söng ♪', 'title (UTF-16 with BOM)');
eq(t.artist, 'Björk', 'artist (UTF-16BE)');
eq(t.album, 'Café Album', 'album (Latin-1)');
eq(t.albumArtist, 'Various Ärtists', 'album artist (UTF-8)');
eq([t.track, t.trackTotal], [3, 12], 'track 3 of 12');
eq([t.disc, t.discTotal], [2, 2], 'disc 2 of 2');
eq(t.year, 2021, 'year from TDRC');
eq(t.codec, 'mp3', 'an MP3');
assert(t.picture && t.picture.mime === 'image/png', 'the front cover is found');
eq(Array.from(t.picture.bytes), Array.from(picture), 'the picture bytes are intact');
const expect = (frames.length * 8) / 128000;
assert(Math.abs(t.duration - expect) < 0.01, `CBR length from the bit rate: ${t.duration} vs ${expect}`);

eq(tags('multi.mp3').artist, 'One, Two', 'several artists (v2.4 zero-separated) are joined');

const t23 = tags('v23.mp3');
eq([t23.title, t23.artist, t23.track, t23.year], ['Wide Title', 'Plain', 7, 1999], 'ID3v2.3');
eq(tags('unsync.mp3').title, 'AÿB', 'unsynchronisation undone: FF 00 comes back as FF');

const r1 = tags('v1.mp3');
eq([r1.title, r1.artist, r1.album, r1.year, r1.track], ['Old Title', 'Old Artist', 'Old Album', 1987, 5], 'ID3v1.1');
const both = tags('both.mp3');
eq([both.title, both.artist], ['New', 'Old Artist'], 'v2 wins, v1 fills the gaps');

const vbr = tags('vbr.mp3');
assert(Math.abs(vbr.duration - (1000 * 1152) / 44100) < 0.001, `Xing frame count gives the length: ${vbr.duration}`);

eq(tags('garbage.mp3'), null, 'no tag in garbage');
eq(tags('zeros.mp3'), null, 'an unreadable file is null, not an exception');
eq(tags('missing.mp3'), null, 'a missing file is null');

console.log('test_tags_id3 PASSED');
