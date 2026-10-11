/**
 * Find Animals: which animals and species are in a folder's photos. Opening
 * a folder is the import: its photos are analysed in the background
 * (analysis.js) and the answers kept, so the folder opens instantly next
 * time. This module is the feature's face:
 *
 *  - the Animals menu (toolbar): every taxon named in the folder with its
 *    photo count ("Mallard", "Darners (Aeshnidae)"), "All" first,
 *    "Unidentified" (an animal found, nothing named), and Show Photos
 *    Without Animals; the choice filters the grid, the strip and Next /
 *    Previous (items());
 *  - a tag on each grid tile (its top name and how sure, "+N" for the
 *    others) and the Animals sections of the details panel (labels.js),
 *    whose animals isolate and zoom to on request (isolate.js);
 *  - progress in the status bar ("Finding animals · 120 of 958", Pause),
 *    and, when the models are missing, the offer to download them
 *    (models.js: size, progress, Cancel, Retry with the reason).
 *
 * The names are bro.vision.wildlife.labels(): every animal of a photo, each
 * at the narrowest rank it is sure of (0.85 or more). Bursts stay whole:
 * every frame of a burst is a photo of its own in the grid and carries all
 * of the burst's names (an egret in two frames and mallards in the third
 * are on all three). A photo matches a filter when any of its names is that
 * taxon (by rank and scientific name); it counts once per taxon. A photo
 * with an animal and no name is Unidentified. A photo counts as "without
 * animals" when it and its burst have no animal; such photos are hidden
 * once analysed, unless Show Photos Without Animals is on, and never
 * otherwise touched. Photos not analysed yet always show.
 *
 * The filter never takes away what she is working with: the photo on
 * screen and the strip's selection stay (keep()) until she moves on or
 * changes the selection, and while Select Subject or Stabilize is open
 * (hold()) nothing shown goes at all; answers landing then wait, and apply
 * when she leaves (holdReleased()).
 *
 * Hidden entirely where this bro cannot run it (wildlifeSupported), or with
 * the findAnimals setting off.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { Progress } from '/lib/controls.js';
import { formatBytes, formatNumber } from '/lib/format.js';
import { Analysis } from './analysis.js';
import { wildlifeSupported, canFetch, locateModels, bytesOf, ModelDownload } from './models.js';
import { decorateTile, detailsSection, labelKey, labelText } from './labels.js';
import { Isolate } from './isolate.js';
import { pathKey } from './records.js';

export const WILDLIFE_SETTINGS = {
  findAnimals: { type: 'bool', default: true },
  showNoAnimals: { type: 'bool', default: false },
  animalsModel: { type: 'string', default: 'bioclip-2' },  // bioclip-2 | bioclip
  // A list file in the species folder, or '' for bro.vision.wildlife's default lists.
  animalsSpeciesList: { type: 'string', default: '' },
};

/** The Animals filter that shows the photos with an animal but no name (filter is otherwise a label key). */
export const UNIDENTIFIED = ':unidentified';

export { labelKey };

