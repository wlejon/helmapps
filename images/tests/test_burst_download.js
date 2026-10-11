// No segmentation model on the machine: Select Subject (S, and B) offers to
// download SAM 2.1 with its size, a click starts bro.models.fetch with a
// progress bar in the subject bar, a failure says why and offers a retry, and
// once it is installed the tool carries on with the model find() now answers.
// The source is a stub on loopback standing in for the Hugging Face dataset
// (its tree and resolve paths): no real network, and the weights are a few
// bytes, so the tool is never asked to load them.

import { app, waitFor, eq, press, clickEl, fixtureDir } from '/lib/test.js';
import { burstTree, defaultBurst, withoutAnimals } from '/app/tests/burst.js';
import { findModelSpec, downloadableModel } from '/app/js/burst/session.js';

const net = require('net');
const path = require('path');
const fs = require('fs');

if (findModelSpec()) skipTest('this machine already has segmentation weights in bro.models');
else if (!downloadableModel()) skipTest('this bro cannot fetch models or run SAM 2.1');
else if (!process.env.BRO_APP_HOME) skipTest('needs a scratch BRO_APP_HOME (scripts/run_tests.sh sets one): the download installs a model');
else await run();

async function run() {
const NAME = 'sam2.1-hiera-base-plus';

// ---- the stub source ----------------------------------------------------------
const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => Array.from(new Uint8Array(buf), (v) => v.toString(16).padStart(2, '0')).join('');
const weights = new Uint8Array(256 * 1024).map((_, i) => (i * 7) & 255);
const config = enc('{"model_type":"sam2_video"}\n');
const blobHead = enc(`blob ${config.length}\0`);
const blob = new Uint8Array(blobHead.length + config.length);
blob.set(blobHead, 0); blob.set(config, blobHead.length);
const files = { [`${NAME}/model.safetensors`]: weights, [`${NAME}/config.json`]: config };
const listing = JSON.stringify([
  { type: 'file', path: `${NAME}/config.json`, size: config.length, oid: hex(await crypto.subtle.digest('SHA-1', blob)) },
  { type: 'file', path: `${NAME}/model.safetensors`, size: weights.length, oid: '0',
    lfs: { oid: hex(await crypto.subtle.digest('SHA-256', weights)), size: weights.length, pointerSize: 134 } },
]);

const server = { down: true };
const tcp = net.createServer((sock) => {
  let buf = '';
  sock.on('error', () => {});
  sock.on('data', (chunk) => {
    buf += new TextDecoder().decode(chunk);
    if (buf.indexOf('\r\n\r\n') < 0) return;
    const target = decodeURIComponent(buf.split(' ')[1]);
    buf = '';
    const reply = (status, body) => {
      sock.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n`);
      sock.write(body);
      sock.end();
    };
    if (server.down) return reply('503 Service Unavailable', enc('down'));
    if (target === `/api/datasets/t/stub/tree/main/${NAME}`) return reply('200 OK', enc(listing));
    const m = /^\/datasets\/t\/stub\/resolve\/main\/(.+)$/.exec(target);
    if (m && files[m[1]]) return reply('200 OK', files[m[1]]);
    reply('404 Not Found', enc('{"error":"not found"}'));
  });
});
tcp.listen(0);
bro.settings.setDefault('models.sources', `http://127.0.0.1:${tcp.address().port}/datasets/t/stub`);

// ---- a photo on screen ------------------------------------------------------------
const frames = defaultBurst(3, 0);
const dir = fixtureDir(burstTree(frames, { w: 320, h: 240, r: 16 }));
withoutAnimals();
app.openPath(path.join(dir, frames[0].name));
waitFor(() => app.state.pic && !app.state.pic.placeholder, 'the photo');

const bar = () => document.querySelector('.iv-subject-bar');
const hint = () => document.querySelector('.iv-subject-text').textContent;
const btn = () => document.querySelector('.iv-subject-download');
const shown = (el) => el && !el.classList.contains('hidden');
const progress = () => document.querySelector('.iv-subject-progress');

// B without a model leads to Select Subject, where the download is offered.
press('b');
assert(app.burst.picking, 'B with no model turns on Select Subject');
assert(shown(bar()), 'the subject bar shows');
eq(hint(), 'No segmentation model on this machine', 'the bar says there is no model');
assert(shown(btn()), 'the download is offered');
eq(btn().textContent, 'Download SAM 2.1 (309 MB)', 'with the model and its size');
assert(!shown(document.querySelector('.iv-subject-bar .btn.small:not(.ghost):not(.iv-subject-download)')),
  'no Stabilize button without a model');
press('s');
assert(!app.burst.picking, 'S turns it off');
press('s');
assert(app.burst.picking && shown(btn()), 'and S on again offers the download');

// The server is down: the download fails, says why, offers a retry.
clickEl(btn());
assert(shown(progress()) && !shown(btn()), 'a click shows the progress bar in the bar');
assert(/^Downloading SAM 2\.1/.test(hint()), `the bar says it is downloading: ${hint()}`);
waitFor(() => app.burst.download && app.burst.download.state === 'failed', 'the failed download', 30000);
assert(/^Could not download SAM 2\.1: /.test(hint()), `the failure says why: ${hint()}`);
assert(/offline/.test(hint()), `a server that cannot be reached reads as offline: ${hint()}`);
eq(btn().textContent, 'Retry', 'and offers a retry');
assert(!shown(progress()), 'the progress bar goes');
assert(bro.models.find(NAME) === null, 'nothing installed');

// The server is back: Retry installs it and the tool carries on.
server.down = false;
clickEl(btn());
waitFor(() => !app.burst.download, 'the download', 30000);
const spec = app.burst.modelSpec();
assert(spec && spec.name === NAME && spec.kind === 'sam2', `the tool now has the model: ${JSON.stringify(spec)}`);
eq(path.resolve(spec.dir), path.resolve(process.env.BRO_APP_HOME, 'models', NAME), 'installed in the per-user models folder');
eq(fs.readFileSync(path.join(spec.dir, 'model.safetensors')).length, weights.length, 'its weights are on disk');
eq(hint(), 'Click the subject · Alt+click removes an area', 'the bar asks for the subject');
assert(!shown(btn()) && !shown(progress()), 'no download offered any more');
assert(app.burst.picking, 'Select Subject is still on');

tcp.close();
console.log('test_burst_download PASSED');
}
