// Acceptance 8: on restart the app comes back with the last queue, song and
// position, paused. This run plays, seeks, edits the queue and pauses; then
// a second bro-headless starts the app afresh against the same BRO_APP_HOME
// and checks it (resume_check.js).

import { app, waitFor, eq, settle, fixtureDir, press, mod } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

const path = require('path');
const { spawnSync } = require('child_process');

const tree = {};
for (let t = 1; t <= 5; t++) tree[`Band/Album/0${t}.wav`] = wav(8, { info: { title: `Song ${t}`, artist: 'Band', album: 'Album', track: t } });
useLibrary(app, fixtureDir(tree));
waitFor(() => app.library.lastScan && app.library.songs().length === 5, 'the scan');

const player = app.player;
const songs = app.library.albums()[0].songs;
app.playSongs(songs, 1);
waitFor(() => player.playing, 'play');
press(`${mod}+right`);
waitFor(() => player.current.title === 'Song 3', 'Next');
app.addToQueue([songs[0]]);                 // the queue is edited too: Song 1 again at the end
player.seek(4.2);
waitFor(() => player.readPosition() >= 4.2, 'the seek');
press('space');
waitFor(() => player.state === 'paused', 'pause');
settle(100);

const want = {
  paths: player.queue.paths(),
  index: player.queue.index,
  position: player.readPosition(),
  title: 'Song 3',
  songs: 5,
};
eq(want.paths.length, 6, 'six entries in the queue');
const queueFile = path.join(bro.app.dataDir, 'queue.json');
const savedPaths = () => { try { return JSON.parse(require('fs').readFileSync(queueFile, 'utf8')).paths; } catch (_) { return null; } };
waitFor(() => (savedPaths() || []).join() === want.paths.join(), 'the queue saved to queue.json');
eq(app.settings.get('queueIndex'), want.index, 'and the place in it');
assert(Math.abs(app.settings.get('position') - want.position) < 0.6, 'the position is saved');

// The second start: a separate process, the same home, nothing else shared.
const child = spawnSync(process.execPath, ['--grant', 'declared,env', '--width', '1280', '--height', '800', bro.appDir, path.join(bro.appDir, 'tests', 'resume_check.js')], {
  env: { ...process.env, MUSIC_EXPECT: JSON.stringify(want) },
  encoding: 'utf8',
  timeout: 60000,
});
const out = `${child.stdout || ''}${child.stderr || ''}`;
const lines = out.split(/\r?\n/).filter((l) => /ASSERTION|PASSED|uncaught|Error/.test(l));
for (const l of lines) console.log(`  restart: ${l.trim()}`);
eq(child.status, 0, 'the restarted app passes its checks');
assert(out.includes('resume_check PASSED'), 'and says so');

console.log('test_resume PASSED');
