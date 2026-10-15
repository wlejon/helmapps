/**
 * The models panel: one row per model the radio needs, with the folder in
 * use, whether it will do, and Choose… / Use Default; under them the AR
 * decode weights. Shown inline when the radio cannot start yet, and in the
 * Models… dialog at any time.
 *
 *   const panel = new ModelsPanel({ chosen, arWeights, onChange });
 *   panel.el                      // place it
 *   panel.chosen, panel.arWeights // what the listener picked (not saved: the caller saves on Load)
 *   panel.where                   // resolveModels(panel.chosen)
 *   panel.ready                   // every model has a usable folder
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Segmented } from '/lib/controls.js';
import { MODELS, AR_WEIGHTS, resolveModels, allReady, searchedDirs, shortDir } from './models.js';

const path = require('path');

export class ModelsPanel {
  constructor({ chosen = {}, arWeights = 'int8', onChange } = {}) {
    this.chosen = Object.assign({}, chosen);
    this.arWeights = arWeights;
    this.onChange = onChange;
    this.rows = h('div.models-rows');
    this.ar = new Segmented({ options: AR_WEIGHTS, value: arWeights,
      onChange: (v) => { this.arWeights = v; this.changed(); } });
    this.hint = h('div.models-hint.micro.dim');
    this.el = h('div.models-panel',
      this.rows,
      h('div.models-ar', h('div', h('div', 'Score and token sampling'), h('div.micro.dim', 'The weights YuE2 samples with')), this.ar.el),
      this.hint);
    this.render();
  }

  get ready() { return allReady(this.where); }

  render() {
    this.where = resolveModels(this.chosen);
    this.rows.replaceChildren(...MODELS.map((m) => this.row(m, this.where[m.key])));
    const dirs = searchedDirs();
    this.hint.textContent = dirs.length ? `Folders not chosen here are looked for by name in: ${dirs.join(', ')}` : '';
  }

  row(m, w) {
    const status = w.error
      ? h('span.models-status.bad', w.source === 'missing' ? 'Not found' : w.error)
      : h('span.models-status.ok', icon('check-circle'), w.source === 'chosen' ? 'Chosen' : 'Found');
    return h('div.models-row', { 'data-model': m.key },
      h('div.models-name', h('div', m.label), h('div.micro.dim', m.what)),
      h('div.models-dir.ellipsis', { title: w.dir || '' }, w.dir ? shortDir(w.dir) : '—'),
      status,
      h('button.btn.small.models-choose', { onclick: () => this.choose(m) }, 'Choose…'),
      this.chosen[m.key]
        ? h('button.icon-btn.models-reset', { 'data-tip': 'Use the folder bro.models finds', onclick: () => this.set(m.key, null) }, icon('x'))
        : h('span.models-reset-gap'));
  }

  async choose(m) {
    const cur = this.where[m.key] && this.where[m.key].dir;
    const start = cur ? path.dirname(cur) : undefined;
    const picked = typeof showOpenFolderDialogAsync === 'function'
      ? await showOpenFolderDialogAsync(start, false)
      : (typeof showOpenFolderDialog === 'function' ? showOpenFolderDialog(start, false) : []);
    if (picked && picked.length) this.set(m.key, picked[0]);
  }

  set(key, dir) {
    if (dir) this.chosen[key] = dir; else delete this.chosen[key];
    this.render();
    this.changed();
  }

  changed() { if (this.onChange) this.onChange(this); }
}
