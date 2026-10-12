/**
 * TEST ONLY: a stand-in for OWLv2 + BioCLIP, so the model-free tests can
 * drive Find Animals without weights. It never runs unless a test calls
 * app.wildlife.useStub(table) (tests/wildlife.js); a normal run has no way
 * to reach it, and the app never shows what it answers outside a test.
 *
 * It finds the colours of `table` in a photo, like the burst tests' colour
 * key stands in for SAM:
 *   table: [{ color: [r, g, b], tolerance = 40, label = 'a bird',
 *             species: [{ common, scientific, score, class?, order?, family? }, ...] }, ...]
 * Every connected patch of an entry's colour covering at least 0.2% of the
 * photo is an animal: its bounding box a detection (best first: the
 * biggest), the entry's `species` its answer, and its genera, families,
 * orders and classes bro.vision.wildlife.taxaScores of them, as analyze()
 * ranks a crop, and its `queryTop` (queryTopOf). The first `maxClassify` are classified (`animals`), the
 * rest counted (`animalsDropped`). No patch: no animal. The result has
 * analyze()'s shape (docs/vision-api.js, Wildlife), in the source photo's
 * pixels; with `embeddings`, each animal's is stubEmbedding of its colour.
 */

const r1 = (x) => Math.round(x * 10) / 10;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** The connected patches (4-neighbours) of the pixels `on` marks: [{ n, box: [x, y, w, h] }]. */
function patches(on, w, h) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || seen[start]) continue;
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of near) if (j >= 0 && on[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    out.push({ n, box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] });
  }
  return out;
}

function speciesRows(entry) {
  return (entry.species || []).map((s) => ({
    common: s.common, scientific: s.scientific || s.common, family: s.family || '', order: s.order || '',
    class: s.class || 'Aves', score: s.score, similarity: s.similarity == null ? 0.3 : s.similarity,
  }));
}

/** A crop's genera and up, as analyze() rounds them (top 3 a rank). */
function taxaOf(rows) {
  const t = bro.vision.wildlife.taxaScores(rows, rows.map((s) => s.score), { top: 3 });
  const out = {};
  for (const r of Object.keys(t)) out[r] = t[r].map((e) => ({ ...e, score: r4(e.score) }));
  return out;
}

/**
 * A crop's suggestions as analyze() keeps them (`queryTop`): its rows of
 * its query's classes (every row when none is), their scores renormalised
 * over those rows (a softmax over a subset is the same odds), top 5.
 */
function queryTopOf(rows, query) {
  const classes = bro.vision.wildlife.queryClasses(query);
  let sub = classes ? rows.filter((s) => classes.includes(s.class)) : rows;
  if (!sub.length) sub = rows;
  const z = sub.reduce((s, r) => s + r.score, 0) || 1;
  return sub.slice().sort((a, b) => b.score - a.score).slice(0, 5)
    .map((s) => ({ common: s.common, scientific: s.scientific, score: r4(s.score / z) }));
}

/**
 * A crop's stand-in image embedding: its entry's colour and the colour's
 * complement, as a unit vector (8 numbers), so the same colour is the same
 * animal (similarity 1) and the table's colours sit well apart.
 */
export function stubEmbedding(color) {
  const [r, g, b] = color;
  const v = [r, g, b, 255 - r, 255 - g, 255 - b, 40, 40];
  const n = Math.hypot(...v) || 1;
  return Float32Array.from(v, (x) => x / n);
}

export function stubAnalyze(table, image, { source, maxClassify = 8, embeddings = false } = {}) {
  const { width: w, height: h } = image;
  const ch = image.channels || 4;
  const px = image.pixels || image.data;
  const found = [];
  for (const entry of table) {
    const [cr, cg, cb] = entry.color;
    const tol = entry.tolerance || 40;
    const on = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0, i = y * w * ch; x < w; x++, i += ch) {
        if (Math.abs(px[i] - cr) <= tol && Math.abs(px[i + 1] - cg) <= tol && Math.abs(px[i + 2] - cb) <= tol) on[y * w + x] = 1;
      }
    }
    for (const p of patches(on, w, h)) if (p.n >= 0.002 * w * h) found.push({ entry, ...p });
  }
  const none = { animal: false, detections: [], subject: null, species: [], animals: [], animalsDropped: 0,
    timing: { detect: 0, classify: null } };
  if (!found.length) return none;
  found.sort((a, b) => b.n - a.n || a.box[0] - b.box[0] || a.box[1] - b.box[1]);
  const sx = source ? source.width / w : 1, sy = source ? source.height / h : 1;
  const sw = source ? source.width : w, sh = source ? source.height : h;
  const detections = found.map((f) => ({
    label: f.entry.label || 'a bird', score: 0.5,
    box: [r1(f.box[0] * sx), r1(f.box[1] * sy), r1(f.box[2] * sx), r1(f.box[3] * sy)],
  }));
  const animals = [];
  for (const [i, f] of found.entries()) {
    if (animals.length >= maxClassify) break;
    const box = detections[i].box;
    const side = Math.min(Math.max(sw, sh), Math.round(Math.max(box[2], box[3]) * 1.3));
    const subject = {
      x: Math.round(Math.min(Math.max(box[0] + box[2] / 2 - side / 2, 0), Math.max(0, sw - side))),
      y: Math.round(Math.min(Math.max(box[1] + box[3] / 2 - side / 2, 0), Math.max(0, sh - side))),
      w: Math.min(side, sw), h: Math.min(side, sh),
    };
    const species = speciesRows(f.entry);
    const animal = { box, score: detections[i].score, label: detections[i].label, subject, species,
      taxa: taxaOf(species), candidates: 'all', queryTop: queryTopOf(species, detections[i].label) };
    if (embeddings) animal.embedding = stubEmbedding(f.entry.color);
    animals.push(animal);
  }
  return {
    animal: true,
    detections,
    subject: animals[0].subject,
    species: animals[0].species,
    animals,
    animalsDropped: found.length - animals.length,
    timing: { detect: 0, classify: 0 },
  };
}
