/**
 * Finding animals, the CPU half of a photo: decode, EXIF, sharpness. Two of
 * these run beside the model thread (analyze-worker.js), so the next photos
 * decode while the models look at this one. The steps and sizes are
 * broworkshop's ai/birds batch (its decode-worker.js), whose records the
 * results match: a 3000 px decode for sharpness, area-resized to 1280 px
 * for the detector and the classifier.
 *
 *   { id, op: 'decode', path, detectSize, sharpSize }
 *     -> { id, image: { width, height, channels, pixels } (detectSize on the
 *          long side; its buffer is transferred), source: { width, height },
 *          exif: { dateTaken } | null, frame (whole-frame sharpness), ms }
 *     The sharpness image stays here for:
 *   { id, op: 'subject', job, box, sourceWidth, sourceHeight }
 *     -> { id, subject }  the sharpness of the box, and the image is freed
 *   { op: 'drop', job }   frees it without measuring
 *
 * A photo that cannot be decoded answers { id, error }.
 */

const kept = new Map();   // job -> the sharpness image

function wildlife() {
  return bro.vision.wildlife;
}

/** Long side `size`, aspect kept, area filter (ai/birds' resized()). */
function resized(img, size) {
  const s = Math.min(1, size / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  if (w === img.width && h === img.height) return img;
  const out = new Uint8Array(w * h * img.channels);
  bro.image.resizeU8(out, img.pixels, { srcW: img.width, srcH: img.height, dstW: w, dstH: h,
    channels: img.channels, filter: 'area' });
  return { width: w, height: h, channels: img.channels, pixels: out };
}

function decode(m) {
  const t0 = Date.now();
  const big = bro.image.decodeScaled(m.path, { width: m.sharpSize, height: m.sharpSize });
  if (!big || !big.width) throw new Error((big && big.error) || 'bro.image cannot decode this file');
  let image = resized(big, m.detectSize);
  // The detection image is transferred away; the kept one must not be it.
  if (image === big) image = { width: big.width, height: big.height, channels: big.channels, pixels: big.pixels.slice() };
  let exif = null;
  try { exif = bro.image.readExif(m.path); } catch (_) { exif = null; }
  const frame = wildlife().sharpness(big);
  kept.set(m.job, big);
  return {
    id: m.id,
    image: { width: image.width, height: image.height, channels: image.channels, pixels: image.pixels },
    source: { width: big.sourceWidth || big.width, height: big.sourceHeight || big.height },
    exif: exif && exif.dateTaken ? { dateTaken: exif.dateTaken } : null,
    frame,
    ms: Date.now() - t0,
  };
}

function subject(m) {
  const big = kept.get(m.job);
  kept.delete(m.job);
  if (!big) throw new Error('no image kept for this photo');
  return { id: m.id, subject: wildlife().sharpness(big, { box: m.box, source: { width: m.sourceWidth, height: m.sourceHeight } }) };
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.op === 'drop') { kept.delete(m.job); return; }
  let reply;
  try {
    if (m.op === 'decode') reply = decode(m);
    else if (m.op === 'subject') reply = subject(m);
    else reply = { id: m.id, error: `unknown op ${m.op}` };
  } catch (err) {
    kept.delete(m.job);
    reply = { id: m.id, error: String((err && err.message) || err) };
  }
  self.postMessage(reply, reply.image ? [reply.image.pixels.buffer] : []);
};
