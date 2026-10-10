// Acceptance 6: shuffle plays every song once before repeating any; with
// repeat all, each pass round is a fresh order that again holds every song
// once; turning shuffle off goes back to the album's order from the song
// that is playing.

import { app, waitFor, eq, fixtureDir, press, mod } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

const N = 9;
const tree = {};
for (let t = 1; t <= N; t++) tree[`Band/Mix/0${t}.wav`] = wav(0.3, { info: { title: `T${t}`, artist: 'Band', album: 'Mix', track: t } });
useLibrary(app, fixtureDir(tree));
waitFor(() => app.library.lastScan && app.library.songs().length === N, 'the scan');

const player = app.player;
const songs = app.library.albums()[0].songs;
const now = () => player.current.title;

player.setRepeat('all');
press(`${mod}+s`);
eq(player.queue.shuffle, true, 'Mod+S turns shuffle on');
eq(app.settings.get('shuffle'), true, 'and it is saved');

app.playSongs(songs, 4);
waitFor(() => player.playing, 'play');
eq(now(), 'T5', 'the clicked song plays first');

// Every song once (by Next), then a second pass that is again every song once.
const pass = (first) => {
  const seen = [first];
  for (let i = 1; i < N; i++) { player.next(); seen.push(now()); }
  return seen;
};
const one = pass(now());
eq(new Set(one).size, N, `the first pass plays every song once: ${one.join(' ')}`);
player.next();
const two = pass(now());
eq(new Set(two).size, N, `so does the second: ${two.join(' ')}`);
assert(one.join() !== two.join() || N < 3, 'a new order each pass');
assert(one.join() !== songs.map((s) => s.title).join(), 'shuffled, not in album order');

// And when songs end by themselves (virtual time), not only by Next.
app.playSongs(songs, 0);
const heard = [now()];
waitFor(() => {
  if (now() !== heard[heard.length - 1]) heard.push(now());
  return heard.length >= N;
}, 'every song to end by itself', 30000);
eq(new Set(heard).size, N, `ending by themselves, each song plays once: ${heard.join(' ')}`);

// Shuffle off: the album order resumes after the playing song.
const at = now();
press(`${mod}+s`);
eq(player.queue.shuffle, false, 'shuffle off');
eq(now(), at, 'the playing song keeps playing');
const k = Number(at.slice(1));
if (k < N) { player.next(); eq(now(), `T${k + 1}`, 'and Next follows the album order again'); }

console.log('test_shuffle PASSED');
