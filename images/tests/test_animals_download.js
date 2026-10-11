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
import { wildlifeSupported, canFetch, locateModels, bytesOf } from '/app/js/wildlife/models.js';
import { formatBytes } from '/lib/format.js';

const net = require('net');
const path = require('path');
const fs = require('fs');

if (!wildlifeSupported()) skipTest('this bro cannot find animals (bro.vision.wildlife, bro.lm.loadClip or a GPU missing)');
else if (!canFetch()) skipTest('this bro cannot fetch models');
else if (!process.env.BRO_APP_HOME) skipTest('needs a scratch BRO_APP_HOME (scripts/run_tests.sh sets one): the download installs models');
else if (!locateModels('bioclip-2', '').missing.length) skipTest('this machine already has the animal models in bro.models');
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
const herpsList = enc(JSON.stringify({ species: [
  { common: 'Common Garter Snake', scientific: 'Thamnophis sirtalis', class: 'Squamata', family: 'Colubridae' }] }));
const arthList = enc(JSON.stringify({ species: [
  { common: 'Common Green Darner', scientific: 'Anax junius', class: 'Insecta', order: 'Odonata', family: 'Aeshnidae' }],
taxa: { Aeshnidae: { rank: 'family', common: 'Darners' } } }));
const petsList = enc(JSON.stringify({ species: [
  { common: 'Domestic Cat', scientific: 'Felis catus', class: 'Mammalia', order: 'Carnivora', family: 'Felidae' }] }));
// The species folder holds the herps, the arthropods and the pets in folders of their own, as the dataset does.
const HERPS = 'species/upper-midwest-herps';
const ARTH = 'species/upper-midwest-arthropods';
const PETS = 'species/pets';
const folders = {
  owlv2: { 'model.safetensors': weights(64 * 1024, 7), 'config.json': enc('{"model_type":"owlv2"}\n') },
  'bioclip-2': { 'model.safetensors': weights(96 * 1024, 11), 'config.json': enc('{"model_type":"clip"}\n') },
  species: { 'upper-midwest.json': speciesList },
  [HERPS]: { 'species.json': herpsList },
  [ARTH]: { 'species.json': arthList },
  [PETS]: { 'species.json': petsList },
};
const files = {};
const listings = {};
for (const [name, fl] of Object.entries(folders)) {
  const list = name === 'species' ? [HERPS, ARTH, PETS].map((p) => ({ type: 'directory', path: p, size: 0, oid: '0' })) : [];
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

// The lists' taxa maps name genera and up for the labels.
eq(app.wildlife.analysis.taxa, { Aeshnidae: { rank: 'family', common: 'Darners' } }, 'the arthropods\' taxa map is read');

// A species folder from before the herps: only their folder is offered, and fetched.
const herpsDir = bro.models.find(HERPS);
fs.rmSync(herpsDir, { recursive: true, force: true });
eq(bro.models.find(HERPS), null, 'the herps folder is gone');
assert(bro.models.find('species') !== null, 'the species folder stays');
app.wildlife.folderChanged({ force: true });
waitFor(() => shown(bar()) && shown(action()), 'the herps are offered');
eq(app.wildlife.located.missing, [HERPS], 'only the herps folder is missing');
eq(action().textContent, 'Download (82.7 KB)', 'offered with its size');
clickEl(action());
waitFor(() => !app.wildlife.download, 'the herps download', 30000);
eq(path.resolve(bro.models.find(HERPS)), path.resolve(process.env.BRO_APP_HOME, 'models', HERPS), 'installed below the species folder');
eq(fs.readFileSync(path.join(bro.models.find(HERPS), 'species.json')).length, herpsList.length, 'the list is on disk');
waitFor(() => !shown(bar()), 'the status bar is quiet again');
eq(app.wildlife.located, null, 'nothing missing');

// One from before the arthropods and the pets: both offered at once, fetched one after the other.
for (const f of [ARTH, PETS]) fs.rmSync(bro.models.find(f), { recursive: true, force: true });
app.wildlife.folderChanged({ force: true });
waitFor(() => shown(bar()) && shown(action()), 'the two lists are offered');
eq(app.wildlife.located.missing, [ARTH, PETS], 'both list folders are missing');
eq(action().textContent, `Download (${formatBytes(bytesOf([ARTH, PETS]))})`, 'offered with their sizes together');
clickEl(action());
waitFor(() => !app.wildlife.download, 'the lists download', 30000);
for (const [f, list] of [[ARTH, arthList], [PETS, petsList]]) {
  eq(path.resolve(bro.models.find(f)), path.resolve(process.env.BRO_APP_HOME, 'models', f), `${f} installed below the species folder`);
  eq(fs.readFileSync(path.join(bro.models.find(f), 'species.json')).length, list.length, `${f}: the list is on disk`);
}
waitFor(() => !shown(bar()), 'the status bar is quiet once more');
eq(app.wildlife.located, null, 'nothing missing any more');

tcp.close();
console.log('test_animals_download PASSED');
}
