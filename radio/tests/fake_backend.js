// A stand-in for the radio's backend (js/models.js) with no models: the UI
// tests run on it. Deterministic and instant:
//   - embedText: a sum of per-word vectors, so phrases sharing words land
//     near each other, as CLAP's do;
//   - endless: a paced stream of 10 s chunks. Chunk k+1's tokens are
//     "sampled" (and "built") when chunk k starts, under the target of that
//     moment, as yue.endless works one chunk ahead; 'planned', 'sampled',
//     'built' and 'chunkStart' events like the real one. A chunk's audio is
//     constant, its value naming the chunk's style;
//   - embedAudio: reads the style back out of that audio and answers the
//     text vector of "<genre> <mood> music", so CLAP's verdict matches what
//     was asked;
//   - createPlayer: a playhead that runs on the page clock (advanceTime).
// Every stream call is logged in backend.calls for the tests to check.

const RATE = 48000;
const CHUNK = 10 * RATE;
const D = 512;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function wordVec(w) {
  const v = new Float32Array(D);
  let a = hash(w);
  for (let i = 0; i < D; i++) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; v[i] = (a / 4294967296) - 0.5; }
  return v;
}

export function textVec(s) {
  const v = new Float32Array(D);
  for (const w of s.toLowerCase().split(/[^a-z&-]+/).filter(Boolean)) {
    const wv = wordVec(w);
    for (let i = 0; i < D; i++) v[i] += wv[i];
  }
  let n = 0;
  for (let i = 0; i < D; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < D; i++) v[i] /= n;
  return v;
}

const field = (tag, k) => { const m = new RegExp(`${k}=([^|]*)`).exec(tag || ''); return m ? m[1] : ''; };

export function fakeBackend({ emitLead = 2 } = {}) {
  const tags = [];            // style tags by the value their audio carries
  const tagValue = (tag) => { let i = tags.indexOf(tag); if (i < 0) { tags.push(tag); i = tags.length - 1; } return (i + 1) / 1000; };
  const backend = {
    device: 'fake',
    cacheKey: null,
    calls: [],
    stream: null,
    disposed: false,
    dispose() { if (backend.stream && backend.stream.running) return false; backend.disposed = true; return true; },
    embedText: (list) => list.map(textVec),
    embedAudio(mono, done) {
      const tag = tags[Math.round(mono[mono.length >> 1] * 1000) - 1];
      setTimeout(() => done(tag ? textVec(`${field(tag, 'g')} ${field(tag, 'm')} music`) : null), 0);
      return true;
    },
    createPlayer: () => fakePlayer(),
    endless(opts) {
      const s = fakeStream(backend, opts, emitLead, tagValue);
      backend.stream = s;
      return s;
    },
  };
  return backend;
}

function fakeStream(backend, opts, emitLead, tagValue) {
  let target = Object.assign({}, opts.target);
  let emitted = 0, playhead = 0, running = true, sampled = -1;
  const chunkTags = [];
  const log = (kind, arg) => backend.calls.push({ kind, arg, at: emitted / RATE });
  const ev = (e) => opts.onEvent(Object.assign({ branch: 0, chunk: -1, sample: 0, tag: '', value: 0, text: '' }, e));

  function sample(k) {
    chunkTags[k] = target.tag;
    const change = k > 0 && chunkTags[k - 1] !== target.tag;
    const row = { index: k, branch: 0, tag: target.tag, style: target.style, how: change ? 'drop' : '', change, rendered: true };
    ev({ kind: 'sampled', chunk: k, tag: target.tag, row });
    ev({ kind: 'built', chunk: k, tag: target.tag, row });
    sampled = k;
  }
  const openChunk = () => sampled + 1;

  const s = {
    running: true,
    get stats() {
      return { playhead, emitted, openChunk: openChunk(), openSample: openChunk() * CHUNK, aheadSeconds: (emitted - playhead) / RATE,
        playing: Math.floor(playhead / CHUNK), worstGapSeconds: 0, costSeconds: { splice: 1, render: 2, decode: 0.7 },
        chunks: [], branches: [], gaps: [] };
    },
    get target() { return target; },
    setPlayhead(p) {
      if (!running) return;
      playhead = p;
      const want = Math.floor(p + emitLead * RATE);
      while (emitted < want) {
        const k = Math.floor(emitted / CHUNK);
        if (emitted === k * CHUNK) {
          if (sampled < k) sample(k);
          ev({ kind: 'chunkStart', chunk: k, tag: chunkTags[k], sample: emitted });
          sample(k + 1);                         // one chunk ahead
        }
        const n = Math.min(want - emitted, (k + 1) * CHUNK - emitted, 4800);
        const samples = new Float32Array(2 * n).fill(tagValue(chunkTags[k]));
        opts.onAudio({ samples, frames: n, channels: 2, sampleRate: RATE, sample0: emitted });
        emitted += n;
      }
    },
    setTarget(t) {
      log('setTarget', t);
      target = Object.assign({}, target, t);
      ev({ kind: 'planned', tag: target.tag, chunk: openChunk(), sample: openChunk() * CHUNK });
      return target;
    },
    setPath(p) { log('setPath', p); },
    setKnobs(k) { log('setKnobs', k); target.knobs = Object.assign({}, target.knobs, k); return target.knobs; },
    setScore() {},
    stop() {
      if (!running) return;
      running = false; s.running = false;
      log('stop');
      setTimeout(() => opts.onDone && opts.onDone({ cancelled: true, error: '' }), 0);
    },
  };
  return s;
}

function fakePlayer() {
  let pushed = 0, played = 0, last = -1, paused = false;
  const now = () => performance.now();
  return {
    push(c) { pushed = c.sample0 + c.frames; if (last < 0) last = now(); },
    tick() {
      if (last >= 0) {
        const t = now();
        if (!paused) played = Math.min(pushed, played + (t - last) / 1000 * RATE);
        last = t;
      }
      return Math.floor(played);
    },
    playhead: () => Math.floor(played),
    setPaused(p) { paused = !!p; },
    setGain() {},
    stop() {},
    stats: () => ({ bufferedSeconds: (pushed - played) / RATE, underrunSeconds: 0 }),
  };
}
