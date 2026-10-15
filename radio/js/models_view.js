/**
 * The models panel: one row per model the radio needs, with the folder in
 * use, whether it will do, Choose… / Use Default, and Download for one that
 * is missing (bro.models.fetch from wlejon/brosoundml-data, with progress
 * and Cancel); under them the AR decode weights. Shown inline when the
 * radio cannot start yet, and in the Models… dialog at any time.
 *
 *   const panel = new ModelsPanel({ chosen, arWeights, onChange });
 *   panel.el                      // place it
 *   panel.chosen, panel.arWeights // what the listener picked (the caller saves on Load)
 *   panel.where                   // resolveModels(panel.chosen)
 *   panel.ready                   // every model has a usable folder
 *   panel.downloadMissing()       // fetch every missing model, one after another
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Segmented } from '/lib/controls.js';
import { formatBytes } from '/lib/format.js';
import { MODELS, AR_WEIGHTS, resolveModels, allReady, searchedDirs, shortDir, canFetch, fetchModel } from './models.js';

const path = require('path');

/** Downloads in flight, by model key: { done, total, abort } (shared by every panel). */
const downloads = new Map();
const listeners = new Set();
const notify = () => { for (const f of listeners) f(); };

export class ModelsPanel {
  constructor({ chosen = {}, arWeights = 'int8', onChange } = {}) {
    this.chosen = Object.assign({}, chosen);
    this.arWeights = arWeights;
    this.onChange = onChange;
    this.error = '';
    this.rows = h('div.models-rows');
    this.ar = new Segmented({ options: AR_WEIGHTS, value: arWeights,
      onChange: (v) => { this.arWeights = v; this.changed(); } });
    this.hint = h('div.models-hint.micro.dim');
    this.el = h('div.models-panel',
      this.rows,
      h('div.models-ar', h('div', h('div', 'Score and token sampling'), h('div.micro.dim', 'The weights YuE2 samples with')), this.ar.el),
      this.hint);
    this.listener = () => { if (this.el.isConnected) { this.render(); this.changed(); } else listeners.delete(this.listener); };
    listeners.add(this.listener);
    this.render();
  }

  get ready() { return allReady(this.where); }
  get missing() { return MODELS.filter((m) => this.where[m.key].source === 'missing'); }
  get downloading() { return downloads.size > 0; }

  render() {
    this.where = resolveModels(this.chosen);
    this.rows.replaceChildren(...MODELS.map((m) => this.row(m, this.where[m.key])));
    const dirs = searchedDirs();
    this.hint.textContent = (this.error ? `${this.error} ` : '')
      + (dirs.length ? `Folders not chosen here are looked for by name in: ${dirs.join(', ')}` : '');
  }

  row(m, w) {
    const dl = downloads.get(m.key);
    let status;
    if (dl) {
      const pct = dl.total ? Math.floor((100 * dl.done) / dl.total) : 0;
      status = h('span.models-status.num', `${pct}% of ${dl.total ? formatBytes(dl.total) : '…'}`);
    } else if (w.error) {
      status = h('span.models-status.bad', w.source === 'missing' ? 'Not found' : w.error);
    } else {
      status = h('span.models-status.ok', icon('check-circle'), w.source === 'chosen' ? 'Chosen' : 'Found');
    }
    let action;
    if (dl) action = h('button.btn.small.models-cancel', { onclick: () => dl.abort.abort() }, 'Cancel');
    else if (w.source === 'missing' && canFetch()) action = h('button.btn.small.models-download', { onclick: () => this.download(m) }, icon('download'), 'Download');
    else action = h('button.btn.small.models-choose', { onclick: () => this.choose(m) }, 'Choose…');
    return h('div.models-row', { 'data-model': m.key },
      h('div.models-name', h('div', m.label), h('div.micro.dim', m.what)),
      h('div.models-dir.ellipsis', { title: w.dir || '' }, w.dir ? shortDir(w.dir) : (dl ? 'Downloading…' : '—')),
      status,
      action,
      this.chosen[m.key]
        ? h('button.icon-btn.models-reset', { 'data-tip': 'Use the folder bro.models finds', onclick: () => this.set(m.key, null) }, icon('x'))
        : (w.source === 'missing' && !dl
          ? h('button.icon-btn.models-pick', { 'data-tip': 'Choose a folder you already have', onclick: () => this.choose(m) }, icon('folder-open'))
          : h('span.models-reset-gap')));
  }

  async choose(m) {
    const cur = this.where[m.key] && this.where[m.key].dir;
    const start = cur ? path.dirname(cur) : undefined;
    const picked = typeof showOpenFolderDialogAsync === 'function'
      ? await showOpenFolderDialogAsync(start, false)
      : (typeof showOpenFolderDialog === 'function' ? showOpenFolderDialog(start, false) : []);
    if (picked && picked.length) this.set(m.key, picked[0]);
  }

  /** Fetches one model; the row shows progress. Resolves true when it is in. */
  async download(m) {
    if (downloads.has(m.key)) return false;
    const abort = new AbortController();
    const dl = { done: 0, total: 0, abort };
    downloads.set(m.key, dl);
    this.error = '';
    notify();
    let lastPaint = 0;
    try {
      await fetchModel(m, { signal: abort.signal, onProgress: (p) => {
        dl.done = p.done; dl.total = p.total;
        const t = performance.now();
        if (t - lastPaint > 250 || p.done === p.total) { lastPaint = t; notify(); }
      } });
      return true;
    } catch (e) {
      if (!abort.signal.aborted) this.error = `${m.label} did not download: ${e.message}.`;
      return false;
    } finally {
      downloads.delete(m.key);
      notify();
    }
  }

  /** Downloads every missing model, one after another (they share one line). */
  async downloadMissing() {
    for (const m of this.missing) if (!(await this.download(m))) return false;
    return true;
  }

  set(key, dir) {
    if (dir) this.chosen[key] = dir; else delete this.chosen[key];
    this.render();
    this.changed();
  }

  changed() { if (this.onChange) this.onChange(this); }
}
