// Run by test_resume.js in a second bro-headless against the same
// BRO_APP_HOME: a fresh start of the app, which should come back with the
// saved queue on the saved song at the saved position, paused. The
// expectation arrives as JSON in MUSIC_EXPECT. Not a test of its own (the
// runner only runs test_*.js); it does not import fixtures.js, which would
// point the library somewhere else.

import { app, waitFor, eq, settle } from '/lib/test.js';

const want = JSON.parse(process.env.MUSIC_EXPECT);
const player = app.player;

waitFor(() => player.queue.length > 0, 'the saved queue');
eq(player.queue.paths(), want.paths, 'the same queue, in the same order');
eq(player.queue.index, want.index, 'on the same song');
eq(player.state, 'paused', 'paused, not playing');
assert(Math.abs(player.position - want.position) < 0.6, `at the saved position: ${player.position} vs ${want.position}`);

// The window says so before the library is even in.
waitFor(() => document.querySelector('.mu-np-title').textContent === want.title, 'the bar shows the song');
waitFor(() => app.library.loaded && app.library.songs().length === want.songs, 'the saved index');

// Play carries on from there.
settle(50);
player.play();
waitFor(() => player.playing, 'Play');
settle(200);
const at = player.readPosition();
assert(at >= want.position - 0.6, `playing from the saved position: ${at}`);

console.log('resume_check PASSED');
