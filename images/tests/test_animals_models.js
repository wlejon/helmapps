// Find Animals with the real models (OWLv2 and BioCLIP from bro.models) on
// synthetic photos: the folder is analysed on the workers end to end, every
// photo gets a record of analyze()'s shape, the window keeps drawing while
// the models load and run, and opening the folder again answers from the
// cache without the models. Skips where this machine has no weights (set
// BRO_MODELS to a folder holding owlv2, bioclip-2 and species/ with
// upper-midwest.json, upper-midwest-herps/, upper-midwest-arthropods/ and
// pets/), or this bro cannot find animals.

import { app, waitFor, measureFrames, eq, fixtureDir } from '/lib/test.js';
import { shotsTree, analysed } from '/app/tests/wildlife.js';
import { wildlifeSupported, locateModels } from '/app/js/wildlife/models.js';

const reason = !wildlifeSupported() ? 'this bro cannot find animals (bro.vision.wildlife, bro.lm.loadClip or a GPU missing)'
  : (() => {
    const loc = locateModels('bioclip-2', '');
    return loc.missing.length || loc.listMissing
      ? `no animal models in bro.models (${loc.missing.join(', ') || 'species list'}; dirs ${bro.models.dirs.join(', ')})` : '';
  })();
if (reason) skipTest(reason);
else run();

function run() {
const dir = fixtureDir(shotsTree());
const other = fixtureDir({ 'x.png': bro.image.encodePng(new Uint8Array(64 * 48 * 4).fill(128), 64, 48, 4) });
const a = app.wildlife.analysis;

const t0 = Date.now();
app.openPath(dir);
const f = measureFrames(() => a.state === 'done' && a.results.size === 9 && !a.groupTimer,'the folder analysed with the models', 300000);
console.log(`9 photos with the models: ${Date.now() - t0} ms (loading included); worst frame ${f.maxMs.toFixed(1)} ms, ` +
  `${f.slow} of ${f.frames} over 16.7 ms`);
assert(f.maxMs < 50, `the window keeps drawing while the models load and run (worst ${f.maxMs.toFixed(1)} ms)`);
eq(a.analysed, 9, 'every photo went through the models');
for (const rec of a.results.values()) {
  assert(!rec.error, `${rec.path}: ${rec.error}`);
  assert(typeof rec.animal === 'boolean' && Array.isArray(rec.detections) && Array.isArray(rec.species), `${rec.path}: analyze()'s shape`);
  assert(Array.isArray(rec.animals) && typeof rec.animalsDropped === 'number', `${rec.path}: every animal of the photo`);
  if (rec.animal) assert(rec.animals.length > 0 && rec.animals[0].taxa && rec.animals[0].taxa.class, 'its crops with their taxa');
  eq([rec.width, rec.height], [320, 240], 'the photo\'s size');
  eq(rec.timeSource, 'exif', 'its EXIF time');
  assert(rec.sharpness.frame && rec.sharpness.frame.tenengrad > 0, 'the frame\'s sharpness');
  if (rec.animal) assert(rec.species.length === 5 && rec.subject, 'an animal comes with five species and a subject');
  // Each crop's embedding beside the record (not in it), unit length, when this bro gives them.
  assert(!rec.animals.some((x) => 'embedding' in x), 'no embedding in the record');
  if (typeof bro.vision.wildlife.nearest === 'function') {
    rec.animals.forEach((x, i) => {
      const e = a.embeddingOf(rec.path, i);
      assert(e && e.length >= 256 && Math.abs(Math.hypot(...e) - 1) < 1e-3, `${rec.path}: crop ${i}'s embedding`);
    });
  }
}
console.log(`animals: ${[...a.results.values()].filter((r) => r.animal).map((r) => `${r.path.split('/').pop()} ` +
  `${r.detections[0].label} ${r.detections[0].score} -> ${r.species[0].common}`).join('; ') || 'none'}`);
eq(a.bursts.length, 6, 'the bursts by EXIF time');
assert(Object.keys(a.taxa).length > 0, 'the lists\' names of genera and up are read');

// Another folder and back: answered from the cache, nothing analysed again.
app.openPath(other);
waitFor(() => a.dir === other && a.state === 'done', 'the other folder', 120000);
const before = a.analysed;
app.openPath(dir);
analysed(app, waitFor, 'the folder again, from the cache');
eq(a.analysed, before, 'nothing analysed again');
const firstAnimal = [...a.results.values()].find((r) => r.animal && r.animals.length);
if (firstAnimal && typeof bro.vision.wildlife.nearest === 'function') {
  waitFor(() => a.embeddingOf(firstAnimal.path, 0), 'the embeddings read back from the cache');
}

console.log('test_animals_models PASSED');
}
