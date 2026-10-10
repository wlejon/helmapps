/**
 * A song as the library holds it: what its tags say, filled in from the
 * folder layout where they say nothing, plus the keys the views sort and
 * search by. Built in the scan worker; the page only reads it.
 *
 *   { path, size, mtime, format, title, artist, album, albumArtist, track,
 *     disc, year, genre, duration, cover, coverSrc, embedded,
 *     albumKey, tKey, aKey, lKey, search }
 */

/**
 * M4A (AAC) plays through the platform's AAC decoder: Media Foundation on
 * Windows, AudioToolbox on macOS. bro has none on Linux (docs/audio-engine-api.js,
 * createStreamFromFile), so there M4A is counted and left out like WMA.
 */
const AAC = typeof require === 'function' && require('os').platform() !== 'linux';
const M4A = ['m4a', 'm4b'];

/** The formats bro plays (createStreamFromFile). */
export const PLAYABLE = new Set(['mp3', 'flac', 'ogg', 'oga', 'opus', 'wav', ...(AAC ? M4A : [])]);
/** Music files bro cannot play: counted, so the window can say they were left out. */
export const UNPLAYABLE = new Set(['aac', 'wma', 'alac', 'aiff', 'aif', 'ape', 'wv', 'mpc', ...(AAC ? [] : M4A)]);

export const UNKNOWN_ARTIST = 'Unknown Artist';
export const UNKNOWN_ALBUM = 'Unknown Album';

/** A sort key: lower case, a leading "The " or "A " dropped, so "The Beatles" sorts under B. */
export function sortKey(s) {
  return String(s || '').toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
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

/**
 * The record for a file: `tags` from bro.media.tags (or null when
 * unreadable), `rel` its path inside the library folder.
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
    format: t.codec || '',
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
