// The second start of test_animals_answers.js (not a test of its own): a
// fresh bro-headless on the same BRO_APP_HOME opens the folder again; her
// answers come back from the data dir (the tiles, hers, and the choice of
// scope she made last), and nothing is analysed again.

import { app, waitFor, eq } from '/lib/test.js';
import { stubTable, analysed, TABLE, FROG, SPIDER, MORE_NAMES, TAXA } from '/app/tests/wildlife.js';

const path = require('path');
const { dir, want, scope } = JSON.parse(process.env.IV_ANSWERS_EXPECT || '{}');
assert(dir, 'IV_ANSWERS_EXPECT names the folder');

const W = app.wildlife;
W.useStub(stubTable([...TABLE, FROG, SPIDER]), { taxa: TAXA, names: MORE_NAMES });
eq(app.settings.get('showNoAnimals'), true, 'the settings of the first run (every photo shown)');
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 11, 'the folder');
analysed(app, waitFor);
eq(W.analysis.analysed, 0, 'answered from the cache: nothing analysed again');
waitFor(() => W.answers.keys.size === 11, 'every photo\'s key');
const got = {};
for (const it of app.shownItems()) got[path.basename(it.path)] = { tag: it.tag, mine: it.mine };
eq(got, want, 'every tile as before, her answers marked as hers');
eq(app.settings.get('answerScope'), scope, 'the scope she chose last');
console.log('answers_restart PASSED');
