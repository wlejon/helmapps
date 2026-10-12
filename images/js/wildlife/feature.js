/**
 * Find Animals: which animals and species are in a folder's photos. Opening
 * a folder is the import: its photos are analysed in the background
 * (analysis.js) and the answers kept, so the folder opens instantly next
 * time. This module is the feature's face:
 *
 *  - the Animals menu (toolbar): every taxon named in the folder with its
 *    photo count ("Mallard", "Darners (Aeshnidae)"), "All" first,
 *    "Uncertain" (an animal no name covers: UNCERTAIN), and Show Photos
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
 * with a crop no name covers, or an animal and no name, is Uncertain until she answers it. A photo counts as "without
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
import { decorateTile, detailsSection, labelKey, labelText, countedText, percentText } from './labels.js';
import { Isolate } from './isolate.js';
import { pathKey } from './records.js';
import { Answers } from './answers.js';
import { AnswerEditor, EDITOR_SETTINGS } from './editor.js';
import { answerLabels, fold } from './mine.js';
import { Examples } from './examples.js';
import { Outlines } from './outlines.js';
import { uncertainCrops, guessOf, guessScore, countsText, sameBox } from './crops.js';
import { formatDate } from '/lib/format.js';

export const WILDLIFE_SETTINGS = {
  findAnimals: { type: 'bool', default: true },
  showNoAnimals: { type: 'bool', default: false },
  animalsModel: { type: 'string', default: 'bioclip-2' },  // bioclip-2 | bioclip
  // A list file in the species folder, or '' for bro.vision.wildlife's default lists.
  animalsSpeciesList: { type: 'string', default: '' },
  // Every animal's outline on the photo, a click to name one (outlines.js). Off: the photo
  // is for looking; an animal's box shows only while its details row is hovered or its picker open.
  showOutlines: { type: 'bool', default: false },
  ...EDITOR_SETTINGS,
};

/**
 * The Animals filter that shows the photos with an animal no name covers:
 * a crop under the threshold, or an animal and no name (filter is otherwise
 * a label key). Her answer takes a photo out of it.
 */
export const UNCERTAIN = ':uncertain';
/** The old name of UNCERTAIN. */
export const UNIDENTIFIED = UNCERTAIN;
/**
 * Her named crops whose embedding is this near a crop's are offered as
 * "looks like your ..." (cosine). BioCLIP 2 crops of 17 local photos: pairs
 * of different species up to 0.91 (median 0.86), of the same species median
 * 0.97 (10th percentile 0.84): over every different pair, about half the same.
 */
export const LOOKALIKE_MIN = 0.92;

export { labelKey };

/** Whether two shown items have the same own fields (===). */
function sameFields(a, b) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

