// A stand-in for the radio's backend (js/models.js) with no models: the UI
// tests run on it. Deterministic and instant:
//   - embedText: a sum of per-word vectors, so prompts sharing words land
//     near each other, as CLAP's do;
//   - endless: a paced stream of 10 s chunks of constant audio whose value
//     encodes the chunk's anchor, handed out emitLead ahead of the playhead,
//     with 'planned' and 'chunkStart' events like yue.endless;
//   - embedAudio: reads the anchor back out of that audio and answers its
//     text vector, so the trail lands on the anchor that was asked for;
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

function textVec(s) {
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

const tagId = (tag) => Number(String(tag).slice(1));

export function fakeBackend({ emitLead = 0.75 } = {}) {
  const backend = {
    device: 'fake',
    cacheable: false,
    calls: [],
    styles: new Map(),       // anchor id -> style, learnt from targets
    stream: null,
    embedText: (list) => list.map(textVec),
    embedAudio(mono, done) {
      const id = Math.round(mono[mono.length >> 1] * 1000);
      const style = backend.styles.get(id);
      setTimeout(() => done(style ? textVec(style) : null), 0);
      return true;
    },
    createPlayer: () => fakePlayer(),
    endless(opts) {
      const s = fakeStream(backend, opts, emitLead);
      backend.stream = s;
      return s;
    },
  };
  return backend;
}

function fakeStream(backend, opts, emitLead) {
  let target = Object.assign({}, opts.target);
  let path = [];
  let emitted = 0, playhead = 0, running = true;
  const chunkTags = [];        // tag of each chunk handed out (fixed once its first sample is)
  backend.styles.set(tagId(target.tag), target.style);
  const log = (kind, arg) => backend.calls.push({ kind, arg, at: emitted / RATE });

  const openChunk = () => Math.ceil((emitted + 1) / CHUNK);   // first chunk with nothing handed out
  const tagFor = (k) => {
    let t = target;
    for (const p of path) if (p.at * RATE <= k * CHUNK) t = p;
    return t;
  };

  const s = {
    running: true,
    knobRanges: {},
    get stats() {
      return { playhead, emitted, openChunk: openChunk(), openSample: openChunk() * CHUNK, aheadSeconds: (emitted - playhead) / RATE,
        playing: Math.floor(playhead / CHUNK), worstGapSeconds: 0, chunks: [], branches: [], gaps: [] };
    },
    get target() { return target; },
    setPlayhead(p) {
      if (!running) return;
      playhead = p;
      const want = Math.floor(p + emitLead * RATE);
      while (emitted < want) {
        const k = Math.floor(emitted / CHUNK);
        if (emitted === k * CHUNK) {
          const t = tagFor(k);
          // A path entry whose time has come becomes the target.
          if (t !== target) { target = Object.assign({}, target, { style: t.style, tag: t.tag }); path = path.filter((q) => q.at * RATE > k * CHUNK); }
          chunkTags[k] = target.tag;
          opts.onEvent({ kind: 'chunkStart', chunk: k, branch: 0, tag: target.tag, sample: emitted });
        }
        const n = Math.min(want - emitted, (k + 1) * CHUNK - emitted, 4800);
        const v = tagId(chunkTags[k]) / 1000;
        const samples = new Float32Array(2 * n).fill(v);
        opts.onAudio({ samples, frames: n, channels: 2, sampleRate: RATE, sample0: emitted });
        emitted += n;
      }
    },
    setTarget(t) {
      log('setTarget', t);
      target = Object.assign({}, target, t);
      backend.styles.set(tagId(target.tag), target.style);
      opts.onEvent({ kind: 'planned', tag: target.tag, chunk: openChunk(), sample: openChunk() * CHUNK, branch: 0 });
      return target;
    },
    setPath(p) {
      log('setPath', p);
      path = p.map((q) => Object.assign({}, q));
      for (const q of path) {
        backend.styles.set(tagId(q.tag), q.style);
        const k = Math.max(openChunk(), Math.ceil(q.at * RATE / CHUNK));
        opts.onEvent({ kind: 'planned', tag: q.tag, chunk: k, sample: k * CHUNK, branch: 0 });
      }
    },
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