export class WildlifeFeature {
  /**
   * settings: app.settings; commands: app.commands; folder: js/folder.js;
   * viewer, viewHost: the photo view and the element over it (isolate.js);
   * mode(): the view ('grid', 'image', ...); onItems(): the shown items or
   * their labels changed; onDetails(): the details panel's photo may have new answers.
   * keep(): paths the filter must not take away (the photo on screen, the
   * strip's selection); hold(): true while nothing shown may go (Select
   * Subject, Stabilize).
   */
  constructor({ settings, commands, folder, viewer, viewHost, mode, cacheDir, onItems, onDetails, keep = null, hold = null }) {
    this.settings = settings;
    this.commands = commands;
    this.folder = folder;
    this.mode = mode;
    this.keep = keep;
    this.hold = hold;
    this.held = null;              // while hold(): the paths shown when it began
    this.heldSeq = 0;
    this.lastShown = null;         // what items() answered last
    this.onItems = onItems;
    this.onDetails = onDetails;
    this.supported = wildlifeSupported();
    this.stub = null;              // TEST ONLY: useStub()
    this.filter = '';              // a label's key (labelKey: 'species:Anas platyrhynchos'), UNIDENTIFIED, '' for all
    this.names = new Map();        // label key -> its text, for the filter's button
    this.located = null;           // models.js locateModels(), when the models are not all there
    this.download = null;          // a ModelDownload while one is wanted
    this.seen = { dir: '', version: -1 };
    this.cache = { key: '', items: null };
    this.answers = { version: -1, taxa: null, map: new Map() };   // answerOf's, per analysis version
    this.analysis = new Analysis({ cacheDir, onChange: () => this.analysisChanged() });
    this.isolate = viewer && viewHost ? new Isolate({ viewer, host: viewHost }) : null;

    this.text = h('span.iv-animals-text.ellipsis');
    this.progress = new Progress(0);
    this.progress.el.classList.add('iv-animals-progress');
    this.actionBtn = h('button.btn.ghost.small.iv-animals-action', { onclick: () => this.runAction() });
    this.cancelBtn = h('button.btn.ghost.small.iv-animals-cancel', { onclick: () => this.commands.run('animals-cancel') }, 'Cancel');
    this.statusEl = h('div.iv-animals.hidden', icon('filter', 'sm'), this.text, this.progress.el, this.actionBtn, this.cancelBtn);
    this.filterLabel = h('span.ellipsis');
    this.filterBtn = h('button.btn.ghost.small.iv-animals-filter.hidden',
      { 'data-tip': 'Animals', 'data-command': 'animals-menu', onclick: () => this.commands.run('animals-menu') },
      icon('filter'), this.filterLabel);
  }

  /** On: this bro can run it (or a test stub stands in) and the setting is on. */
  get active() {
    return (this.supported || !!this.stub) && this.settings.get('findAnimals');
  }

  // ---- the folder ------------------------------------------------------------------

  /**
   * The folder's listing changed, or a watched file changed (`force`):
   * analyse what is new. The models are located first; missing ones are offered.
   */
  folderChanged({ force = false } = {}) {
    const f = this.folder;
    if (!force && this.seen.dir === f.dir && this.seen.version === f.version) return;
    if (this.seen.dir !== f.dir) this.filter = '';
    this.seen = { dir: f.dir, version: f.version };
    if (!this.active || !f.dir) {
      this.analysis.stop();
      this.showStatus();
      return;
    }
    const opts = this.analyzerOpts();
    if (!opts) {
      this.analysis.stop();
      this.showStatus();
      return;
    }
    this.analysis.setFolder(f.dir, f.items.map((it) => it.path), opts);
  }

  /** The analyzer's options, or null (and `located` says why) when models are missing. */
  analyzerOpts() {
    if (this.stub && !this.stub.requireModels) return this.stubOpts();
    let loc;
    try {
      loc = locateModels(this.settings.get('animalsModel'), this.settings.get('animalsSpeciesList'));
    } catch (err) {
      loc = { missing: [], listMissing: false, error: err.message };
    }
    if (loc.error || loc.missing.length || loc.listMissing) { this.located = loc; return null; }
    this.located = null;
    // A stub that needed the models found reads their lists' taxa maps.
    return this.stub ? { ...this.stubOpts(), species: loc.paths.species } : loc.paths;
  }

  stubOpts() {
    const s = this.stub;
    return { stub: s.table, ...(s.taxa ? { taxa: s.taxa } : {}), ...(s.maxClassify ? { maxClassify: s.maxClassify } : {}) };
  }

  /**
   * TEST ONLY: answer with js/wildlife/stub.js instead of the models
   * (requireModels: still look for them first; taxa: the names of genera
   * and up, as a list's taxa map; maxClassify: boxes classified a photo).
   */
  useStub(table, { requireModels = false, taxa = null, maxClassify = 0 } = {}) {
    this.stub = { table, requireModels, taxa, maxClassify };
    this.folderChanged({ force: true });
  }

  analysisChanged() {
    this.cache.key = '';
    this.showStatus();
    if (this.onItems) this.onItems();
    if (this.onDetails) this.onDetails();
  }

  // ---- what is shown -----------------------------------------------------------------

