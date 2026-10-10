// Acceptance 2: FLAC Vorbis comments through bro.media.tags (title, artist,
// album, track); the same comments in Ogg Vorbis and Ogg Opus, the FLAC
// picture block, WAV INFO tags, M4A ilst atoms; and the folder-layout
// fallback for untagged files.

import { eq, fixtureDir } from '/lib/test.js';
import { fromLayout } from '/app/js/records.js';
import { flacWithComments, vorbisComment, wav } from '/app/tests/fixtures.js';

const path = require('path');

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const utf8 = (s) => new TextEncoder().encode(s);
const be32 = (n) => Uint8Array.of(n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255);
const be16 = (n) => Uint8Array.of((n >> 8) & 255, n & 255);
const le32 = (n) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24);

// ---- FLAC ---------------------------------------------------------------------------------
const fields = { TITLE: 'Flüte Song', ARTIST: 'Ørkester', ALBUM: 'Ünder Water', TRACKNUMBER: '4', TRACKTOTAL: '9',
  DISCNUMBER: '1/2', DATE: '2019-04-01', ALBUMARTIST: 'The Band' };
const flac = flacWithComments(fields, { seconds: 125.5, rate: 48000 });

// A PICTURE block (type 6) after the comments.
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9);
const pictureBody = concat(be32(3), be32(9), ascii('image/png'), be32(0), be32(1), be32(1), be32(24), be32(0), be32(png.length), png);
const withPic = concat(flac, Uint8Array.of(6, 0, 0, pictureBody.length), pictureBody);
withPic[4 + 4 + 34] &= 0x7f;                                       // the comment block is no longer the last
withPic[withPic.length - pictureBody.length - 4] = 0x86;            // the picture is

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

// A comment packet spread over two pages (a big picture does this).
const big = concat(Uint8Array.of(3), ascii('vorbis'), vorbisComment({ TITLE: 'Long', COMMENT: 'x'.repeat(600) }), Uint8Array.of(1));
const firstPart = big.subarray(0, 255 * 2);
const page2 = concat(ascii('OggS'), Uint8Array.of(0, 0), le32(0), le32(0), le32(7), le32(1), le32(0), Uint8Array.of(2, 255, 255), firstPart);
const page3 = oggPage(7, 2, 0, [big.subarray(255 * 2)], 1);

const opusHead = concat(ascii('OpusHead'), Uint8Array.of(1, 2, 0x38, 0x01), le32(48000), Uint8Array.of(0, 0, 0));
const opusTags = concat(ascii('OpusTags'), vorbisComment({ TITLE: 'Opus Title', ARTIST: 'Opus Artist', TRACKNUMBER: '5/6' }));
const opus = concat(oggPage(9, 0, 0, [opusHead], 2), oggPage(9, 1, 0, [opusTags]), oggPage(9, 2, 48000 * 2 + 312, [new Uint8Array(20)], 4));

// ---- M4A: moov/udta/meta/ilst, the length from mdhd (no audio: tags only) -------------------
const box = (type, ...body) => { const b = concat(...body); return concat(be32(b.length + 8), ascii(type), b); };
const full = (type, ...body) => box(type, Uint8Array.of(0, 0, 0, 0), ...body);
const text = (name, s) => box(name, box('data', be32(1), be32(0), utf8(s)));
const pair = (name, n, of) => box(name, box('data', be32(0), be32(0), be16(0), be16(n), be16(of), be16(0)));
const ilst = box('ilst', text('©nam', 'M4A Song'), text('©ART', 'M4A Artist'), text('©alb', 'M4A Album'),
  pair('trkn', 6, 10), text('©day', '2018'), box('covr', box('data', be32(14), be32(0), png)));
const mdia = box('mdia', full('mdhd', be32(0), be32(0), be32(44100), be32(44100 * 3), new Uint8Array(4)),
  full('hdlr', be32(0), ascii('soun'), new Uint8Array(13)));
