/**
 * Vorbis comments ("TITLE=...", "ARTIST=...") as FLAC, Ogg Vorbis and Ogg
 * Opus carry them, and the FLAC picture block (in FLAC directly, in Ogg as a
 * base64 METADATA_BLOCK_PICTURE comment).
 *
 *   const { tags, picture } = readComments(bytes, offset);   // little-endian lengths
 *   const pic = readPictureBlock(bytes);                     // { mime, type, data } or null
 */

import { u32be, u32le, utf8, latin1, base64, numberPair, yearOf } from './bytes.js';
import { emptyTags } from './id3.js';

const FIELDS = {
  TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist',
  ALBUM_ARTIST: 'albumArtist', TRACKNUMBER: 'track', TRACKTOTAL: 'trackTotal', TOTALTRACKS: 'trackTotal',
  DISCNUMBER: 'disc', DISCTOTAL: 'discTotal', TOTALDISCS: 'discTotal', DATE: 'year', YEAR: 'year', GENRE: 'genre',
};

/** A FLAC METADATA_BLOCK_PICTURE body (big-endian), or null when it is cut short. */
export function readPictureBlock(b) {
  if (b.length < 32) return null;
  let o = 0;
  const type = u32be(b, o); o += 4;
  const mimeLen = u32be(b, o); o += 4;
  if (o + mimeLen > b.length) return null;
  const mime = latin1(b.subarray(o, o + mimeLen)).toLowerCase() || 'image/jpeg'; o += mimeLen;
  const descLen = u32be(b, o); o += 4 + descLen;
  o += 16;                                                         // width, height, depth, colours
  if (o + 4 > b.length) return null;
  const len = u32be(b, o); o += 4;
  if (!len || o + len > b.length) return null;
  return { mime, type, data: b.subarray(o, o + len) };
}

/**
 * The comment block at `o`: vendor string, count, then "KEY=value" entries,
 * every length little-endian. Unknown keys are ignored; repeated ARTIST
 * entries are joined with ", ".
 */
export function readComments(b, o = 0) {
  const tags = emptyTags();
  let picture = null;
  if (o + 8 > b.length) return { tags, picture };
  o += 4 + u32le(b, o);                                            // vendor
  if (o + 4 > b.length) return { tags, picture };
  const count = u32le(b, o); o += 4;
  const artists = [];
  for (let i = 0; i < count && o + 4 <= b.length; i++) {
    const len = u32le(b, o); o += 4;
    if (o + len > b.length) break;
    const entry = b.subarray(o, o + len);
    o += len;
    const eq = entry.indexOf(0x3d);                                // '='
    if (eq <= 0) continue;
    const key = latin1(entry.subarray(0, eq)).toUpperCase();
    if (key === 'METADATA_BLOCK_PICTURE') {
      const pic = readPictureBlock(base64(latin1(entry.subarray(eq + 1))));
      if (pic && (!picture || (picture.type !== 3 && pic.type === 3))) picture = pic;
      continue;
    }
    const field = FIELDS[key];
    if (!field) continue;
    const value = utf8(entry.subarray(eq + 1)).trim();
    if (!value) continue;
    if (field === 'artist') { artists.push(value); continue; }
    if (field === 'track' || field === 'disc') {
      const p = numberPair(value);
      tags[field] = p.n;
      if (p.of) tags[`${field}Total`] = p.of;
    } else if (field === 'trackTotal' || field === 'discTotal') {
      tags[field] = numberPair(value).n;
    } else if (field === 'year') {
      if (!tags.year) tags.year = yearOf(value);
    } else if (!tags[field]) {
      tags[field] = value;
    }
  }
  if (artists.length) tags.artist = artists.join(', ');
  return { tags, picture };
}
