// helmremote: another machine's screen in a <remoteview>, over a
// bro.remote.connect() session (ssh HOST broremote proxy, or a socket here).
//
// The view takes the keyboard raw while captured (a click on it, or
// connecting): every key, shortcuts included, goes to the remote screen
// until the release chord (Ctrl+Alt+Escape) gives it back. The bar at the
// top (move the pointer to the top edge, or release) has the statistics,
// the audio and mic toggles, fullscreen and disconnect.

import { parseArgs } from './cli.js';
import { loadRecent, rememberRecent, describe } from './recent.js';
import { runLatencyTest } from './latency.js';

const $ = (id) => document.getElementById(id);
const opts = parseArgs(bro.app.argv || []);
for (const e of opts.errors) console.error('helmremote: ' + e);

const state = {
    session: null,
    target: null,       // {host, socket}
    statsTimer: 0,
    showStats: opts.stats,
    hintTimer: 0,
};

const view = $('view');

// ---- the connect screen ----------------------------------------------------

function showRecent() {
    const list = loadRecent();
    const ul = $('recent');
    ul.textContent = '';
    $('recent-block').hidden = list.length === 0;
    for (const r of list) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = describe(r);
        const when = document.createElement('span');
        when.className = 'when';
        when.textContent = new Date(r.when).toLocaleDateString();
        li.append(name, when);
        li.addEventListener('click', () => {
            $('host').value = r.host;
            $('socket').value = r.socket || '';
            connect({ host: r.host, socket: r.socket || '' });
        });
        ul.appendChild(li);
    }
}

function showConnect(message, bad) {
    stopSession();
    $('viewer').hidden = true;
    $('connect').hidden = false;
    const s = $('connect-status');
    s.textContent = message || '';
    s.className = 'status' + (bad ? ' bad' : '');
    showRecent();
    $('host').focus();
}

$('connect-form').addEventListener('submit', (e) => {
    e.preventDefault();
    connect({ host: $('host').value.trim(), socket: $('socket').value.trim() });
});

// ---- the session ----------------------------------------------------------

function stopSession() {
    if (state.statsTimer) clearInterval(state.statsTimer);
    state.statsTimer = 0;
    if (state.session) {
        const s = state.session;
        state.session = null;
        view.session = null;
        s.close();
    }
}

function connect(target) {
    stopSession();
    state.target = target;
    const options = {
        name: 'helmremote',
        audio: opts.audio && $('audio').checked,
        mic: opts.mic && $('mic').checked,
    };
    if (target.host) options.ssh = target.host;
    if (target.socket) options.socket = target.socket;
    let session;
    try {
        session = bro.remote.connect(options);
    } catch (e) {
        showConnect(e.message, true);
        return;
    }
    state.session = session;
    view.session = session;

    $('connect').hidden = true;
    $('viewer').hidden = false;
    $('closed').hidden = true;
    $('bar-title').textContent = describe(target);
    setBarState('connecting', '');
    showBar(true);
    if (opts.fullscreen || $('fullscreen').checked) bro.window.fullscreen = true;

    session.on('state', () => onState(session));
    session.on('config', () => onState(session));
    state.statsTimer = setInterval(updateStats, 500);
    updateStats();
    if (opts.latencyTest > 0) runLatencyTest(session, view, opts);
}

function onState(session) {
    if (session !== state.session) return;
    const st = session.status();
    if (st.state === 'connected') {
        rememberRecent(state.target.host, state.target.socket);
        const what = st.codec ? `${st.codec} ${st.width}x${st.height}` : 'waiting for the stream';
        setBarState(what, 'good');
        if (!view.captured) {
            view.capture();
            flashHint();
        }
        updateToggles();
    } else if (st.state === 'closed') {
        setBarState('closed', st.failed ? 'bad' : '');
        $('closed-why').textContent = st.failed ? st.message : (st.message || 'The session ended.');
        $('closed').hidden = false;
        showBar(true);
        if (opts.latencyTest > 0) bro.quit();
    }
}

function setBarState(text, cls) {
    const s = $('bar-state');
    s.textContent = text;
    s.className = 'status' + (cls ? ' ' + cls : '');
}

// ---- the bar, the hint, the statistics ------------------------------------

function showBar(on) {
    $('viewer').classList.toggle('show-bar', on);
}

function flashHint() {
    const h = $('hint');
    h.textContent = 'Keys go to the remote screen. ' + view.releaseChord + ' gives them back.';
    h.classList.add('visible');
    clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => h.classList.remove('visible'), 3500);
}