  /**
   * What is known of a photo: `labels` (bro.vision.wildlife.labels: the
   * burst's names, else its own; [] when nothing is named), `keys` their
   * labelKeys, `animal` (it or its burst has one), `empty` (analysed, no
   * animal). Kept until the analysis changes.
   */
  answerOf(p) {
    const a = this.analysis;
    if (this.answers.version !== a.version || this.answers.taxa !== a.taxa) {
      this.answers = { version: a.version, taxa: a.taxa, map: new Map() };
    }
    const k = pathKey(p);
    const have = this.answers.map.get(k);
    if (have) return have;
    const rec = a.record(p), b = a.burstOf(p);
    const labels = rec || b ? bro.vision.wildlife.labels(rec, b, { taxa: a.taxa }) : [];
    for (const l of labels) this.names.set(labelKey(l), labelText(l));
    const animal = !!(b && b.animalCount > 0) || !!(rec && !rec.error && rec.animal);
    const ans = { burst: b, labels, keys: new Set(labels.map(labelKey)), animal, empty: !!rec && !rec.error && !animal };
    this.answers.map.set(k, ans);
    return ans;
  }

  /** A photo's names as its tile shows them ('Mallard, Great Egret'; '' for none). */
  tagOf(p) {
    return this.answerOf(p).labels.map(labelText).join(', ');
  }

  /** The filter's name on the button and in the status bar. */
  filterName() {
    if (this.filter === UNIDENTIFIED) return 'Unidentified';
    return this.names.get(this.filter) || this.filter.slice(this.filter.indexOf(':') + 1);
  }

  /** The photos of p's burst as { has(path) } (any form of a path), or null: Select Subject's frames. */
  burstMembers(p) {
    const b = this.active ? this.analysis.burstOf(p) : null;
    if (!b) return null;
    const keys = new Set(b.photos.map(pathKey));
    return { has: (q) => keys.has(pathKey(q)) };
  }

  /** Analysed, and neither it nor its burst has an animal. */
  isEmpty(p) {
    return this.answerOf(p).empty;
  }

  /**
   * The folder's items as the grid, the strip and Next / Previous show them:
   * the filter applied, each with its tag. The folder's own list when there
   * is nothing to add (same array, so nothing redraws). keep() and hold()
   * stand over the filter: what they cover stays.
   */
  items(folderItems) {
    const a = this.analysis;
    // Select Subject or Stabilize open: what is shown now stays shown until she leaves.
    if (this.hold && this.hold()) {
      if (!this.held) { this.held = new Set((this.lastShown || folderItems).map((it) => it.path)); this.heldSeq++; }
    } else this.held = null;
    if (!this.active || (!a.results.size && !this.filter)) return (this.lastShown = folderItems);
    const showEmpty = this.settings.get('showNoAnimals');
    const keep = new Set(this.keep ? this.keep().filter(Boolean) : []);
    const key = `${a.version}|${this.filter}|${showEmpty}|${this.folder.version}|${this.held ? this.heldSeq : ''}|${[...keep].join('\n')}`;
    if (this.cache.key === key && this.cache.src === folderItems) return (this.lastShown = this.cache.items);
    const out = [];
    for (const it of folderItems) {
      const { burst: b, labels, keys, animal, empty } = this.answerOf(it.path);
      const stays = keep.has(it.path) || (this.held && this.held.has(it.path));
      if (!stays) {
        if (this.filter === UNIDENTIFIED ? !(animal && !labels.length) : this.filter && !keys.has(this.filter)) continue;
        if (!this.filter && !showEmpty && empty) continue;
      }
      const top = labels[0];
      out.push({
        name: it.name, path: it.path,
        tag: top ? labelText(top) : '',
        conf: top ? Math.round(top.score * 100) : 0,
        more: Math.max(0, labels.length - 1),
        names: labels.map((l) => `${labelText(l)} · ${Math.round(l.score * 100)}%`).join(', '),
        burst: b && b.count > 1 && pathKey(b.first) === pathKey(it.path) ? b.count : 0,
      });
    }
    // The same photos with the same tags: the last array, so nothing redraws.
    const prev = this.cache.src === folderItems ? this.cache.items : null;
    const same = prev && prev.length === out.length && prev.every((p, i) => p.path === out[i].path &&
      p.names === out[i].names && p.burst === out[i].burst);
    this.cache = { key, src: folderItems, items: same ? prev : out };
    return (this.lastShown = this.cache.items);
  }

  /** Select Subject and Stabilize have both closed since the shown photos were held: show them filtered again. */
  holdReleased() {
    return !!this.held && !(this.hold && this.hold());
  }

