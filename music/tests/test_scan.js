// Acceptance 3: scanning a fixture music folder builds artists, albums and
// songs, with a folder-layout fallback for untagged files; covers from a
// folder picture and from an embedded one; formats bro cannot play are
// counted and left out; the index is saved for the next start.

import { app, waitFor, eq, settle, fixtureDir, clickEl } from '/lib/test.js';
import { wav, flacWithComments, id3v24, id3TextFrame, id3PictureFrame, useLibrary } from '/app/tests/fixtures.js';

const fs = require('fs');
const path = require('path');

const jpeg = bro.image.encodeJpeg(new Uint8Array(64 * 64 * 4).fill(180), 64, 64, 4, 85);
const png = bro.image.encodePng(new Uint8Array(32 * 32 * 4).fill(90), 32, 32, 4);
const frame = new Uint8Array(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);
const mp3 = (tag) => { const b = new Uint8Array(tag.length + frame.length * 4); b.set(tag); for (let i = 0; i < 4; i++) b.set(frame, tag.length + i * frame.length); return b; };

const dir = fixtureDir({
  'Aurora/First Light/01 Dawn.wav': wav(0.2, { info: { title: 'Dawn', artist: 'Aurora', album: 'First Light', track: 1 } }),
  'Aurora/First Light/02 Noon.wav': wav(0.2, { info: { title: 'Noon', artist: 'Aurora', album: 'First Light', track: 2 } }),
  'Aurora/First Light/cover.jpg': jpeg,
  'Kestrel/Untagged Album/03 - Hidden Track.wav': wav(0.2),
  'Compilation/04 Song.flac': flacWithComments({ TITLE: 'Flac One', ARTIST: 'Ørkester', ALBUM: 'Deep', TRACKNUMBER: '4' }, { seconds: 61 }),
  'Loose/tagged.mp3': mp3(id3v24([id3TextFrame('TIT2', 'Wide Ünicode', 'utf16'), id3TextFrame('TPE1', 'Mp3 Artist'),
    id3TextFrame('TALB', 'Mp3 Album'), id3TextFrame('TRCK', '9'), id3PictureFrame(png)])),
  'skip/voice.opus': new Uint8Array(64),
  'skip/song.m4a': new Uint8Array(64),
  'notes.txt': 'not music',
  '.hidden/secret.wav': wav(0.1),
});
useLibrary(app, dir);

waitFor(() => app.library.lastScan, 'the first scan', 20000);
eq(app.library.roots, [dir], 'the library is the fixture folder, nothing else');
const scan = app.library.lastScan;
eq(scan.files, 5, 'five playable files found');
eq(scan.parsed, 5, 'each read once');
eq([scan.skipped.opus, scan.skipped.m4a], [1, 1],'Opus and M4A are counted and left out');

const songs = app.library.songs();
const by = (title) => songs.find((s) => s.title === title);
eq(songs.map((s) => s.title).sort(), ['Dawn', 'Flac One', 'Hidden Track', 'Noon', 'Wide Ünicode'], 'every song, by its title');

// Tags win; the folder layout fills in for the untagged file.
const hidden = by('Hidden Track');
eq([hidden.artist, hidden.album, hidden.track], ['Kestrel', 'Untagged Album', 3], 'Artist/Album/NN - Title fallback');
eq([by('Flac One').artist, by('Flac One').album, by('Flac One').track], ['Ørkester', 'Deep', 4], 'FLAC tags');
eq(by('Flac One').duration, 61, 'the FLAC length from STREAMINFO');
assert(Math.abs(by('Dawn').duration - 0.2) < 0.01, 'the WAV length');

// Albums and artists.
const albums = app.library.albums();
eq(albums.map((a) => a.title).sort(), ['Deep', 'First Light', 'Mp3 Album', 'Untagged Album'], 'four albums');
const first = albums.find((a) => a.title === 'First Light');
eq(first.songs.map((s) => s.title), ['Dawn', 'Noon'], 'an album lists its tracks in order');
assert(first.cover && fs.existsSync(first.cover), 'the folder picture became the album cover');
const mp3Album = albums.find((a) => a.title === 'Mp3 Album');
assert(mp3Album.cover && fs.existsSync(mp3Album.cover), 'the embedded picture became the album cover');
eq(albums.find((a) => a.title === 'Deep').cover, '', 'no picture, no cover');
eq(app.library.artists().map((a) => a.name), ['Aurora', 'Kestrel', 'Mp3 Artist', 'Ørkester'], 'artists, sorted');

// The index is saved where the next start reads it.
waitFor(() => fs.existsSync(path.join(bro.app.cacheDir, 'library.json')), 'the saved index');
const saved = JSON.parse(fs.readFileSync(path.join(bro.app.cacheDir, 'library.json'), 'utf8'));
eq(saved.songs.length, 5, 'the saved index holds every song');

// The window: the album grid, the songs list, the sidebar's count.
app.go('albums');
settle(100);
waitFor(() => document.querySelectorAll('.mu-albums .vgrid-cell').length === 4, 'four album cells');
assert(document.querySelector('.mu-scan-text').textContent.includes('5 songs'), 'the sidebar counts the songs');
assert(document.querySelector('.mu-scan-text').textContent.includes('2 files Music cannot play'), 'and says what was left out');
clickEl(Array.from(document.querySelectorAll('.sidebar-item')).find((b) => b.textContent.includes('Songs')));
waitFor(() => app.state.view === 'songs' && document.querySelectorAll('.vlist-row').length === 5, 'five song rows');

// Folders: the library folder, then into one.
app.go('folders', '');
waitFor(() => app.views.folders.items.length === 4, 'the top folders');
app.go('folders', path.join(dir, 'Aurora', 'First Light'));
waitFor(() => app.views.folders.items.map((x) => x.title).join() === 'Dawn,Noon', 'a folder lists its songs');

// A cover shown in one view (an artist's row) is back in the album grid
// when the grid comes back with the same album (covers move between boxes).
app.go('albums');
waitFor(() => document.querySelector('.mu-albums .vgrid-cell img'), 'covers in the grid');
app.go('artists');
waitFor(() => document.querySelectorAll('.vlist-row .mu-art img').length >= 2, 'covers in the artist rows');
app.go('artist', app.library.artists().find((a) => a.name === 'Aurora').key);
waitFor(() => app.views.albums.items.length === 1, 'the artist page');
settle(50);
const cell = Array.from(document.querySelectorAll('.mu-albums .vgrid-cell')).find((c) => c.textContent.includes('First Light'));
assert(cell && cell.querySelector('.mu-art img'), 'the album cell shows its cover after the cover was shown elsewhere');

console.log('test_scan PASSED');