document.addEventListener('mousemove', (e) => {
    if ($('viewer').hidden) return;
    const st = state.session ? state.session.status().state : 'closed';
    showBar(e.clientY < 6 || (e.clientY < 48 && $('viewer').classList.contains('show-bar')) || !view.captured ||
            st !== 'connected');
});

view.addEventListener('capture', () => {
    showBar(false);
    flashHint();
});
view.addEventListener('release', () => {
    showBar(true);
    const h = $('hint');
    h.textContent = 'Released. Click the screen to send it keys again.';
    h.classList.add('visible');
    clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => h.classList.remove('visible'), 2500);
});

const ms = (v) => (typeof v === 'number' && v >= 0 ? v.toFixed(1) : '-');

function updateStats() {
    const s = state.session;
    const box = $('stats');
    box.hidden = !state.showStats || !s;
    $('toggle-stats').classList.toggle('off', !state.showStats);
    if (!s || !state.showStats) return;
    const st = s.status();
    const k = s.stats();
    const v = view.stats();
    const a = s.audio();
    const lat = k && k.latency;
    const lines = [];
    lines.push(`${st.server || '?'}  protocol ${st.protocol || '-'}  ${st.state}`);
    if (st.codec) lines.push(`${st.codec} ${st.width}x${st.height}  ${st.decoder || ''}${st.hardware ? ' (hw)' : ''}`);
    if (k) {
        lines.push(`fps ${ms(k.fps)}  ${ms(k.mbps)} Mbit/s  decode ${ms(k.decodeMs)} ms (max ${ms(k.decodeMaxMs)})`);
        lines.push(`decoded ${k.decoded}  failed ${k.failed}  keyframes asked ${k.keyframeRequests}`);
    }
    if (lat && lat.frames) {
        lines.push(`age ${ms(lat.age)} ms (max ${ms(lat.maxAge)})  rtt ${ms(lat.rtt)} ms`);
        lines.push(`  queue ${ms(lat.queue)} encode ${ms(lat.encode)} net ${ms(lat.net)} decode ${ms(lat.decode)} present ${ms(lat.present)}`);
    }
    lines.push(`pictures: ${v.path}${v.zeroCopy ? ', zero-copy (no CPU readback)' : ''}  shown ${v.pictures}  presented ${v.presented}`);
    if (v.bridgeError) lines.push(`  ${v.bridgeError}`);
    if (a) {
        const up = a.micLatencyMs >= 0 ? ms(a.micLatencyMs) : '-';
        const down = a.playbackLatencyMs >= 0 ? ms(a.playbackLatencyMs) : '-';
        lines.push(`audio: mic ${st.micMuted ? 'muted' : up + ' ms'}  sound ${st.playbackMuted ? 'muted' : down + ' ms'}`);
    }
    lines.push(`input: ${st.inputLane ? 'own lane' : 'control connection'}${st.inputLaneError ? ' (' + st.inputLaneError + ')' : ''}`);
    box.textContent = lines.join('\n');
}

function updateToggles() {
    const s = state.session;
    const st = s ? s.status() : null;
    $('toggle-mic').classList.toggle('off', !st || st.micMuted);
    $('toggle-playback').classList.toggle('off', !st || st.playbackMuted);
    $('toggle-fullscreen').classList.toggle('off', !bro.window.fullscreen);
}

$('toggle-stats').addEventListener('click', () => {
    state.showStats = !state.showStats;
    updateStats();
});
$('toggle-mic').addEventListener('click', () => {
    if (!state.session) return;
    state.session.setMicMuted(!state.session.status().micMuted);
    updateToggles();
});
$('toggle-playback').addEventListener('click', () => {
    if (!state.session) return;
    state.session.setPlaybackMuted(!state.session.status().playbackMuted);
    updateToggles();
});
$('toggle-fullscreen').addEventListener('click', () => {
    bro.window.toggleFullscreen();
    updateToggles();
});
$('disconnect').addEventListener('click', () => showConnect('', false));
$('back').addEventListener('click', () => showConnect('', false));
$('reconnect').addEventListener('click', () => connect(state.target));

// ---- start ------------------------------------------------------------------

if (opts.host || opts.local || opts.socket) {
    $('host').value = opts.host;
    $('socket').value = opts.socket;
    connect({ host: opts.host, socket: opts.socket });
} else {
    showConnect('', false);
}

// For tests: the app's state.
window.helmremote = { opts, state, connect, showConnect, view };
