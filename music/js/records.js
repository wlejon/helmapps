/**
 * A song as the library holds it: what its tags say, filled in from the
 * folder layout where they say nothing, plus the keys the views sort and
 * search by. Built in the scan worker; the page only reads it.
 *
 *   { path, size, mtime, format, title, artist, album, albumArtist, track,
 *     disc, year, genre, duration, cover, coverSrc, embedded,
 *     albumKey, tKey, aKey, lKey, search }
 */

import { fromLayout } from './tags/index.js';

/** The formats bro plays (createStreamFromFile). Opus and M4A do not decode (GAPS.md). */
export const PLAYABLE = new Set(['mp3', 'flac', 'ogg', 'oga', 'wav']);
/** Music files bro cannot play: counted, so the window can say they were left out. */
export const UNPLAYABLE = new Set(['opus', 'm4a', 'aac', 'wma', 'alac', 'aiff', 'aif', 'ape', 'wv', 'mpc']);

export const UNKNOWN_ARTIST = 'Unknown Artist';
export const UNKNOWN_ALBUM = 'Unknown Album';

/** A sort key: lower case, a leading "The " or "A " dropped, so "The Beatles" sorts under B. */
export function sortKey(s) {
  return String(s || '').toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
}

/**
 * The record for a file: `tags` from readTags (or null when unreadable),
 * `rel` its path inside the library folder.
 */
export function makeRecord(file, rel, tags) {
  const lay = fromLayout(rel);
  const t = tags || {};
  const artist = t.artist || lay.artist;
  const albumArtist = t.albumArtist || '';
  const album = t.album || lay.album;
  const r = {
    path: file.path,
    size: file.size,
    mtime: file.mtime,
    format: t.format || '',
    title: t.title || lay.title,
    artist,
    album,
    albumArtist,
    track: t.track || lay.track || 0,
    disc: t.disc || lay.disc || 0,
    year: t.year || 0,
    genre: t.genre || '',
    duration: Math.round((t.duration || 0) * 1000) / 1000,
    cover: '',
    coverSrc: '',
    embedded: false,
  };
  return withKeys(r);
}

/** The derived keys (kept in step with the fields they come from). */
export function withKeys(r) {
  const albumArtist = r.albumArtist || r.artist;
  r.albumKey = `${(r.album || '').toLowerCase()}\u0001${albumArtist.toLowerCase()}`;
  r.tKey = sortKey(r.title);
  r.aKey = sortKey(r.artist || '￿');
  r.lKey = sortKey(r.album || '￿');
  r.search = `${r.title}\n${r.artist}\n${r.album}\n${r.albumArtist}`.toLowerCase();
  return r;
}

/** FNV-1a over a string, as 8 hex digits: cover file names. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** FNV-1a over bytes (a sample of them for big pictures). */
export function hashBytes(b) {
  let h = 0x811c9dc5;
  const step = b.length > 65536 ? Math.floor(b.length / 16384) : 1;
  for (let i = 0; i < b.length; i += step) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= b.length;
  h = Math.imul(h, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