  /** Whether the shown photos are held (Select Subject or Stabilize open): the filter waits. */
  holding() {
    return !!(this.hold && this.hold());
  }

  /**
   * Taxa named in the folder by photo count, most first: [{ key, label, count }]
   * (a photo counts once per taxon); the photos with an animal but no name
   * (unidentified), and those without animals.
   */
  counts() {
    const by = new Map();
    let empty = 0, unidentified = 0;
    for (const it of this.folder.items) {
      const { labels, animal, empty: none } = this.answerOf(it.path);
      for (const l of labels) {
        const k = labelKey(l);
        const t = by.get(k) || { key: k, label: labelText(l), count: 0 };
        t.count++;
        by.set(k, t);
      }
      if (!labels.length && animal) unidentified++;
      else if (none) empty++;
    }
    const taxa = [...by.values()].sort((x, y) => y.count - x.count || (x.label < y.label ? -1 : 1));
    return { taxa, unidentified, empty, all: this.folder.items.length - (this.settings.get('showNoAnimals') ? 0 : empty) };
  }

  decorate(item, el) { decorateTile(item, el); }

  /**
   * The details panel's Animals sections for a photo (null when the feature
   * is off). Its animals isolate and zoom when the photo is on screen.
   */
  details(p) {
    if (!this.active || !p) return null;
    const a = this.analysis;
    const rec = a.record(p);
    const target = rec && !rec.error && rec.width && this.isolate && this.mode() === 'image' && this.isolate.onScreen(p)
      ? { path: p, size: [rec.width, rec.height] } : null;
    return detailsSection(rec, a.burstOf(p), { pending: !rec && a.dir === this.folder.dir && a.total > 0, taxa: a.taxa, target });
  }

  /** Show only the photos naming a taxon (its labelKey), UNIDENTIFIED, or '' for all. */
  setFilter(key) {
    this.filter = key || '';
    this.cache.key = '';
    this.showStatus();
    if (this.onItems) this.onItems();
  }

  // ---- the status bar and the toolbar button ------------------------------------------

  /** The status bar's words and buttons for where the feature is. */
  showStatus() {
    const shown = (el, on) => el.classList.toggle('hidden', !on);
    const on = this.active && !!this.folder.dir;
    const p = this.analysis.progress();
    const d = this.download;
    // bar: a fraction, null for a bar that only says "working", undefined for none.
    let text = '', action = '', bar, cancel = false;
    if (!on) { /* nothing */ } else if (d && d.state === 'running') {
      text = `Downloading animal models · ${formatBytes(d.done)} of ${formatBytes(d.total)}`;
      bar = d.total > 0 ? d.done / d.total : null;
      cancel = true;
    } else if (d && d.state === 'failed') {
      text = `Could not download the animal models: ${d.error}`;
      action = 'Retry';
    } else if (this.located) {
      const l = this.located;
      if (l.error) text = `Find Animals: ${l.error}`;
      else if (l.listMissing) text = `Find Animals: no ${this.settings.get('animalsSpeciesList') || 'species list'} in ${l.speciesDir}`;
      else if (canFetch()) {
        text = 'Finding animals needs its models';
        action = `Download (${formatBytes(bytesOf(l.missing))})`;
      } else text = `Find Animals: no ${l.missing.join(', ')} in ${bro.models.dirs.join(', ')}`;
    } else if (p.state === 'loading') {
      text = 'Loading the animal models…';
      bar = null;
    } else if (p.state === 'running' || p.state === 'paused') {
      text = `${p.state === 'paused' ? 'Paused' : 'Finding animals'} · ${formatNumber(p.done)} of ${formatNumber(p.total)}`;
      bar = p.total ? p.done / p.total : 0;
      action = p.state === 'paused' ? 'Resume' : 'Pause';
    } else if (p.state === 'error') {
      text = `Cannot find animals: ${p.error}`;
      action = 'Retry';
    }
    shown(this.statusEl, !!text);
    this.text.textContent = text;
    this.text.title = text;
    shown(this.progress.el, bar !== undefined);
    if (bar !== undefined) this.progress.set(bar);
    shown(this.actionBtn, !!action);
    this.actionBtn.textContent = action;
    shown(this.cancelBtn, cancel);
    // The Animals menu, once there is anything to filter by.
    shown(this.filterBtn, on && (this.analysis.results.size > 0 || !!this.filter));
    this.filterLabel.textContent = this.filterName() || 'Animals';
    this.filterBtn.classList.toggle('active', !!this.filter);
  }

