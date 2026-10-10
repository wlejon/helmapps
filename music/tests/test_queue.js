// Acceptance 7: Play Next inserts after the current song; Add to Queue
// appends (both from a song's context menu). The Queue page reorders by
// dragging a row's grip, and Delete removes the selected songs.

import { app, waitFor, eq, settle, fixtureDir, rightClickEl, clickEl, chooseMenu, menuLabels, drag, press, mod } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

const tree = {};
for (const [album, n] of [['Alpha', 4], ['Beta', 3]]) {
  for (let t = 1; t <= n; t++) tree[`Band/${album}/0${t}.wav`] = wav(30, { info: { title: `${album} ${t}`, artist: 'Band', album, track: t } });
}
useLibrary(app, fixtureDir(tree));
waitFor(() => app.library.lastScan && app.library.songs().length === 7, 'the scan');

const player = app.player;
const titles = () => player.queue.paths().map((p) => app.library.song(p).title);
const albumOf = (t) => app.library.albums().find((a) => a.title === t);

// Play Alpha from its first song.
app.playSongs(albumOf('Alpha').songs, 0);
waitFor(() => player.playing, 'Alpha 1 to play');
eq(titles(), ['Alpha 1', 'Alpha 2', 'Alpha 3', 'Alpha 4'], 'the album is the queue');

// Beta's page: Play Next on Beta 2, Add to Queue on Beta 3, from the context menu.
const rowOf = (title) => Array.from(document.querySelectorAll('.vlist-row'))
  .find((r) => r.textContent.includes(title) && !r.closest('.hidden'));
app.go('album', albumOf('Beta').key);
waitFor(() => rowOf('Beta 3'), 'Beta\'s page');
rightClickEl(rowOf('Beta 2'));
waitFor(() => menuLabels().includes('Play Next'), 'the song menu');
assert(menuLabels().includes('Add to Queue'), 'with Add to Queue');
chooseMenu('Play Next');
eq(titles(), ['Alpha 1', 'Beta 2', 'Alpha 2', 'Alpha 3', 'Alpha 4'], 'Play Next goes right after the playing song');

rightClickEl(rowOf('Beta 3'));
waitFor(() => menuLabels().includes('Add to Queue'), 'the song menu again');
chooseMenu('Add to Queue');
eq(titles(), ['Alpha 1', 'Beta 2', 'Alpha 2', 'Alpha 3', 'Alpha 4', 'Beta 3'], 'Add to Queue goes at the end');

// A second Play Next goes before the first (it plays next now).
app.playNext([app.library.songs().find((s) => s.title === 'Beta 1')]);
eq(titles().slice(0, 3), ['Alpha 1', 'Beta 1', 'Beta 2'], 'the newest Play Next is next');

// Next follows the queue as edited.
press(`${mod}+right`);
waitFor(() => player.current.title === 'Beta 1', 'Next to play Beta 1');
press(`${mod}+right`);
waitFor(() => player.current.title === 'Beta 2', 'then Beta 2');

// The Queue page: the playing row is marked; drag a row by its grip.
app.go('queue', '');
waitFor(() => document.querySelectorAll('.mu-queue .vlist-row').length === 7, 'the queue page');
settle(100);
assert(rowOf('Beta 2').classList.contains('mu-playing'), 'the playing song is marked');
const grip = (title) => rowOf(title).querySelector('.mu-grip');
const upper = (row) => { const r = row.getBoundingClientRect(); return [r.left + 60, r.top + r.height * 0.25]; };
drag(grip('Beta 3'), upper(rowOf('Alpha 2')));
waitFor(() => titles().indexOf('Beta 3') === titles().indexOf('Alpha 2') - 1, 'Beta 3 dragged above Alpha 2');
eq(titles().length, 7, 'nothing lost on the way');
eq(player.current.title, 'Beta 2', 'the playing song is still playing');
assert(player.playing, 'and still playing');
const savedQueue = () => { try { return JSON.parse(require('fs').readFileSync(require('path').join(bro.app.dataDir, 'queue.json'), 'utf8')).paths; } catch (_) { return null; } };
waitFor(() => (savedQueue() || []).join() === player.queue.paths().join(), 'the edited queue to be saved');

// Drag down past the end.
const before = titles();
drag(grip(before[0]), [rowOf(before[6]).getBoundingClientRect().left + 40, rowOf(before[6]).getBoundingClientRect().bottom + 6]);
waitFor(() => titles()[6] === before[0], 'the first row dragged to the end');

// Alt+Up / Alt+Down on the list move the selected song.
const third = titles()[3];
clickEl(rowOf(third).querySelector('.mu-title'));
press('alt+up');
waitFor(() => titles()[2] === third, 'Alt+Up moves the song up one');
press('alt+down');
press('alt+down');
waitFor(() => titles()[4] === third, 'Alt+Down twice moves it down two');
eq(app.queueView.list.selectedItems().map((r) => r.title), [third], 'it stays selected');

// Remove with Delete, after clicking a row (not the grip).
clickEl(rowOf('Alpha 4').querySelectorAll('.vlist-cell')[2] || rowOf('Alpha 4'));
press('delete');
waitFor(() => !titles().includes('Alpha 4'), 'Delete to remove Alpha 4');
eq(titles().length, 6, 'six left');

// Removing the playing song moves on to what came after it.
const i = player.queue.index;
const after = titles()[i + 1];
rightClickEl(rowOf('Beta 2'));
waitFor(() => menuLabels().includes('Remove from Queue'), 'the queue menu');
chooseMenu('Remove from Queue');
waitFor(() => player.current && player.current.title === after, 'the song after it to play');

// Clear.
app.player.queue.clear();
app.player.queueChanged();
waitFor(() => document.querySelector('.mu-queue .empty-state, .mu-queue .vlist-empty') || document.querySelectorAll('.mu-queue .vlist-row').length === 0, 'the empty queue');
eq(player.state, 'stopped', 'an empty queue stops');

console.log('test_queue PASSED');
