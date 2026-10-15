// Choosing the models in the app: the setup card when they are not found,
// Choose… with a folder picker, a wrong folder refused with the reason, Use
// Default, Load enabled only when all three will do, the choice saved on
// Load, a failed load reported on the card, and the Models… dialog later.

import { app, waitFor, eq, press, clickEl, currentDialog, dialogButton, fixtureDir, mod } from '/lib/test.js';
import { fakeBackend } from '/app/tests/fake_backend.js';

const path = require('path');

if (app.state.phase === 'unavailable') skipTest(app.state.reason);
else if (app.state.phase !== 'missing') skipTest(`the models are found here (phase ${app.state.phase}); run without BRO_MODELS`);
else run();

function run() {
  // Folders that look like each model (the files are empty: enough to choose, not to load).
  const root = fixtureDir({
    'YuE2-3B/config.json': '{}', 'YuE2-3B/model.safetensors': '', 'YuE2-3B/qwen.tiktoken': '',
    'yue2-vae/config.json': '{}', 'yue2-vae/model.safetensors': '',
    'clap/model.safetensors': '', 'clap/tokenizer.json': '{}', 'clap/preprocessor_config.json': '{}',
    'empty/readme.txt': 'nothing',
  });
  const dir = (n) => path.join(root, n);

  const card = () => document.querySelector('.radio-setup');
  const row = (key) => card().querySelector(`.models-row[data-model="${key}"]`);
  const status = (key) => row(key).querySelector('.models-status').textContent;
  const loadBtn = () => card().querySelector('.models-load');
  const choose = (key, folder) => {
    setPickedFiles(folder);
    clickEl(row(key).querySelector('.models-choose'));
    waitFor(() => row(key).querySelector('.models-dir').title === folder, `${key}: the picked folder`);
  };

  assert(card(), 'the setup card');
  for (const k of ['yue', 'vae', 'clap']) eq(status(k), 'Not found', `${k} not found`);
  eq(loadBtn().disabled, true, 'Load waits for all three');

  // A folder without the model's files is refused, saying why.
  choose('yue', dir('empty'));
  assert(status('yue').includes('Not a YuE2-3B folder'), `a wrong folder: ${status('yue')}`);
  // The YuE2 folder is not a VAE, though it has the VAE's files.
  choose('vae', dir('YuE2-3B'));
  assert(status('vae').includes('another model'), `the YuE2 folder as the VAE: ${status('vae')}`);

  choose('yue', dir('YuE2-3B'));
  eq(status('yue'), 'Chosen', 'a YuE2 folder');
  choose('vae', dir('yue2-vae'));
  choose('clap', dir('clap'));
  eq(status('clap'), 'Chosen', 'a CLAP folder');
  eq(loadBtn().disabled, false, 'Load once all three will do');

  // Use Default drops a choice.
  clickEl(row('clap').querySelector('.models-reset'));
  eq(status('clap'), 'Not found', 'Use Default goes back to bro.models');
  eq(loadBtn().disabled, true, 'and Load waits again');
  choose('clap', dir('clap'));
  eq(JSON.stringify(app.settings.get('modelDirs')), '{}', 'nothing saved before Load');

  // The AR weights.
  clickEl(Array.from(card().querySelectorAll('.models-ar .segmented button')).find((b) => b.textContent === 'fp8'));

  // Load: the choice is saved, the empty files fail to load, and the card says so.
  clickEl(loadBtn());
  eq(app.settings.get('modelDirs').yue, dir('YuE2-3B'), 'the choice saved on Load');
  eq(app.settings.get('arWeights'), 'fp8', 'and the weights');
  waitFor(() => app.state.phase === 'missing', 'the load to fail', 60000);
  const err = card().querySelector('.radio-setup-error');
  assert(err && err.textContent.includes('Loading failed'), `the failure is on the card: ${err && err.textContent}`);
  eq(status('yue'), 'Chosen', 'the card keeps the choice');

  // Later, from a running radio: Models… opens the panel; Cancel changes nothing.
  const be = fakeBackend();
  app.useBackend(be);
  waitFor(() => app.state.phase === 'ready', 'the map');
  press(`${mod}+,`);
  waitFor(() => currentDialog(), 'the Models dialog');
  eq(currentDialog().el.querySelectorAll('.models-row').length, 3, 'the panel in the dialog');
  dialogButton('Cancel');
  eq(app.state.phase, 'ready', 'Cancel keeps the radio');
  eq(be.disposed, false, 'and its models');

  // Load in the dialog releases the running models and loads the chosen ones.
  app.play();
  waitFor(() => app.state.radio.playhead > 48000, 'a second played');
  press(`${mod}+,`);
  waitFor(() => currentDialog(), 'the Models dialog again');
  dialogButton('Load');
  waitFor(() => be.disposed, 'the running models released', 10000);
  waitFor(() => app.state.phase === 'missing' || app.state.phase === 'loading', 'the chosen models loading');

  console.log('test_models PASSED');
}