  /** The status bar's button: whatever it offers now. */
  runAction() {
    const label = this.actionBtn.textContent;
    if (label === 'Pause' || label === 'Resume') this.commands.run('animals-pause');
    else if (label === 'Retry' && !this.download) this.commands.run('animals-retry');
    else this.commands.run('animals-download');
  }

  // ---- downloading the models ---------------------------------------------------------

  async downloadModels() {
    if (!this.located || !this.located.missing.length || (this.download && this.download.state === 'running')) return;
    const d = new ModelDownload(this.located.missing, { onChange: () => { if (this.download === d) this.showStatus(); } });
    this.download = d;
    await d.start();
    if (this.download !== d) return;
    if (d.state === 'failed') return;
    this.download = null;
    if (d.state === 'done') {
      this.folderChanged({ force: true });
      if (!this.located) toast('The animal models are installed', { icon: 'check' });
    }
    this.showStatus();
  }

  // ---- commands --------------------------------------------------------------------------

  commandList() {
    // While Select Subject or Stabilize holds the photos, the filter waits for her to leave.
    const browsing = () => this.active && (this.mode() === 'grid' || this.mode() === 'image') && !this.holding();
    const a = this.analysis;
    return [
      { id: 'animals-menu', label: 'Animals', icon: 'filter', enabled: () => browsing() && (a.results.size > 0 || !!this.filter),
        run: () => this.showMenu() },
      { id: 'animals-filter', label: 'Show Species', enabled: browsing, run: (key) => this.setFilter(key) },
      { id: 'animals-show-empty', label: 'Show Photos Without Animals', enabled: () => this.active && !this.holding(),
        checked: () => this.settings.get('showNoAnimals'),
        run: () => { this.settings.set('showNoAnimals', !this.settings.get('showNoAnimals')); this.analysisChanged(); } },
      { id: 'animals-pause', label: 'Pause Finding Animals', enabled: () => this.active && ['running', 'loading', 'paused'].includes(a.state),
        checked: () => a.state === 'paused', run: () => (a.state === 'paused' ? a.resume() : a.pause()) },
      { id: 'animals-retry', label: 'Try Finding Animals Again', enabled: () => this.active && a.state === 'error', run: () => a.resume() },
      { id: 'animals-download', label: 'Download the Animal Models', icon: 'download',
        enabled: () => this.active && canFetch() && !!this.located && this.located.missing.length > 0 &&
          !(this.download && this.download.state === 'running'),
        run: () => this.downloadModels() },
      { id: 'animals-cancel', label: 'Cancel the Download', enabled: () => !!(this.download && this.download.state === 'running'),
        run: () => this.download.cancel() },
      { id: 'find-animals', label: 'Find Animals', enabled: () => this.supported || !!this.stub,
        checked: () => this.active, run: () => this.toggle() },
    ];
  }

  toggle() {
    this.settings.set('findAnimals', !this.settings.get('findAnimals'));
    if (!this.active) this.filter = '';
    this.folderChanged({ force: true });
    this.analysisChanged();
  }

  /** The Animals menu: All, every taxon with its photo count, Unidentified, the toggle. */
  showMenu() {
    const c = this.counts();
    const pick = (key, label, count) => this.commands.item('animals-filter', {
      label, count, checked: this.filter === key, icon: undefined,
      action: () => this.commands.run('animals-filter', key),
    });
    const items = [
      pick('', 'All photos', c.all),
      c.taxa.length || c.unidentified ? { separator: true } : null,
      ...c.taxa.map((t) => pick(t.key, t.label, t.count)),
      c.unidentified || this.filter === UNIDENTIFIED ? pick(UNIDENTIFIED, 'Unidentified', c.unidentified) : null,
      { separator: true },
      this.commands.item('animals-show-empty', { count: c.empty }),
    ];
    if (['running', 'loading', 'paused'].includes(this.analysis.state)) items.push(this.commands.item('animals-pause'));
    menu.showBelow(items, this.filterBtn);
  }
}
