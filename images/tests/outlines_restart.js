// The second start of test_animals_outlines.js (not a test of its own): a
// fresh bro-headless on the same BRO_APP_HOME keeps the outlines on (the
// showOutlines setting she turned on), so a photo shows every box.

import { app, waitFor, eq } from '/lib/test.js';
import { stubTable, analysed, MALLARD, ODD_BIRD, LONG } from '/app/tests/wildlife.js';
import { shown } from '/app/tests/images.js';

const OUTLINE_TABLE = [MALLARD, ODD_BIRD, LONG];   // test_animals_outlines.js's

const path = require('path');
const { dir } = JSON.parse(process.env.IV_OUTLINES_EXPECT || '{}');
assert(dir, 'IV_OUTLINES_EXPECT names the folder');

const W = app.wildlife;
W.useStub(stubTable(OUTLINE_TABLE));
eq(app.settings.get('showOutlines'), true, 'the outlines still on');
app.openPath(dir);
waitFor(() => app.state.mode === 'grid' && app.folder.items.length === 4, 'the folder');
analysed(app, waitFor);
app.openImage(path.join(dir, 'm_01.jpg'));
shown(app, waitFor, 'm_01.jpg');
waitFor(() => W.outlines.state().boxes.length === 2, 'every box of the photo');
eq(document.querySelector('[data-command="animals-outlines"]').classList.contains('active'), true, 'the button on');
console.log('outlines_restart PASSED');
