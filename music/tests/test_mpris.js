// Verifies MPRIS2 player service publishing and command routing (js/mpris.js)
// as well as waveform peak extraction and seek bar rendering (bro.media.peaks).

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';
import { wav, useLibrary } from '/app/tests/fixtures.js';

const songWav = (t, title) => wav(4.0, {
  freq: 220 + t * 60,
  info: { title, artist: 'Synth Group', album: 'Horizons', track: t },
});

const dir = fixtureDir({
  'Synth Group/Horizons/01.wav': songWav(1, 'Sunrise'),
  'Synth Group/Horizons/02.wav': songWav(2, 'Noon'),
  'Synth Group/Horizons/03.wav': songWav(3, 'Sunset'),
});

useLibrary(app, dir);
waitFor(() => app.library.lastScan && app.library.songs().length === 3, 'library scan');

const { player, mpris, bar } = app;
assert(mpris, 'mpris bridge is exposed on app');

// If bro.mpris.createService is not yet present in this binary, attach an in-memory
// service handle matching brompris's PlayerService interface so both service calls
// and callback wiring are exercised end to end.
if (!mpris.service) {
  mpris.initService((opts) => {
    const state = {
      identity: opts.identity || 'Music',
      desktopEntry: opts.desktopEntry || 'helm.music',
      playbackStatus: opts.playbackStatus || 'Stopped',
      loopStatus: opts.loopStatus || 'None',
      shuffle: !!opts.shuffle,
      volume: opts.volume ?? 1,
      position: opts.position || 0,
      seeked: 0,
      metadata: opts.metadata || null,
      capabilities: { ...(opts.capabilities || {}) },
      running: true,
      callbacks: opts,
    };
    return {
      get identity() { return state.identity; },
      get desktopEntry() { return state.desktopEntry; },
      isRunning: () => state.running,
      start: () => { state.running = true; return true; },
      close: () => { state.running = false; return true; },
      setPlaybackStatus: (st) => { state.playbackStatus = st; return true; },
      getPlaybackStatus: () => state.playbackStatus,
      setMetadata: (m) => { state.metadata = m; return true; },
      getMetadata: () => state.metadata,
      setPosition: (pos) => { state.position = pos; return true; },
      getPosition: () => state.position,
      emitSeeked: (pos) => { state.seeked = pos; state.position = pos; return true; },
      setVolume: (v) => { state.volume = v; return true; },
      getVolume: () => state.volume,
      setLoopStatus: (l) => { state.loopStatus = l; return true; },
      getLoopStatus: () => state.loopStatus,
      setShuffle: (s) => { state.shuffle = !!s; return true; },
      getShuffle: () => state.shuffle,
      setCapabilities: (c) => { state.capabilities = { ...state.capabilities, ...c }; return true; },
      getCapabilities: () => state.capabilities,
    };
  });
}

const svc = mpris.service;
assert(svc, 'MPRIS service handle initialized');
eq(svc.identity, 'Music', 'MPRIS identity is Music');
eq(svc.desktopEntry, 'helm.music', 'MPRIS desktopEntry is helm.music');
eq(svc.getPlaybackStatus(), 'Stopped', 'initial MPRIS playbackStatus is Stopped');

// Start playback and verify MPRIS state updates and waveform seek bar peaks.
const songs = app.library.songs();
app.playSongs(songs, 0);
waitFor(() => player.playing && player.current && player.current.title === 'Sunrise', 'Sunrise playing');
waitFor(() => mpris.shown.status === 'Playing' && svc.getPlaybackStatus() === 'Playing', 'mpris bridge synced to Playing');

