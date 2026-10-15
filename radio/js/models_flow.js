/**
 * Getting the models in place: the setup card (when the radio cannot start
 * yet), loading, the Models… dialog, and releasing the models in use before
 * others load.
 *
 *   const flow = modelsFlow({ settings, setPhase, useBackend, releaseBackend });
 *   flow.boot()           // probe; load, or show the setup card
 *   flow.setupCard(why)   // the card (setPhase('missing') shows it)
 *   flow.openDialog()     // Models…
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Dialog } from '/lib/dialog.js';
import { capability, resolveModels, allReady, loadBackend, MODELS, canFetch } from './models.js';
import { ModelsPanel } from './models_view.js';

export function modelsFlow({ settings, setPhase, useBackend, releaseBackend, generation }) {
  const flow = {
    boot() {
      const why = capability();
      if (why) { setPhase('unavailable', why); return; }
      const where = resolveModels(settings.get('modelDirs'));
      if (!allReady(where)) { setPhase('missing', ''); return; }
      flow.load(where);
    },

    /** Loads the models at `where` (resolveModels) and runs the radio on them. */
    load(where) {
      const dirs = {};
      for (const m of MODELS) dirs[m.key] = where[m.key].dir;
      const loaded = new Set();
      const progress = () => `Loading ${MODELS.filter((m) => !loaded.has(m.key)).map((m) => m.label).join(', ')}…`;
      setPhase('loading', progress());
      const t0 = performance.now(), gen = generation();
      loadBackend(dirs, { arWeights: settings.get('arWeights'),
        onStep: (key) => { loaded.add(key); if (gen === generation() && loaded.size < MODELS.length) setPhase('loading', progress()); } })
        .then((backend) => {
          console.log(`radio: models loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s on ${backend.device}`);
          if (gen === generation()) useBackend(backend);       // unless something chose another backend meanwhile
          else backend.dispose();
        }, (e) => { if (gen === generation()) setPhase('missing', `Loading failed. ${e.message}`); });
    },

    /** Saves the panel's choice and (re)loads the models with it. */
    async apply(panel) {
      settings.set('modelDirs', panel.chosen);
      settings.set('arWeights', panel.arWeights);
      setPhase('loading', 'Releasing the models in use…');
      await releaseBackend();
      flow.boot();
    },

    /**
     * The card shown while the radio cannot start: the panel, why not (a
     * failed load says what failed), Download Missing, and Load once every
     * folder will do. A finished download loads at once.
     */
    setupCard(reason) {
      const panel = new ModelsPanel({ chosen: settings.get('modelDirs'), arWeights: settings.get('arWeights'),
        onChange: (p) => refresh(p) });
      const load = h('button.btn.primary.models-load', { onclick: () => flow.apply(panel) }, 'Load Models');
      const fetchAll = h('button.btn.models-fetch-all', { onclick: async () => { if (await panel.downloadMissing() && panel.ready) flow.apply(panel); } },
        icon('download'), 'Download Missing');
      const size = h('span.micro.dim.models-size');
      function refresh(p) {
        load.disabled = !p.ready || p.downloading;
        const missing = p.missing;
        fetchAll.classList.toggle('hidden', !canFetch() || missing.length === 0);
        fetchAll.disabled = p.downloading;
        size.textContent = missing.length && canFetch() ? 'About 8.5 GB in all; non-commercial licence (CC BY-NC 4.0) for YuE2' : '';
      }
      refresh(panel);
      return h('div.card.radio-setup',
        h('div.head', 'The radio\'s models'),
        h('div.dim', 'Download them, pick folders you already have, or let bro find them by name. They load on the GPU.'),
        reason ? h('div.radio-setup-error', icon('alert'), h('span', reason)) : null,
        panel.el,
        h('div.radio-setup-actions', size, h('div.grow'), fetchAll, load));
    },

    /** The Models… dialog: change folders or weights at any time; Load reloads. */
    async openDialog() {
      const d = new Dialog({ title: 'Models', icon: 'layers', wide: true });
      const panel = new ModelsPanel({ chosen: settings.get('modelDirs'), arWeights: settings.get('arWeights'),
        onChange: (p) => { loadBtn.disabled = !p.ready || p.downloading; } });
      d.body.append(h('div.dim', 'Loading other models stops the music and reloads.'), panel.el);
      d.addButton('Cancel', { value: false });
      const loadBtn = d.addButton('Load', { primary: true, value: true, onClick: () => panel.ready && !panel.downloading });
      loadBtn.disabled = !panel.ready;
      if (await d.open()) flow.apply(panel);
    },
  };
  return flow;
}
