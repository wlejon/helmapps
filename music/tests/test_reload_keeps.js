// A reload (an update to the app, F5) does not stop the music: the song goes
// on playing from where it was, and the page comes back as it was: the
// album open, Back still leading to Albums, the selection and the scroll
// (app.keep, lib/app.js). A restart, by contrast, resumes paused
// (test_resume).

import { waitFor, eq, fixtureDir } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

let app = window.app;
const tree = {};
for (let t = 1; t <= 40; t++) {
  const n = String(t).padStart(2, '0');
  tree[`Band/Album/${n}.wav`] = wav(8, { info: { title: `Song ${n}`, artist: 'Band', album: 'Album', track: t } });
}
useLibrary(app, fixtureDir(tree));
app.startScan();
waitFor(() => app.library.lastScan && app.library.songs().length === 40, 'the scan');

const album = app.library.albums()[0];
app.go('albums');
app.go('album', album.key);
waitFor(() => app.views.active && app.views.active.items.length === 40, 'the album open');
const list = app.views.active;
const picks = [album.songs[30].path, album.songs[31].path];
list.select(picks, { scroll: true });
advanceTime(16);
const scrolled = list.scroller.scrollTop;
assert(scrolled > 0, `scrolled down to the selection (${scrolled})`);

app.playSongs(album.songs, 2);
waitFor(() => app.player.playing, 'play');
app.player.seek(3);
waitFor(() => app.player.readPosition() >= 3, 'the seek');

// The windowed frame loop (runFrames) is where a reload commits.
const before = app;
location.reload();
for (let i = 0; i < 40 && window.app === before; i++) runFrames(5, { stepMs: 16 });
assert(window.app !== before, 'the page reloaded');
app = window.app;

waitFor(() => app.player && app.player.playing, 'still playing after the reload');
eq(app.player.current.title, 'Song 03', 'the same song');
const at = app.player.readPosition();
assert(at >= 2.9 && at < 6, `from where it was (${at})`);
waitFor(() => app.views.active && app.views.active.items.length === 40 && app.views.active.selection.size === 2,
  'the album back, its selection with it');
eq(app.state.view, 'album', 'the album page');
eq(app.state.arg, album.key, 'the same album');
eq(app.state.history.map((h) => h.view).slice(-1), ['albums'], 'Back still leads to Albums');
eq([...app.views.active.selection].sort(), picks.slice().sort(), 'the same two songs selected');
eq(Math.round(app.views.active.scroller.scrollTop), Math.round(scrolled), 'scrolled where it was');

console.log('test_reload_keeps PASSED');
