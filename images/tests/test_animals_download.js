// No animal models on the machine: opening a folder offers them in the
// status bar with their size, a click starts bro.models.fetch with a
// progress bar and Cancel, a failure says why and offers a retry, and once
// they are installed a toast says so and the folder is analysed. The source
// is a stub on loopback standing in for the Hugging Face dataset (its tree
// and resolve paths), and the "weights" are a few bytes, so the analysis
// after the install runs the test stub (useStub with requireModels: the
// models must be found first, then the stub answers in their place).

import { app, waitFor, eq, clickEl, fixtureDir } from '/lib/test.js';
import { shotsTree, stubTable, analysed } from '/app/tests/wildlife.js';
import { wildlifeSupported, canFetch, locateModels } from '/app/js/wildlife/models.js';

const net = require('net');
const path = require('path');
const fs = require('fs');

if (!wildlifeSupported()) skipTest('this bro cannot find animals (bro.vision.wildlife, bro.lm.loadClip or a GPU missing)');
else if (!canFetch()) skipTest('this bro cannot fetch models');
else if (!process.env.BRO_APP_HOME) skipTest('needs a scratch BRO_APP_HOME (scripts/run_tests.sh sets one): the download installs models');
else if (!locateModels('bioclip-2', 'upper-midwest.json').missing.length) skipTest('this machine already has the animal models in bro.models');
else await run();

async function run() {
// ---- the stub source ----------------------------------------------------------
const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => Array.from(new Uint8Array(buf), (v) => v.toString(16).padStart(2, '0')).join('');
const gitBlobSha1 = async (bytes) => {
  const head = enc(`blob ${bytes.length}\0`);
  const blob = new Uint8Array(head.length + bytes.length);
  blob.set(head, 0); blob.set(bytes, head.length);
  return hex(await crypto.subtle.digest('SHA-1', blob));
};
const weights = (n, k) => new Uint8Array(n).map((_, i) => (i * k) & 255);
const speciesList = enc(JSON.stringify({ species: [
  { common: 'Blue Jay', scientific: 'Cyanocitta cristata', class: 'Aves', order: 'Passeriformes', family: 'Corvidae' }] }));
const folders = {
  owlv2: { 'model.safetensors': weights(64 * 1024, 7), 'config.json': enc('{"model_type":"owlv2"}\n') },
  'bioclip-2': { 'model.safetensors': weights(96 * 1024, 11), 'config.json': enc('{"model_type":"clip"}\n') },
  species: { 'upper-midwest.json': speciesList },
};
const files = {};
const listings = {};
for (const [name, fl] of Object.entries(folders)) {
  const list = [];
  for (const [f, bytes] of Object.entries(fl)) {
    files[`${name}/${f}`] = bytes;
    if (f.endsWith('.safetensors')) {
      list.push({ type: 'file', path: `${name}/${f}`, size: bytes.length, oid: '0',
        lfs: { oid: hex(await crypto.subtle.digest('SHA-256', bytes)), size: bytes.length, pointerSize: 134 } });
    } else list.push({ type: 'file', path: `${name}/${f}`, size: bytes.length, oid: await gitBlobSha1(bytes) });
  }
  listings[name] = JSON.stringify(list);
}

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
    const t = /^\/api\/datasets\/t\/stub\/tree\/main\/(.+)$/.exec(target);
    if (t && listings[t[1]]) return reply('200 OK', enc(listings[t[1]]));
    const m = /^\/datasets\/t\/stub\/resolve\/main\/(.+)$/.exec(target);
    if (m && files[m[1]]) return reply('200 OK', files[m[1]]);
    reply('404 Not Found', enc('{"error":"not found"}'));
  });
});
tcp.listen(0);
bro.settings.setDefault('models.sources', `http://127.0.0.1:${tcp.address().port}/datasets/t/stub`);

// ---- a folder, no models ---------------------------------------------------------------
const dir = fixtureDir(shotsTree());
app.wildlife.useStub(stubTable(), { requireModels: true });
app.openPath(dir);
waitFor(() => app.folder.items.length === 9, 'the folder');

const bar = () => document.querySelector('.iv-animals');
const text = () => document.querySelector('.iv-animals-text').textContent;
const action = () => document.querySelector('.iv-animals-action');
const cancel = () => document.querySelector('.iv-animals-cancel');
const progress = () => document.querySelector('.iv-animals-progress');
const shown = (el) => el && !el.classList.contains('hidden');

waitFor(() => shown(bar()), 'the status bar offers the models');
eq(text(), 'Finding animals needs its models', 'it says what is missing');
eq(action().textContent, 'Download (2.2 GB)', 'and offers them with their size');
eq(app.wildlife.analysis.results.size, 0, 'nothing is analysed without them');
assert(document.querySelector('.iv-animals-filter').classList.contains('hidden'), 'no Animals menu yet');
eq(app.grid.items.length, 9, 'every photo shows');

// Cancel stops it; the offer comes back.
clickEl(action());
assert(shown(progress()) && shown(cancel()) && !shown(action()), 'a click shows the progress bar and Cancel');
assert(/^Downloading animal models/.test(text()), `the bar says it is downloading: ${text()}`);
clickEl(cancel());
waitFor(() => !app.wildlife.download, 'the download stops');
eq(action().textContent, 'Download (2.2 GB)', 'the offer is back');
assert(!shown(progress()) && !shown(cancel()), 'the progress bar and Cancel go');

// The server is down: the download fails, says why, offers a retry.
clickEl(action());
waitFor(() => app.wildlife.download && app.wildlife.download.state === 'failed', 'the failed download', 30000);
assert(/^Could not download the animal models: /.test(text()), `the failure says why: ${text()}`);
assert(/offline/.test(text()), `a server that cannot be reached reads as offline: ${text()}`);
eq(action().textContent, 'Retry', 'and offers a retry');
assert(!shown(progress()), 'the progress bar goes');
assert(bro.models.find('owlv2') === null, 'nothing installed');

// The server is back: Retry installs every folder, and the folder is analysed.
server.down = false;
clickEl(action());
waitFor(() => !app.wildlife.download, 'the download', 30000);
for (const name of Object.keys(folders)) {
  const d = bro.models.find(name);
  eq(d && path.resolve(d), path.resolve(process.env.BRO_APP_HOME, 'models', name), `${name} installed in the per-user models folder`);
}
eq(fs.readFileSync(path.join(bro.models.find('bioclip-2'), 'model.safetensors')).length, folders['bioclip-2']['model.safetensors'].length,
  'the weights are on disk');
waitFor(() => /installed/.test(document.body.textContent), 'a toast says they are installed');
analysed(app, waitFor, 'the folder analysed after the install');
eq(app.grid.items.length, 7, 'the photos without animals now hide');
assert(shown(document.querySelector('.iv-animals-filter')), 'the Animals menu shows');
assert(!shown(bar()), 'the status bar is quiet once it is done');

tcp.close();
console.log('test_animals_download PASSED');
}
