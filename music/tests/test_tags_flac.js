// Acceptance 2: the FLAC Vorbis-comment parser reads title, artist, album
// and track; and the same comments in Ogg Vorbis and Ogg Opus, the FLAC
// picture block, WAV INFO tags, and the folder-layout fallback.

import { eq } from '/lib/test.js';
import { readTags, bytesReader, fromLayout } from '/app/js/tags/index.js';
import { readFlac } from '/app/js/tags/flac.js';
import { readOgg } from '/app/js/tags/ogg.js';
import { readComments, readPictureBlock } from '/app/js/tags/vorbis.js';
import { flacWithComments, vorbisComment, wav } from '/app/tests/fixtures.js';

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const be32 = (n) => Uint8Array.of(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255);
const le32 = (n) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24);

// ---- FLAC ---------------------------------------------------------------------------------
const fields = { TITLE: 'Flüte Song', ARTIST: 'Ørkester', ALBUM: 'Ünder Water', TRACKNUMBER: '4', TRACKTOTAL: '9',
  DISCNUMBER: '1/2', DATE: '2019-04-01', ALBUMARTIST: 'The Band' };
const flac = flacWithComments(fields, { seconds: 125.5, rate: 48000 });
const f = readFlac(bytesReader(flac));
assert(f, 'a FLAC is recognised');
eq(f.tags.title, 'Flüte Song', 'title');
eq(f.tags.artist, 'Ørkester', 'artist');
eq(f.tags.album, 'Ünder Water', 'album');
eq([f.tags.track, f.tags.trackTotal], [4, 9], 'track 4 of 9');
eq([f.tags.disc, f.tags.discTotal], [1, 2], 'disc 1/2');
eq(f.tags.year, 2019, 'year from DATE');
eq(f.tags.albumArtist, 'The Band', 'album artist');
eq(f.sampleRate, 48000, 'STREAMINFO sample rate');
assert(Math.abs(f.duration - 125.5) < 0.001, `STREAMINFO length: ${f.duration}`);
eq(readTags(bytesReader(flac), 'flac').format, 'flac', 'sniffed as FLAC');

// Keys are case-insensitive and repeated artists join.
const vc = readComments(vorbisComment({ title: 'lower', Artist: 'A', ARTIST: 'B' }));
eq([vc.tags.title, vc.tags.artist], ['lower', 'A, B'], 'case-insensitive keys, repeated artists');

// A PICTURE block (type 6) after the comments.
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9);
const pictureBody = concat(be32(3), be32(9), ascii('image/png'), be32(0), be32(1), be32(1), be32(24), be32(0), be32(png.length), png);
const withPic = concat(flac.subarray(0, flac.length), Uint8Array.of(6, 0, 0, pictureBody.length), pictureBody);
withPic[4 + 4 + 34] &= 0x7f;                                       // the comment block is no longer the last
withPic[withPic.length - pictureBody.length - 4] = 0x86;            // the picture is
const fp = readFlac(bytesReader(withPic));
assert(fp.picture && fp.picture.mime === 'image/png', 'the FLAC picture block is read');
eq(Array.from(fp.picture.data), Array.from(png), 'picture bytes');
eq(readPictureBlock(pictureBody).type, 3, 'front cover type');

// ---- Ogg Vorbis and Ogg Opus: comments in the second packet --------------------------------
function oggPage(serial, seq, granule, packets, flags = 0) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  }
  return concat(ascii('OggS'), Uint8Array.of(0, flags), le32(granule), le32(0), le32(serial), le32(seq), le32(0),
    Uint8Array.of(lacing.length), Uint8Array.from(lacing), ...packets);
}
const vorbisId = concat(Uint8Array.of(1), ascii('vorbis'), le32(0), Uint8Array.of(2), le32(44100), new Uint8Array(13));
const vorbisTags = concat(Uint8Array.of(3), ascii('vorbis'), vorbisComment({ TITLE: 'Ogg Title', ARTIST: 'Ogg Artist', ALBUM: 'Ogg Album', TRACKNUMBER: '2' }), Uint8Array.of(1));
const ogg = concat(oggPage(7, 0, 0, [vorbisId], 2), oggPage(7, 1, 0, [vorbisTags]), oggPage(7, 2, 44100 * 3, [new Uint8Array(40)], 4));
const o = readOgg(bytesReader(ogg));
eq(o.codec, 'vorbis', 'Ogg Vorbis');
eq([o.tags.title, o.tags.artist, o.tags.album, o.tags.track], ['Ogg Title', 'Ogg Artist', 'Ogg Album', 2], 'Vorbis comments');
assert(Math.abs(o.duration - 3) < 0.001, `length from the last granule: ${o.duration}`);

// A comment packet spread over two pages (a big picture does this).
const big = concat(Uint8Array.of(3), ascii('vorbis'), vorbisComment({ TITLE: 'Long', COMMENT: 'x'.repeat(600) }), Uint8Array.of(1));
const firstPart = big.subarray(0, 255 * 2);
const page2 = concat(ascii('OggS'), Uint8Array.of(0, 0), le32(0), le32(0), le32(7), le32(1), le32(0), Uint8Array.of(2, 255, 255), firstPart);
const page3 = oggPage(7, 2, 0, [big.subarray(255 * 2)], 1);
const spread = readOgg(bytesReader(concat(oggPage(7, 0, 0, [vorbisId], 2), page2, page3)));
eq(spread.tags.title, 'Long', 'a comment packet over two pages is put back together');

const opusHead = concat(ascii('OpusHead'), Uint8Array.of(1, 2, 0x38, 0x01), le32(48000), Uint8Array.of(0, 0, 0));
const opusTags = concat(ascii('OpusTags'), vorbisComment({ TITLE: 'Opus Title', ARTIST: 'Opus Artist', TRACKNUMBER: '5/6' }));
const opus = concat(oggPage(9, 0, 0, [opusHead], 2), oggPage(9, 1, 0, [opusTags]), oggPage(9, 2, 48000 * 2 + 312, [new Uint8Array(20)], 4));
const op = readTags(bytesReader(opus), 'opus');
eq(op.format, 'opus', 'Ogg Opus is told apart from Vorbis');
eq([op.title, op.artist, op.track], ['Opus Title', 'Opus Artist', 5], 'Opus tags');
assert(Math.abs(op.duration - 2) < 0.001, `Opus length less its pre-skip: ${op.duration}`);

// ---- WAV INFO ---------------------------------------------------------------------------------
const w = readTags(bytesReader(wav(0.25, { info: { title: 'Wav Title', artist: 'Wav Artist', album: 'Wav Album', track: 11 } })), 'wav');
eq([w.format, w.title, w.artist, w.album, w.track], ['wav', 'Wav Title', 'Wav Artist', 'Wav Album', 11], 'WAV LIST/INFO');
assert(Math.abs(w.duration - 0.25) < 0.001, `WAV length: ${w.duration}`);

// ---- the folder layout, for untagged files ------------------------------------------------------
eq(fromLayout('Nina Simone/Pastel Blues/03 - Be My Husband.flac'),
  { artist: 'Nina Simone', album: 'Pastel Blues', title: 'Be My Husband', track: 3, disc: 0 }, 'Artist/Album/NN - Title');
eq(fromLayout('Album Only/07 Title Here.mp3'), { artist: '', album: 'Album Only', title: 'Title Here', track: 7, disc: 0 }, 'Album/NN Title');
eq(fromLayout('A/B/2-05 Disc Two.ogg').disc, 2, 'disc-track prefix');
eq(fromLayout('loose_file.wav').title, 'loose file', 'a loose file is only a title');

console.log('test_tags_flac PASSED');
