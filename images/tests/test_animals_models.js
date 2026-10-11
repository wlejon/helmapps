// Find Animals with the real models (OWLv2 and BioCLIP from bro.models) on
// synthetic photos: the folder is analysed on the workers end to end, every
// photo gets a record of analyze()'s shape, the window keeps drawing while
// the models load and run, and opening the folder again answers from the
// cache without the models. Skips where this machine has no weights (set
// BRO_MODELS to a folder holding owlv2, bioclip-2 and species/ with
// upper-midwest.json and upper-midwest-herps/), or this bro
// cannot find animals.

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
  eq([rec.width, rec.height], [320, 240], 'the photo\'s size');
  eq(rec.timeSource, 'exif', 'its EXIF time');
  assert(rec.sharpness.frame && rec.sharpness.frame.tenengrad > 0, 'the frame\'s sharpness');
  if (rec.animal) assert(rec.species.length === 5 && rec.subject, 'an animal comes with five species and a subject');
}
console.log(`animals: ${[...a.results.values()].filter((r) => r.animal).map((r) => `${r.path.split('/').pop()} ` +
  `${r.detections[0].label} ${r.detections[0].score} -> ${r.species[0].common}`).join('; ') || 'none'}`);
eq(a.bursts.length, 6, 'the bursts by EXIF time');

// Another folder and back: answered from the cache, nothing analysed again.
app.openPath(other);
waitFor(() => a.dir === other && a.state === 'done', 'the other folder', 120000);
const before = a.analysed;
app.openPath(dir);
analysed(app, waitFor, 'the folder again, from the cache');
eq(a.analysed, before, 'nothing analysed again');

console.log('test_animals_models PASSED');
}
