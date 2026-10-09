// helmremote end to end in one bro-headless: the process hosts its own screen
// (bro.remote.host, raw frames on a socket of its own) and the app connects to
// it, so the view shows the app itself. Checks the command line, the connect
// screen, the session coming up in the <remoteview>, the statistics overlay,
// the recent-hosts list and going back. No input is sent: it would come
// straight back to this same window.

import { parseArgs } from '../js/cli.js';

const fs = require('fs');
const path = require('path');

function waitFor(pred, what, ms) {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) {
        advanceTime(16);
        let ok = false;
        try { ok = !!pred(); } catch (e) { ok = false; }
        if (ok) return;
        wallSleep(5);
    }
    assert(false, 'timed out waiting for ' + what);
}
const eq = (a, b, what) => assert(JSON.stringify(a) === JSON.stringify(b), what + ': got ' + JSON.stringify(a) +
                                  ', want ' + JSON.stringify(b));

// ── the command line (pure) ──
const a = parseArgs(['me@halo', '--socket', 'helm', '--fullscreen', '--no-mic', '--latency-test', '50']);
eq([a.host, a.socket, a.fullscreen, a.audio, a.mic, a.latencyTest], ['me@halo', 'helm', true, true, false, 50], 'options');
eq(parseArgs(['--socket=x']).socket, 'x', '--socket=');
eq(parseArgs(['--latency-test', 'many']).errors, ['--latency-test needs a count'], 'a bad count');
eq(parseArgs(['--bogus']).errors, ['unknown option --bogus'], 'an unknown option');
eq(parseArgs(['a', 'b']).errors, ['unexpected argument b'], 'two hosts');

const app = window.helmremote;
assert(app, 'the app is up');
const $ = (id) => document.getElementById(id);

// ── the connect screen ──
flush();
assert(!$('connect').hidden && $('viewer').hidden, 'no host given: the connect screen');
assert($('recent-block').hidden, 'nothing recent yet');

// ── host this window, and view it ──
const socket = 'helmremote-test-' + Math.floor(Math.random() * 1e6);
const hosted = bro.remote.host({ socket, codecs: 'raw', fps: 30 });
assert(hosted.hosting, 'hosting on ' + socket);

$('socket').value = socket;
app.connect({ host: '', socket });
assert($('connect').hidden && !$('viewer').hidden, 'connecting shows the viewer');
assert(app.view.session === app.state.session, 'the view shows the session');
waitFor(() => app.state.session.status().state === 'connected', 'the session to connect');
waitFor(() => app.view.stats().pictures > 0 && app.view.streamWidth > 0, 'a picture in the view');

const st = app.state.session.status();
eq([st.codec, st.width, st.height], ['raw', 1280, 800], 'the stream');
assert(app.view.captured, 'connecting captures the view');
assert(document.activeElement === app.view, 'the view has focus');
assert(/raw 1280x800/.test($('bar-state').textContent), 'the bar says the stream: ' + $('bar-state').textContent);

// ── statistics ──
$('toggle-stats').click();
waitFor(() => !$('stats').hidden && /pictures: (cpu|gpu)/.test($('stats').textContent), 'the statistics overlay');
assert(/raw 1280x800/.test($('stats').textContent), 'the overlay names the stream: ' + $('stats').textContent);

// ── release and back ──
app.view.release();
waitFor(() => $('viewer').classList.contains('show-bar'), 'the bar on release');
$('disconnect').click();
waitFor(() => !$('connect').hidden, 'the connect screen again');
assert(app.state.session === null && app.view.session === null, 'disconnected');

// The host is remembered.
const recent = JSON.parse(fs.readFileSync(path.join(bro.app.dataDir, 'recent.json'), 'utf-8'));
eq(recent.map((r) => [r.host, r.socket]), [['', socket]], 'recent.json');
assert(!$('recent-block').hidden && $('recent').children.length === 1, 'the recent list shows it');
assert(/this machine : /.test($('recent').textContent), 'described: ' + $('recent').textContent);

bro.remote.stop();
