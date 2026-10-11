/**
 * Finding animals, the model half: bro.vision.wildlife (OWLv2 finds the
 * animal, BioCLIP names its species) on its own thread, so the page never
 * waits on the GPU. The models load once and stay until the page says
 * dispose. bro.models is main-realm only, so the page finds the paths and
 * sends them.
 *
 *   { id, op: 'config', opts }   -> { id, config, hash, taxa }   reads files only, never weights;
 *                                   taxa: the lists' names of genera and up (readTaxa), for labels()
 *   { id, op: 'open', opts }     -> { id, device, cached }  loads the models (once per opts)
 *   { id, op: 'analyze', image, source } -> { id, result }  analyze()'s answer, in source pixels
 *   { id, op: 'dispose' }        -> { id }                  frees the models
 *   opts: { detector, classifier, species, model, cacheDir }
 *     or, in a test only, { stub: table, taxa, maxClassify } (js/wildlife/stub.js)
 *
 * Any request may answer { id, error } (a missing file answers it with `code`).
 */

import { configHash } from './records.js';
import { stubAnalyze } from './stub.js';

let analyzer = null;      // { key, analyze(image, opts), dispose() }

function wildlifeOpts(o) {
  return { detector: o.detector, classifier: o.classifier, species: o.species, model: o.model };
}

function config(o) {
  if (o.stub) return { stub: o.stub, maxClassify: o.maxClassify || 8 };
  return bro.vision.wildlife.config(wildlifeOpts(o));
}

function taxa(o) {
  if (o.stub && (o.taxa || !o.species)) return o.taxa || {};
  try { return bro.vision.wildlife.readTaxa(o.species || []); } catch (_) { return {}; }
}

function open(o) {
  const key = JSON.stringify(o);
  if (analyzer && analyzer.key === key) return analyzer;
  if (analyzer) analyzer.dispose();
  analyzer = null;
  if (o.stub) {
    analyzer = { key, device: 'stub', cached: true, dispose() {},
      analyze: (img, opts) => stubAnalyze(o.stub, img, { ...opts, maxClassify: o.maxClassify || 8 }) };
    return analyzer;
  }
  const an = bro.vision.wildlife.open({ ...wildlifeOpts(o), cacheDir: o.cacheDir || false });
  analyzer = { key, device: an.device, cached: an.cached, analyze: (img, opts) => an.analyze(img, opts), dispose: () => an.dispose() };
  return analyzer;
}

self.onmessage = (e) => {
  const m = e.data || {};
  let reply;
  try {
    if (m.op === 'config') {
      const c = config(m.opts);
      reply = { id: m.id, config: c, hash: configHash(c), taxa: taxa(m.opts) };
    } else if (m.op === 'open') {
      const a = open(m.opts);
      reply = { id: m.id, device: a.device, cached: !!a.cached };
    } else if (m.op === 'analyze') {
      if (!analyzer) throw new Error('the models are not loaded');
      reply = { id: m.id, result: analyzer.analyze(m.image, { source: m.source }) };
    } else if (m.op === 'dispose') {
      if (analyzer) analyzer.dispose();
      analyzer = null;
      reply = { id: m.id };
    } else {
      reply = { id: m.id, error: `unknown op ${m.op}` };
    }
  } catch (err) {
    reply = { id: m.id, error: String((err && err.message) || err), code: err && err.code };
  }
  self.postMessage(reply);
};
