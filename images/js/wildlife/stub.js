/**
 * TEST ONLY: a stand-in for OWLv2 + BioCLIP, so the model-free tests can
 * drive Find Animals without weights. It never runs unless a test calls
 * app.wildlife.useStub(table) (tests/wildlife.js); a normal run has no way
 * to reach it, and the app never shows what it answers outside a test.
 *
 * It finds the colours of `table` in a photo, like the burst tests' colour
 * key stands in for SAM:
 *   table: [{ color: [r, g, b], tolerance = 40, label = 'a bird',
 *             species: [{ common, scientific, score }, ...] }, ...]
 * The entry whose colour covers the most pixels (at least 0.2% of them) is
 * the animal: its pixels' bounding box is the detection, its `species` the
 * answer. No entry: no animal. The result has analyze()'s shape
 * (docs/vision-api.js, Wildlife), in the source photo's pixels.
 */

const r1 = (x) => Math.round(x * 10) / 10;

export function stubAnalyze(table, image, { source } = {}) {
  const { width: w, height: h } = image;
  const ch = image.channels || 4;
  const px = image.pixels || image.data;
  let best = null;
  for (const entry of table) {
    const [cr, cg, cb] = entry.color;
    const tol = entry.tolerance || 40;
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0, i = y * w * ch; x < w; x++, i += ch) {
        if (Math.abs(px[i] - cr) > tol || Math.abs(px[i + 1] - cg) > tol || Math.abs(px[i + 2] - cb) > tol) continue;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (n >= 0.002 * w * h && (!best || n > best.n)) best = { entry, n, box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] };
  }
  if (!best) return { animal: false, detections: [], subject: null, species: [], timing: { detect: 0, classify: null } };
  const sx = source ? source.width / w : 1, sy = source ? source.height / h : 1;
  const box = [r1(best.box[0] * sx), r1(best.box[1] * sy), r1(best.box[2] * sx), r1(best.box[3] * sy)];
  const sw = source ? source.width : w, sh = source ? source.height : h;
  const side = Math.min(Math.max(sw, sh), Math.round(Math.max(box[2], box[3]) * 1.3));
  const subject = {
    x: Math.round(Math.min(Math.max(box[0] + box[2] / 2 - side / 2, 0), Math.max(0, sw - side))),
    y: Math.round(Math.min(Math.max(box[1] + box[3] / 2 - side / 2, 0), Math.max(0, sh - side))),
    w: Math.min(side, sw), h: Math.min(side, sh),
  };
  const species = (best.entry.species || []).map((s) => ({
    common: s.common, scientific: s.scientific || s.common, family: s.family || '', order: s.order || '',
    class: s.class || 'Aves', score: s.score, similarity: s.similarity == null ? 0.3 : s.similarity,
  }));
  return {
    animal: true,
    detections: [{ label: best.entry.label || 'a bird', score: 0.5, box }],
    subject,
    species,
    timing: { detect: 0, classify: 0 },
  };
}
