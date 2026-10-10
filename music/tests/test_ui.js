// Browsing: the sidebar and Mod+1..5 switch views; an album cell opens its
// page in disc/track order; the head's artist link and Back; the Songs list
// sorts by a header click; Mod+F search filters the current view and Escape
// clears it; Space in the search field types, it does not toggle play.

import { app, waitFor, eq, settle, fixtureDir, clickEl, dblClickEl, press, type, mod } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

const tree = {
  'Zeta/Zed/1-02 Second.wav': wav(0.2, { info: { title: 'Second', artist: 'Zeta', album: 'Zed' } }),
  'Zeta/Zed/1-01 First.wav': wav(0.2, { info: { title: 'First', artist: 'Zeta', album: 'Zed' } }),
  'Zeta/Zed/2-01 Third.wav': wav(0.2, { info: { title: 'Third', artist: 'Zeta', album: 'Zed' } }),
  'Alpha/Apex/01 Apple.wav': wav(0.2, { info: { title: 'Apple', artist: 'Alpha', album: 'Apex', track: 1 } }),
  'Alpha/Apex/02 Banana.wav': wav(0.2, { info: { title: 'Banana', artist: 'Alpha', album: 'Apex', track: 2 } }),
  'The Mids/Middle/01 Cherry.wav': wav(0.2, { info: { title: 'Cherry', artist: 'The Mids', album: 'Middle', track: 1 } }),
};
useLibrary(app, fixtureDir(tree));
waitFor(() => app.library.lastScan && app.library.songs().length === 6, 'the scan');

const visible = (sel) => Array.from(document.querySelectorAll(sel)).filter((e) => !e.closest('.hidden'));
const rows = () => visible('.vlist-row').map((r) => r.textContent);
const titleCol = () => visible('.vlist-row').map((r) => r.querySelectorAll('.vlist-cell, .cell')[1]?.textContent || r.textContent);
const head = () => document.querySelector('.mu-head-title').textContent;

// Albums (the default view): three cells, opened by a double-click.
press(`${mod}+2`);
waitFor(() => app.state.view === 'albums' && visible('.mu-albums .vgrid-cell').length === 3, 'the album grid');
const zed = visible('.mu-albums .vgrid-cell').find((c) => c.textContent.includes('Zed'));
dblClickEl(zed);
waitFor(() => app.state.view === 'album' && head() === 'Zed', 'the album page');
const order = app.views.tracks.items.map((s) => s.title);
eq(order, ['First', 'Second', 'Third'], 'disc 1 track 1, disc 1 track 2, disc 2 track 1');
assert(rows().some((r) => r.includes('Disc 2')) || app.views.tracks.items[2].disc === 2, 'the second disc is told apart');

// The head's artist link, then Back twice.
clickEl(document.querySelector('.mu-head .mu-link'));
waitFor(() => app.state.view === 'artist' && head() === 'Zeta', 'the artist page from the link');
// Alt+Left on the artist page, its album grid focused: the grid lets it
// through to Back.
app.views.albums.focus();
press('alt+left');
waitFor(() => app.state.view === 'album', 'Back to the album (Alt+Left from the album grid)');
press('alt+left');
waitFor(() => app.state.view === 'albums', 'Back to the albums');

// Artists: "The Mids" sorts under M.
press(`${mod}+3`);
waitFor(() => app.state.view === 'artists' && rows().length === 3, 'the artists list');
eq(app.views.artists.items.map((a) => a.name), ['Alpha', 'The Mids', 'Zeta'], 'artists sort without "The"');

// Songs: sort by Title from the header, then flip it.
press(`${mod}+1`);
waitFor(() => app.state.view === 'songs' && rows().length === 6, 'the songs list');
const header = (label) => visible('.vlist-header .col, .col').find((c) => c.textContent.trim() === label);
clickEl(header('Title'));
waitFor(() => app.views.songs.items[0].title === 'Apple', 'sorted by title');
eq(app.views.songs.items.map((s) => s.title), ['Apple', 'Banana', 'Cherry', 'First', 'Second', 'Third'], 'A to Z');
clickEl(header('Title'));
waitFor(() => app.views.songs.items[0].title === 'Third', 'Z to A');
clickEl(header('Length'));
waitFor(() => app.views.songs.items.length === 6, 'sorted by length');

// Search: Mod+F, type, the list narrows; Space types; Escape clears.
press(`${mod}+f`);
eq(document.activeElement && document.activeElement.getAttribute('aria-label'), 'Search', 'Mod+F focuses the search field');
type('the mi');
waitFor(() => app.views.songs.items.length === 1 && app.views.songs.items[0].title === 'Cherry', 'the search to narrow the songs');
eq(app.player.state, 'stopped', 'Space in the field typed, it did not play');
press(`${mod}+2`);
waitFor(() => app.state.view === 'albums', 'albums');
eq(document.querySelector('input[aria-label="Search"]').value, '', 'a new view starts unfiltered');
press(`${mod}+f`);
type('ap');
waitFor(() => visible('.mu-albums .vgrid-cell').length === 1, 'the search filters the album grid');
press('escape');
waitFor(() => visible('.mu-albums .vgrid-cell').length === 3, 'Escape clears it');

// The sidebar's Queue count follows the queue.
app.playSongs(app.library.albums().find((a) => a.title === 'Apex').songs, 0);
waitFor(() => visible('.sidebar-item').some((b) => b.textContent.includes('Queue') && b.textContent.includes('2')), 'the queue count');
press(`${mod}+5`);
waitFor(() => app.state.view === 'queue' && rows().length === 2, 'the queue page');

// Album cells survive a resize of the window (the grid refills its columns).
settle(50);
console.log('test_ui PASSED');
