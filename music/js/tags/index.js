/**
 * Reading a music file's tags, picture and length. bro has no tag API
 * (GAPS.md), so this is the app's own file-format parsing: ID3v2/ID3v1
 * (MP3), FLAC metadata blocks, Ogg Vorbis / Opus comments and WAV INFO.
 *
 *   import { readTags, fromLayout } from './tags/index.js';
 *   const t = readTags(reader, 'flac');
 *   // { title, artist, album, albumArtist, track, trackTotal, disc, discTotal,
 *   //   year, genre, duration (s), picture: { mime, type, data } | null }
 *   fromLayout('Artist/Album/03 Song.mp3')   // what the folders say, for untagged files
 *
 * The format is found from the bytes, so a file with the wrong extension
 * still reads; the extension only says which to try first.
 */

import { isAscii } from './bytes.js';
import { readMp3 } from './mp3.js';
import { readFlac } from './flac.js';
import { readOgg } from './ogg.js';
import { readWav } from './wav.js';
import { emptyTags, id3Size } from './id3.js';

export { bytesReader, fileReader } from './bytes.js';

/** Which parser the first bytes ask for. */
function sniff(r) {
  const b = r.read(0, 12);
  if (isAscii(b, 0, 'fLaC')) return 'flac';
  if (isAscii(b, 0, 'OggS')) return 'ogg';
  if (isAscii(b, 0, 'RIFF') && isAscii(b, 8, 'WAVE')) return 'wav';
  if (isAscii(b, 0, 'ID3')) {
    // A FLAC can hide behind an ID3v2 tag too.
    const after = r.read(id3Size(b), 4);
    return isAscii(after, 0, 'fLaC') ? 'flac' : 'mp3';
  }
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
  return '';
}

const PARSERS = { mp3: readMp3, flac: readFlac, ogg: readOgg, wav: readWav };

export function readTags(r, ext = '') {
  const kind = sniff(r) || ({ oga: 'ogg', opus: 'ogg' }[ext] || ext);
  const parse = PARSERS[kind];
  const res = parse ? parse(r) : null;
  const t = res ? res.tags : emptyTags();
  const format = !res ? '' : kind === 'ogg' && res.codec === 'opus' ? 'opus' : kind;
  return { ...t, duration: res ? res.duration || 0 : 0, picture: res ? res.picture : null, format };
}

/**
 * Artist, album, track and title as the folders lay them out:
 * "Artist/Album/03 - Title.ext" (relative to the library folder). A file
 * directly in an album folder has no artist; a loose file only a title.
 */
export function fromLayout(rel) {
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  const file = parts.pop() || '';
  const base = file.replace(/\.[^.]+$/, '');
  const m = /^(?:(\d{1,2})[-.](\d{1,3})|(\d{1,3}))(?:\s*[-._]\s*|\s+)(.+)$/.exec(base);
  let track = 0, disc = 0, title = base;
  if (m) {
    if (m[1]) { disc = Number(m[1]); track = Number(m[2]); } else track = Number(m[3]);
    title = m[4].trim();
  }
  return {
    artist: parts.length >= 2 ? parts[parts.length - 2] : '',
    album: parts.length >= 1 ? parts[parts.length - 1] : '',
    title: title.replace(/_/g, ' ').trim() || base,
    track,
    disc,
  };
}
