/**
 * The atlas's geometry: anchors' CLAP vectors projected to the map's plane,
 * the anchor a point belongs to, and where a played chunk landed.
 *
 * Anchors are placed by the CLAP text embedding of their prompt. The plane's
 * axes are chosen by the listener: a principal component of the anchors
 * (the default), or a text axis, the direction from one phrase's embedding
 * to another's. Map coordinates are normalised so the anchors fill
 * [-1, 1] on both axes.
 *
 * A played chunk is placed by its CLAP *audio* embedding. Audio and text
 * embeddings sit apart in CLAP's space (the modality gap), so an audio
 * vector is not projected directly: it is placed at the mean of the anchors
 * it is most like (cosine similarity, softmax at CLAP's own logit scale over
 * the TOP_K nearest), which is where the music went in the map's own terms.
 *
 * Pure functions and plain arrays; no DOM, no models.
 */

const TOP_K = 6;
const LOGIT_SCALE = 38.7;

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v) {
  const n = Math.sqrt(dot(v, v)) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** The leading principal direction of rows (centred), orthogonal to `not`. */
function principal(rows, not) {
  const d = rows[0].length;
  let v = new Float64Array(d);
  for (let i = 0; i < d; i++) v[i] = Math.sin(i * 12.9898 + 1) ;   // fixed start: same answer every run
  for (let it = 0; it < 60; it++) {
    for (const u of not) { const p = dot(v, u); for (let i = 0; i < d; i++) v[i] -= p * u[i]; }
    const w = new Float64Array(d);
    for (const r of rows) { const p = dot(r, v); for (let i = 0; i < d; i++) w[i] += p * r[i]; }
    v = normalize(w);
  }
  for (const u of not) { const p = dot(v, u); for (let i = 0; i < d; i++) v[i] -= p * u[i]; }
  return normalize(v);
}

/**
 * The atlas for anchors with vectors (anchor.vec, unit length).
 * axes: { x: null | [from, to], y: ... } where from/to are text vectors.
 */
export function makeAtlas(anchors, axes = {}) {
  const d = anchors[0].vec.length;
  const mean = new Float64Array(d);
  for (const a of anchors) for (let i = 0; i < d; i++) mean[i] += a.vec[i] / anchors.length;
  const rows = anchors.map((a) => Float64Array.from(a.vec, (x, i) => x - mean[i]));

  const textAxis = (pair) => normalize(Float64Array.from(pair[1], (x, i) => x - pair[0][i]));
  const ax = axes.x ? textAxis(axes.x) : principal(rows, []);
  const ay = axes.y ? textAxis(axes.y) : principal(rows, [ax]);

  const raw = (vec) => {
    let x = 0, y = 0;
    for (let i = 0; i < d; i++) { const c = vec[i] - mean[i]; x += c * ax[i]; y += c * ay[i]; }
    return [x, y];
  };
  // Bounds: the anchors fill [-1, 1] with a little margin.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const a of anchors) {
    const [x, y] = raw(a.vec);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const sx = 1.8 / ((x1 - x0) || 1), sy = 1.8 / ((y1 - y0) || 1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const project = (vec) => { const [x, y] = raw(vec); return { x: (x - cx) * sx, y: (y - cy) * sy }; };

  for (const a of anchors) Object.assign(a, project(a.vec));

  return {
    anchors,
    /** A text vector's place (same modality as the anchors). */
    project,
    /** An audio vector's place: the softmax-weighted mean of its nearest anchors. */
    placeAudio(vec) {
      const sims = anchors.map((a) => ({ a, s: dot(vec, a.vec) })).sort((p, q) => q.s - p.s).slice(0, TOP_K);
      const top = sims[0].s;
      let wsum = 0, x = 0, y = 0;
      for (const { a, s } of sims) { const w = Math.exp((s - top) * LOGIT_SCALE); wsum += w; x += w * a.x; y += w * a.y; }
      return { x: x / wsum, y: y / wsum, anchor: sims[0].a.id, similarity: top };
    },
    /** The anchor nearest (x, y). */
    nearest(x, y) {
      let best = null, bd = Infinity;
      for (const a of anchors) { const dd = (a.x - x) ** 2 + (a.y - y) ** 2; if (dd < bd) { bd = dd; best = a; } }
      return best;
    },
    /**
     * The anchor a point belongs to, with hysteresis: `current` holds until
     * another anchor is clearly nearer (its distance under (1 - margin) of
     * current's), so a drag along a border never flaps.
     */
    owner(x, y, current, margin = 0.25) {
      const best = this.nearest(x, y);
      if (current == null || best.id === current) return best;
      const cur = anchors[current];
      const dc = Math.hypot(cur.x - x, cur.y - y), db = Math.hypot(best.x - x, best.y - y);
      return db < dc * (1 - margin) ? best : cur;
    },
  };
}