export class WildlifeFeature {
  /**
   * settings: app.settings; commands: app.commands; folder: js/folder.js;
   * viewer, viewHost: the photo view and the element over it (isolate.js);
   * mode(): the view ('grid', 'image', ...); onItems(): the shown items or
   * their labels changed; onDetails(): the details panel's photo may have new answers.
   * keep(): paths the filter must not take away (the photo on screen, the
   * strip's selection); hold(): true while nothing shown may go (Select
   * Subject, Stabilize). dataDir: where her answers are kept (answers.js);
   * current(): the photo on screen or selected; openDetails(): show the
   * details panel; goTo(path): show a photo; shownItems(): what the grid shows.
   */
  constructor({ settings, commands, folder, viewer, viewHost, mode, cacheDir, dataDir, onItems, onDetails, keep = null, hold = null,
    current = () => '', openDetails = () => {}, goTo = () => {}, shownItems = () => [] }) {
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
    this.current = current;
    this.known = null;             // answerOf's: { taxa, map: pathKey -> answer }, a photo dropped when it changes
    this.itemsSeq = 0;             // items()' cache: bumped when any photo's answer changed
    this.itemOf = new Map();       // path -> { ans, view, item }: the shown item of an answer, kept while it stays
    this.touched = new Set();      // pathKeys changed since the last flush (null: any)
    this.flushQueued = false;
    this.analysis = new Analysis({ cacheDir, onChange: (_, paths) => this.analysisChanged(paths) });
    // An animal of the details under the pointer shows its boxes; a click on it opens its picker.
    this.isolate = viewer && viewHost ? new Isolate({ viewer, host: viewHost,
      onFocus: (a) => { if (this.outlines) this.outlines.setFocus(a); },
      onPick: (a) => { if (this.outlines && a.boxes.length) this.outlines.openBox(a.path, a.boxes[0]); } }) : null;
    this.outlines = viewer && viewHost ? new Outlines({ viewer, host: viewHost, feature: this }) : null;
    // Her answers win over the identifier's everywhere (answerOf); kept apart from the analysis.
    this.answers = new Answers({ dataDir, cacheDir, onChange: (_, paths) => this.analysisChanged(paths) });
    // The crops she has named, across folders ("looks like your ..."); on the answers' worker.
    this.examplesStore = new Examples({ dataDir, worker: this.answers.worker });
    this.examplesQueued = false;
    this.examplesTouched = null;   // pathKeys whose examples to make again (null: every photo)
    this.byKey = null;             // itemOfKey's map
    this.editor = new AnswerEditor({ feature: this, settings, current, openDetails, goTo, shownItems });
    this.index = { names: null, index: null };   // nameIndex() over analysis.names
    this.detailsStale = false;
    this.query = '';                               // the search field's text
    this.searchInput = h('input', { type: 'search', placeholder: 'Search names', 'aria-label': 'Search names and files', spellcheck: 'false' });
    this.searchInput.addEventListener('input', () => this.setQuery(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && this.searchInput.value) { this.searchInput.value = ''; this.setQuery(''); }
      this.searchInput.blur();
    });
    this.searchEl = h('label.search-field.iv-search.hidden', icon('search'), this.searchInput);

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
    // Her answers are found by each file's identity: read it for the folder's photos (in the background).
    this.answers.setFolder(f.items.map((it) => it.path));
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
    return { stub: s.table, ...(s.taxa ? { taxa: s.taxa } : {}), ...(s.maxClassify ? { maxClassify: s.maxClassify } : {}),
      ...(s.names ? { names: s.names } : {}) };
  }

  /**
   * TEST ONLY: answer with js/wildlife/stub.js instead of the models
   * (requireModels: still look for them first; taxa: the names of genera
   * and up, as a list's taxa map; maxClassify: boxes classified a photo;
   * names: more species rows for her corrections' suggestions).
   */
  useStub(table, { requireModels = false, taxa = null, maxClassify = 0, names = null } = {}) {
    this.stub = { table, requireModels, taxa, maxClassify, names };
    this.folderChanged({ force: true });
  }

  /**
   * The analysis or her answers changed for `paths` (pathKeys; empty: only
   * the state or the progress; null: any photo). What is known of those
   * photos is worked out again when next asked for, and every view follows
   * at the next frame, once however many changes came in it: a card being
   * analysed lands a result after another, and each must not cost every
   * photo's names again (answerOf) nor a redraw of what did not change.
   */
  analysisChanged(paths = null) {
    if (!paths) {
      this.known = null;
      this.touched = null;
      this.itemsSeq++;
    } else if (paths.size) {
      if (this.known) for (const k of paths) this.known.map.delete(k);
      if (this.touched) for (const k of paths) this.touched.add(k);
      this.itemsSeq++;
    }
    if (this.flushQueued) return;
    this.flushQueued = true;
    requestAnimationFrame(() => this.flushChanges());
  }

  /** The views after analysisChanged(): the status, the shown items, and the photo on screen's details and outlines. */
  flushChanges() {
    this.flushQueued = false;
    const touched = this.touched;
    this.touched = new Set();
    if (this.active && this.folder.dir && (!touched || touched.size)) this.syncExamples(touched);
    this.showStatus();
    if (this.onItems) this.onItems();
    const cur = this.current();
    if (!touched || (cur && touched.has(pathKey(cur)))) this.detailsChanged();
    if (this.outlines) this.outlines.draw();
  }

  /** The details panel's photo may show something new; not while she is typing a name there. */
  detailsChanged() {
    if (this.editor && this.editor.active) { this.detailsStale = true; return; }
    this.detailsStale = false;
    if (this.onDetails) this.onDetails();
  }

  /** Whether she is typing a name for `file` in the details (it is not drawn again under her); another file's edit is dropped. */
  editingFor(file) {
    const ed = this.editor.editing;
    if (!ed) return false;
    if (pathKey(ed.path) === pathKey(file)) return true;
    this.editor.abandon();
    return false;
  }

  /** bro.vision.wildlife.nameIndex over the lists' names (her corrections' suggestions), or null. */
  nameIndex() {
    const names = this.analysis.names;
    if (!names || !names.length || typeof bro.vision.wildlife.nameIndex !== 'function') return null;
    if (this.index.names !== names) this.index = { names, index: bro.vision.wildlife.nameIndex(names) };
    return this.index.index;
  }

  // ---- what is shown -----------------------------------------------------------------

  /**
   * What is known of a photo: `labels` (bro.vision.wildlife.labels: the
   * burst's names, else its own; [] when nothing is named), `keys` their
   * labelKeys, `animal` (it or its burst has one), `empty` (analysed, no
   * animal). Kept until its record, its burst or her answer changes
   * (analysisChanged), or the lists' names do.
   */
  answerOf(p) {
    const a = this.analysis, mine = this.answers;
    if (!this.known || this.known.taxa !== a.taxa) this.known = { taxa: a.taxa, map: new Map() };
    const k = pathKey(p);
    const have = this.known.map.get(k);
    if (have) return have;
    const rec = a.record(p), b = a.burstOf(p);
    const theirs = rec || b ? bro.vision.wildlife.labels(rec, b, { taxa: a.taxa }) : [];
    let labels = theirs;
    let animal = !!(b && b.animalCount > 0) || !!(rec && !rec.error && rec.animal);
    let empty = !!rec && !rec.error && !animal;
    // Her answer wins: her names (no animal: none), whatever the identifier said.
    const own = mine.of(p);
    if (own) {
      labels = answerLabels(own, theirs);
      animal = labels.length > 0;
      empty = !animal;
    }
    for (const l of labels) this.names.set(labelKey(l), labelText(l));
    // Uncertain: a crop no shown name covers (crops.js), or an animal and no name; never once she answered.
    const uncertain = uncertainCrops(rec, labels, a.taxa, own);
    const ans = { burst: b, labels, theirs, mine: own, keys: new Set(labels.map(labelKey)), animal, empty, uncertain,
      isUncertain: !own && (uncertain.length > 0 || (animal && !labels.length)) };
    this.known.map.set(k, ans);
    return ans;
  }

  // ---- her named crops, and the ones like them ---------------------------------------

  /** Which classifier the crop embeddings come from: examples of another are never compared. */
  embeddingModel() {
    return this.stub ? 'stub' : this.settings.get('animalsModel');
  }

  /**
   * Her examples (examples.js) made again for the open folder's photos whose
   * crops are known: each animal of her answer on a box of the record, with
   * the box's embedding. Only the photos changed since (`touched`, pathKeys;
   * null: every photo), so a card being analysed costs a result its own
   * photos, not the folder. Coalesced: once after a burst of changes.
   */
  syncExamples(touched = null) {
    if (!touched) this.examplesTouched = null;
    else if (this.examplesTouched) for (const k of touched) this.examplesTouched.add(k);
    if (this.examplesQueued) return;
    this.examplesQueued = true;
    Promise.all([this.answers.load(), this.examplesStore.load()]).then(() => setTimeout(() => {
      this.examplesQueued = false;
      const keys = this.examplesTouched;
      this.examplesTouched = new Set();
      if (!this.active) return;
      const a = this.analysis, model = this.embeddingModel(), photos = [];
      const items = keys ? [...keys].map((k) => this.itemOfKey(k)).filter(Boolean) : this.folder.items;
      for (const it of items) {
        const key = this.answers.keys.get(pathKey(it.path));
        const rec = a.record(it.path);
        if (!key || !rec || rec.error || !Array.isArray(rec.animals)) continue;
        // Not yet known which crops it has: what the store holds for it stays.
        if (rec.animals.length && !a.embeddings.has(pathKey(it.path))) continue;
        const own = this.answers.of(it.path);
        if (!own) { photos.push({ key, model, entries: null }); continue; }
        const entries = [];
        for (const l of this.answerOf(it.path).labels) {
          for (const box of l.boxes || []) {
            const i = rec.animals.findIndex((x) => sameBox(x.box, box));
            const emb = i >= 0 ? a.embeddingOf(it.path, i) : null;
            if (!emb) continue;
            const e = { box: rec.animals[i].box.slice(), name: l.common || l.scientific, at: own.at, time: rec.time || null, file: it.name, emb };
            if (l.rank) { e.scientific = l.scientific; e.rank = l.rank; }
            entries.push(e);
          }
        }
        photos.push({ key, model, entries });
      }
      if (photos.length) this.examplesStore.sync(photos);
    }, 0));
  }

  /** The folder's item for a pathKey, or null (a map kept per listing). */
  itemOfKey(k) {
    const f = this.folder;
    if (!this.byKey || this.byKey.items !== f.items) {
      this.byKey = { items: f.items, map: new Map(f.items.map((it) => [pathKey(it.path), it])) };
    }
    return this.byKey.map.get(k) || null;
  }

  /**
   * The crop she has named (in any folder: examples.js) that animal i of p
   * looks most like, at LOOKALIKE_MIN or more, another photo's:
   * { label, file, similarity, when } or null.
   */
  lookalike(p, i) {
    const wl = bro.vision.wildlife;
    const q = this.analysis.embeddingOf(p, i);
    if (!q || typeof wl.nearest !== 'function') return null;
    const own = this.answers.keys.get(pathKey(p));
    const ex = this.examplesStore.like(this.embeddingModel(), q.length).filter((e) => e.key !== own);
    if (!ex.length) return null;
    const hit = wl.nearest(q, ex.map((e) => e.emb), 1, { minSimilarity: LOOKALIKE_MIN })[0];
    if (!hit) return null;
    const e = ex[hit.index];
    const label = answerLabels({ answer: { animals: [{ name: e.name, scientific: e.scientific, rank: e.rank }] } })[0];
    return { label, file: e.file, similarity: hit.similarity, when: e.time ? formatDate(e.time) : 'another photo' };
  }

  /** A photo's names as its tile shows them ('Mallard, Great Egret'; '' for none). */
  tagOf(p) {
    return this.answerOf(p).labels.map(countedText).join(', ');
  }

  /**
   * A photo's names for another view (Select Subject, Stabilize, a status):
   * [{ text, mine }], hers when she answered ('No animal' for none).
   */
  namesOf(p) {
    if (!this.active || !p) return [];
    const ans = this.answerOf(p);
    if (ans.mine && ans.mine.answer.none) return [{ text: 'No animal', mine: true }];
    return ans.labels.map((l) => ({ text: countedText(l), mine: !!l.mine }));
  }

  /** The status bar's words for the photo on screen: "Mallard ×4, Great Egret · yours". */
  statusOf(p) {
    const n = this.namesOf(p);
    if (!n.length) return '';
    return `${n.map((x) => x.text).join(', ')}${n[0].mine ? ' · yours' : ''}`;
  }

  // ---- search ------------------------------------------------------------------------

  /** Show only the photos whose file name or animal names hold every word of `q`. */
  setQuery(q) {
    const next = fold(q);
    if (this.searchInput.value !== q) this.searchInput.value = q;
    if (next === this.query) return;
    this.query = next;
    this.cache.key = '';
    if (this.onItems) this.onItems();
  }

  /**
   * Whether a photo matches the search: the whole text inside its file name,
   * or each word the start of a word of its file name or one of its names
   * (common, scientific, hers): 'jay' finds Blue Jay, 'd_01' only d_01.jpg.
   */
  matches(it, labels) {
    if (!this.query) return true;
    if (fold(it.name).includes(this.query)) return true;
    const words = fold([it.name, ...labels.flatMap((l) => [l.common, l.scientific, labelText(l)])].join(' ')).split(' ');
    return this.query.split(' ').every((w) => words.some((h) => h.startsWith(w)));
  }

  /** The filter's name on the button and in the status bar. */
  filterName() {
    if (this.filter === UNCERTAIN) return 'Uncertain';
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
    if (!this.active || (!a.results.size && !this.filter && !this.query && !this.answers.size)) return (this.lastShown = folderItems);
    const showEmpty = this.settings.get('showNoAnimals');
    const keep = new Set(this.keep ? this.keep().filter(Boolean) : []);
    const key = `${this.itemsSeq}|${this.filter}|${this.query}|${showEmpty}|${this.folder.version}|` +
      `${this.held ? this.heldSeq : ''}|${[...keep].join('\n')}`;
    if (this.cache.key === key && this.cache.src === folderItems) return (this.lastShown = this.cache.items);
    const out = [];
    const uncertainView = this.filter === UNCERTAIN;
    const itemOf = new Map();
    for (const it of folderItems) {
      const ans = this.answerOf(it.path);
      const { burst: b, labels, keys, empty, mine, uncertain, isUncertain } = ans;
      const stays = keep.has(it.path) || (this.held && this.held.has(it.path));
      if (!stays) {
        if (uncertainView ? !isUncertain : this.filter && !keys.has(this.filter)) continue;
        if (!this.filter && !showEmpty && empty) continue;
        if (!this.matches(it, labels)) continue;
      }
      // A photo whose answer did not change keeps its item: the grid and the strip leave its cell be.
      const had = this.itemOf.get(it.path);
      if (had && had.ans === ans && had.view === uncertainView && had.item.name === it.name) {
        itemOf.set(it.path, had);
        out.push(had.item);
        continue;
      }
      const top = labels[0];
      const sure = (l) => (l.mine ? 'yours' : `${Math.round(l.score * 100)}%`);
      const found = countsText(this.analysis.record(it.path));
      let names = mine && mine.answer.none ? 'No animal · yours' : labels.map((l) => `${countedText(l)} · ${sure(l)}`).join(', ');
      const item = {
        name: it.name, path: it.path,
        tag: top ? countedText(top) : '',
        conf: top ? Math.round(top.score * 100) : 0,
        mine: !!mine,
        none: !!(mine && mine.answer.none),
        more: Math.max(0, labels.length - 1),
        names,
        burst: b && b.count > 1 && pathKey(b.first) === pathKey(it.path) ? b.count : 0,
      };
      // In the Uncertain group each photo shows its best guess as a suggestion ("Blue Jay?").
      if (uncertainView && uncertain.length) {
        // Its suggestions (labels.js suggestionsOf: of the box's query's classes, none that rounds to 0%).
        const g = uncertain[0];
        const guessText = (c) => (guessOf(c) ? `${guessOf(c)}?` : 'Not identified');
        item.guess = true;
        item.tag = guessText(g);
        item.conf = Math.round(guessScore(g) * 100) || null;
        item.more = Math.max(0, uncertain.length - 1);
        names = `Uncertain: ${uncertain.map((c) => [guessText(c), percentText(guessScore(c))].filter(Boolean).join(' ')).join(', ')}` +
          (labels.length ? ` · named: ${labels.map(countedText).join(', ')}` : '');
      }
      item.names = names;
      item.found = found;      // "3 birds, 1 dog": the tile's tooltip
      // Worked out again to the same: still the item it had.
      const kept = had && had.view === uncertainView && sameFields(had.item, item) ? had.item : item;
      itemOf.set(it.path, { ans, view: uncertainView, item: kept });
      out.push(kept);
    }
    this.itemOf = itemOf;
    // The same photos with the same items: the last array, so nothing redraws.
    const prev = this.cache.src === folderItems ? this.cache.items : null;
    const same = prev && prev.length === out.length && prev.every((p, i) => p === out[i]);
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
   * (a photo counts once per taxon); the uncertain photos (isUncertain; also
   * as `unidentified`, its old name), and those without animals.
   */
  counts() {
    const by = new Map();
    let empty = 0, uncertain = 0;
    for (const it of this.folder.items) {
      const { labels, empty: none, isUncertain } = this.answerOf(it.path);
      for (const l of labels) {
        const k = labelKey(l);
        const t = by.get(k) || { key: k, label: labelText(l), count: 0 };
        t.count++;
        by.set(k, t);
      }
      if (isUncertain) uncertain++;
      if (none) empty++;
    }
    const taxa = [...by.values()].sort((x, y) => y.count - x.count || (x.label < y.label ? -1 : 1));
    return { taxa, uncertain, unidentified: uncertain, empty, all: this.folder.items.length - (this.settings.get('showNoAnimals') ? 0 : empty) };
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
    const ans = this.answerOf(p);
    // Her answer first when she gave one (the identifier's below it, as it said); else the
    // identifier's names, each hers to correct, with her one-key actions under them.
    const hers = this.editor.section(p, ans, target);
    const theirs = detailsSection(rec, a.burstOf(p), {
      pending: !rec && a.dir === this.folder.dir && a.total > 0, taxa: a.taxa, target,
      edit: hers ? null : this.editor.hook(p),
      actions: hers || !rec || rec.error ? null : this.editor.actions(p, ans),
      titles: hers ? { burst: 'Identifier · burst', photo: 'Identifier · this photo', alone: 'Identifier' } : null,
    });
    // At a glance, what the detector found ("3 birds, 1 dog"), over the names.
    const found = countsText(rec);
    const glance = found ? h('div.iv-animals-found.num', { title: 'What the detector found' }, `Found ${found}`) : null;
    if (hers) return h('div.iv-details-group', glance, hers, theirs);
    if (!rec || rec.error) return h('div.iv-details-group', this.editor.emptySection(p), theirs);
    return glance ? h('div.iv-details-group', glance, theirs) : theirs;
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
    shown(this.searchEl, on);
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
      ...this.editor.commandList({ browsing }),
      { id: 'animals-search', label: 'Search Names', icon: 'search', keys: ['Mod+F'], enabled: browsing,
        run: () => { this.searchInput.focus(); this.searchInput.select(); } },
      { id: 'animals-menu', label: 'Animals', icon: 'filter', enabled: () => browsing() && (a.results.size > 0 || !!this.filter),
        run: () => this.showMenu() },
      { id: 'animals-filter', label: 'Show Species', enabled: browsing, run: (key) => this.setFilter(key) },
      { id: 'animals-outlines', label: 'Show Animal Outlines', icon: 'eye', keys: ['O'], enabled: () => this.active && !this.holding(),
        checked: () => this.settings.get('showOutlines'),
        run: () => { this.settings.set('showOutlines', !this.settings.get('showOutlines')); if (this.outlines) this.outlines.draw(); } },
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

  /** The Animals menu: All, every taxon with its photo count, Uncertain, the toggle. */
  showMenu() {
    const c = this.counts();
    const pick = (key, label, count) => this.commands.item('animals-filter', {
      label, count, checked: this.filter === key, icon: undefined,
      action: () => this.commands.run('animals-filter', key),
    });
    const items = [
      pick('', 'All photos', c.all),
      c.taxa.length || c.uncertain ? { separator: true } : null,
      ...c.taxa.map((t) => pick(t.key, t.label, t.count)),
      c.uncertain || this.filter === UNCERTAIN ? pick(UNCERTAIN, 'Uncertain', c.uncertain) : null,
      { separator: true },
      this.commands.item('animals-show-empty', { count: c.empty }),
    ];
    if (['running', 'loading', 'paused'].includes(this.analysis.state)) items.push(this.commands.item('animals-pause'));
    menu.showBelow(items, this.filterBtn);
  }
}
