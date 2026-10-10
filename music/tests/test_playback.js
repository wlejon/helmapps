// Acceptance 5: Play sets the now-playing title; Next and Prev follow the
// queue; Prev restarts a song more than 3 s in; repeat-one stays on the
// song at its end (virtual time); with repeat off the queue advances by
// itself and stops after the last song. Space toggles play.

import { app, waitFor, eq, settle, fixtureDir, dblClickEl, clickEl, press, mod } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

const long = (t, title) => wav(4.5, { freq: 220 + t * 50, info: { title, artist: 'Band', album: 'Record', track: t } });
const dir = fixtureDir({
  'Band/Record/01.wav': long(1, 'One'),
  'Band/Record/02.wav': long(2, 'Two'),
  'Band/Record/03.wav': long(3, 'Three'),
  'Band/Short/01.wav': wav(0.4, { info: { title: 'Blip', artist: 'Band', album: 'Short', track: 1 } }),
  'Band/Short/02.wav': wav(0.4, { info: { title: 'Blop', artist: 'Band', album: 'Short', track: 2 } }),
});
useLibrary(app, dir);
waitFor(() => app.library.lastScan && app.library.albums().length === 2, 'the scan');

const player = app.player;
const title = () => document.querySelector('.mu-np-title').textContent;
const playing = () => player.current && player.current.title;
eq(player.state, 'stopped', 'nothing plays at first');

// Double-click the second track of an album: it plays, the album is the queue.
const record = app.library.albums().find((a) => a.title === 'Record');
app.go('album', record.key);
waitFor(() => document.querySelectorAll('.vlist-row').length === 3, 'the album page');
dblClickEl(document.querySelectorAll('.vlist-row')[1]);
waitFor(() => player.playing && title() === 'Two', 'Two to play');
eq(player.queue.paths().length, 3, 'the album is the queue');
eq(player.queue.index, 1, 'from the song that was clicked');
waitFor(() => document.querySelector('.vlist-row.mu-playing'), 'the playing row is marked');
assert(document.querySelector('.vlist-row.mu-playing').textContent.includes('Two'), 'on the right row');

// The position moves with (virtual) time.
settle(300);
assert(player.readPosition() > 0.1, `the song plays on: ${player.readPosition()}`);

// Next and Prev.
press(`${mod}+right`);
waitFor(() => title() === 'Three', 'Next to play Three');
press(`${mod}+left`);
waitFor(() => title() === 'Two', 'Prev to go back to Two');

// More than 3 s in, Prev restarts the song.
player.seek(3.5);
waitFor(() => player.readPosition() > 3.5, 'the seek');
press(`${mod}+left`);
waitFor(() => player.readPosition() < 1, 'Prev to restart the song');
eq(playing(), 'Two', 'and stay on it');

// Space pauses and plays (focus is not in a text field).
document.activeElement && document.activeElement.blur && document.activeElement.blur();
press('space');
waitFor(() => player.state === 'paused', 'Space to pause');
const at = player.readPosition();
settle(200);
assert(Math.abs(player.readPosition() - at) < 0.05, 'a paused song does not move');
clickEl(document.querySelector('.mu-np-play'));
waitFor(() => player.playing, 'the bar\'s play button to play');

// The media keys, by the names bro gives them.
const media = (name) => { keyDown(name); keyUp(name); advanceTime(16); };
media('MediaPlayPause');
waitFor(() => player.state === 'paused', 'MediaPlayPause to pause');
media('MediaPlayPause');
waitFor(() => player.playing, 'MediaPlayPause to play');
media('MediaTrackNext');
waitFor(() => title() === 'Three', 'MediaTrackNext to play Three');
media('MediaTrackPrevious');
waitFor(() => title() === 'Two', 'MediaTrackPrevious to go back to Two');

// Repeat one: at its end the song starts over and the queue stays put.
const short = app.library.albums().find((a) => a.title === 'Short');
app.playSongs(short.songs, 0);
waitFor(() => title() === 'Blip', 'Blip to play');
player.setRepeat('one');
let wrapped = false;
let last = 0;
waitFor(() => {
  const p = player.readPosition();
  if (p + 0.1 < last) wrapped = true;
  last = p;
  return wrapped;
}, 'repeat-one to loop the song', 15000);
eq(playing(), 'Blip', 'repeat one stays on the song');
eq(player.queue.index, 0, 'the queue did not move');

// Repeat off: the end of a song plays the next; the end of the queue stops.
player.setRepeat('off');
waitFor(() => playing() === 'Blop', 'the next song to follow by itself', 15000);
waitFor(() => player.state === 'stopped', 'the end of the queue to stop', 15000);

// Repeat all: past the last song the queue starts again.
player.setRepeat('all');
app.playSongs(short.songs, 1);
waitFor(() => playing() === 'Blop' && player.playing, 'Blop again');
waitFor(() => playing() === 'Blip', 'repeat all to wrap to the first song', 15000);

// The repeat button cycles off → all → one, and the setting follows.
player.setRepeat('off');
app.bar.update();
press(`${mod}+r`);
eq(player.queue.repeat, 'all', 'Mod+R: repeat all');
press(`${mod}+r`);
eq(player.queue.repeat, 'one', 'Mod+R: repeat one');
eq(app.settings.get('repeat'), 'one', 'saved');
press(`${mod}+r`);
eq(player.queue.repeat, 'off', 'Mod+R: off');

console.log('test_playback PASSED');