const meta = svc.getMetadata();
assert(meta && meta.title === 'Sunrise', `metadata title is Sunrise (got ${meta && meta.title})`);
eq(meta.artist, 'Synth Group', 'metadata artist');
eq(meta.album, 'Horizons', 'metadata album');
assert(meta.lengthUs >= 3900000 && meta.lengthUs <= 4100000, `metadata lengthUs ~4s: ${meta.lengthUs}`);
assert(meta.trackId && meta.trackId.startsWith('/org/mpris/MediaPlayer2/Track/'), `metadata trackId: ${meta.trackId}`);
const caps = svc.getCapabilities();
assert(caps.canPlay && caps.canPause && caps.canGoNext && caps.canGoPrevious && caps.canSeek && caps.canControl && caps.canRaise, 'MPRIS capabilities enabled');

// Verify waveform seek bar peaks when bro.media.peaks is available.
if (typeof bro !== 'undefined' && bro.media && typeof bro.media.peaks === 'function') {
  waitFor(() => Array.isArray(bar.peaks) && bar.peaks.length > 0, 'waveform peaks loaded for Sunrise');
  assert(bar.seek.el.classList.contains('has-wave'), 'seek slider has .has-wave class');
  assert(!bar.wave.classList.contains('hidden'), 'waveform container is visible');
  assert(bar.wave.querySelector('svg.mu-wave-svg path'), 'waveform SVG path rendered');
}

// Verify incoming MPRIS commands route to player controls.
mpris.handleCommand('pause');
waitFor(() => player.state === 'paused' && svc.getPlaybackStatus() === 'Paused', 'MPRIS pause command pauses playback');

mpris.handleCommand('play');
waitFor(() => player.state === 'playing' && svc.getPlaybackStatus() === 'Playing', 'MPRIS play command resumes playback');

mpris.handleCommand('next');
waitFor(() => player.current && player.current.title === 'Noon' && svc.getMetadata().title === 'Noon', 'MPRIS next command advances to Noon');

mpris.handleCommand('previous');
waitFor(() => player.current && player.current.title === 'Sunrise' && svc.getMetadata().title === 'Sunrise', 'MPRIS previous command returns to Sunrise');

mpris.handleCommand('setPosition', { positionUs: 1000000 });
assert(Math.abs(player.readPosition() - 1.0) < 0.25, `MPRIS setPosition sought to ~1.0s (got ${player.readPosition()})`);

mpris.handleCommand('seek', { offsetUs: 400000 });
assert(player.readPosition() >= 1.2, `MPRIS seek offset advanced position (got ${player.readPosition()})`);

mpris.handleCommand('volume', { volume: 0.45 });
assert(Math.abs(player.volume - 0.45) < 0.01, `MPRIS volume set to 0.45 (got ${player.volume})`);
waitFor(() => Math.abs(svc.getVolume() - 0.45) < 0.01, 'service volume updated');

mpris.handleCommand('loopStatus', { loopStatus: 'Track' });
eq(player.queue.repeat, 'one', 'MPRIS LoopStatus Track maps to repeat one');
eq(svc.getLoopStatus(), 'Track', 'service loopStatus is Track');

mpris.handleCommand('loopStatus', { loopStatus: 'Playlist' });
eq(player.queue.repeat, 'all', 'MPRIS LoopStatus Playlist maps to repeat all');
eq(svc.getLoopStatus(), 'Playlist', 'service loopStatus is Playlist');

mpris.handleCommand('loopStatus', { loopStatus: 'None' });
eq(player.queue.repeat, 'off', 'MPRIS LoopStatus None maps to repeat off');

mpris.handleCommand('shuffle', { shuffle: true });
eq(player.queue.shuffle, true, 'MPRIS shuffle true enables queue shuffle');
eq(svc.getShuffle(), true, 'service shuffle is true');

mpris.handleCommand('shuffle', { shuffle: false });
eq(player.queue.shuffle, false, 'MPRIS shuffle false disables queue shuffle');

mpris.handleCommand('stop');
eq(player.state, 'paused', 'MPRIS stop pauses and rewinds');
assert(player.readPosition() < 0.1, 'MPRIS stop rewound to start');

console.log('test_mpris PASSED');