const m4a = concat(box('ftyp', ascii('M4A '), be32(0)),
  box('moov', full('mvhd', be32(0), be32(0), be32(1000), be32(3000), new Uint8Array(80)), box('trak', mdia),
      box('udta', full('meta', full('hdlr', be32(0), ascii('mdir'), new Uint8Array(13)), ilst))));

const dir = fixtureDir({
  'song.flac': flac,
  'pic.flac': withPic,
  'song.ogg': ogg,
  'spread.ogg': concat(oggPage(7, 0, 0, [vorbisId], 2), page2, page3),
  'song.opus': opus,
  'song.wav': wav(0.25, { info: { title: 'Wav Title', artist: 'Wav Artist', album: 'Wav Album', track: 11 } }),
  'song.m4a': m4a,
});
const tags = (name) => bro.media.tags(path.join(dir, name));

const f = tags('song.flac');
assert(f, 'a FLAC is recognised');
eq(f.title, 'Flüte Song', 'title');
eq(f.artist, 'Ørkester', 'artist');
eq(f.album, 'Ünder Water', 'album');
eq([f.track, f.trackTotal], [4, 9], 'track 4 of 9');
eq([f.disc, f.discTotal], [1, 2], 'disc 1/2');
eq(f.year, 2019, 'year from DATE');
eq(f.albumArtist, 'The Band', 'album artist');
eq(f.sampleRate, 48000, 'STREAMINFO sample rate');
eq(f.codec, 'flac', 'a FLAC');
assert(Math.abs(f.duration - 125.5) < 0.001, `STREAMINFO length: ${f.duration}`);

const fp = tags('pic.flac');
assert(fp.picture && fp.picture.mime === 'image/png', 'the FLAC picture block is read');
eq(Array.from(fp.picture.bytes), Array.from(png), 'picture bytes');

const o = tags('song.ogg');
eq(o.codec, 'vorbis', 'Ogg Vorbis');
eq([o.title, o.artist, o.album, o.track], ['Ogg Title', 'Ogg Artist', 'Ogg Album', 2], 'Vorbis comments');
assert(Math.abs(o.duration - 3) < 0.001, `length from the last granule: ${o.duration}`);
eq(tags('spread.ogg').title, 'Long', 'a comment packet over two pages is put back together');

const op = tags('song.opus');
eq(op.codec, 'opus', 'Ogg Opus is told apart from Vorbis');
eq([op.title, op.artist, op.track], ['Opus Title', 'Opus Artist', 5], 'Opus tags');
assert(Math.abs(op.duration - 2) < 0.001, `Opus length less its pre-skip: ${op.duration}`);

const w = tags('song.wav');
eq([w.codec, w.title, w.artist, w.album, w.track], ['pcm', 'Wav Title', 'Wav Artist', 'Wav Album', 11], 'WAV LIST/INFO');
assert(Math.abs(w.duration - 0.25) < 0.001, `WAV length: ${w.duration}`);

const m = tags('song.m4a');
assert(m, 'an M4A is recognised');
eq([m.title, m.artist, m.album, m.track, m.trackTotal, m.year], ['M4A Song', 'M4A Artist', 'M4A Album', 6, 10, 2018], 'M4A ilst atoms');
assert(Math.abs(m.duration - 3) < 0.001, `M4A length from mdhd: ${m.duration}`);
assert(m.picture && m.picture.mime === 'image/png', 'the covr atom');
eq(Array.from(m.picture.bytes), Array.from(png), 'covr bytes');

// ---- the folder layout, for untagged files ------------------------------------------------------
eq(fromLayout('Nina Simone/Pastel Blues/03 - Be My Husband.flac'),
  { artist: 'Nina Simone', album: 'Pastel Blues', title: 'Be My Husband', track: 3, disc: 0 }, 'Artist/Album/NN - Title');
eq(fromLayout('Album Only/07 Title Here.mp3'), { artist: '', album: 'Album Only', title: 'Title Here', track: 7, disc: 0 }, 'Album/NN Title');
eq(fromLayout('A/B/2-05 Disc Two.ogg').disc, 2, 'disc-track prefix');
eq(fromLayout('loose_file.wav').title, 'loose file', 'a loose file is only a title');

console.log('test_tags_flac PASSED');
