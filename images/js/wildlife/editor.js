/**
 * Her corrections: Jennie is the answer sheet, the identifier a first pass.
 * Every name the details panel shows is hers to change in place, and what
 * she says is kept (answers.js) and shown everywhere from then on.
 *
 *  - Click a name (or N, or F2 on a focused animal row) to correct it: a
 *    field that suggests every name of the species lists, common and
 *    scientific, and the groups above species ("Darners (Aeshnidae)")
 *    (lib/combobox.js over bro.vision.wildlife.nameIndex); her own words are
 *    kept too, a leading number is a count ("4 Mallard"). Enter saves,
 *    Escape cancels.
 *  - One action each: Confirm (Y, or a row's check: the names shown are
 *    right), Add an animal (A), Remove this one (X, or a row's cross), No
 *    animal (Shift+N), Revert to identifier.
 *  - In a burst, each applies to this photo or the whole burst: the scope
 *    switch beside the actions shows which; Shift+Enter in the field, a
 *    shift-click on an action or Shift+Y takes the other; the one used last
 *    is remembered (the answerScope setting).
 *  - Next to check (U): the next photo shown with an animal and no answer of
 *    hers, never one of a spider or another arachnid (mine.js isArachnid).
 *
 * Every change says so in a toast with Undo.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { toast } from '/lib/toast.js';
import { formatNumber } from '/lib/format.js';
import { Combobox } from '/lib/combobox.js';
import { labelKey, animalOf, animalFromText, editText, parseNameText, suggestionDetail, isArachnid, recordHasArachnid } from './mine.js';
import { labelText, countedText } from './labels.js';

const RANK_NAMES = { species: 'Species', genus: 'Genus', family: 'Family', order: 'Order', class: 'Class' };

export const EDITOR_SETTINGS = {
  // Her last choice in a burst: a correction applies to 'photo' (this one) or 'burst' (every frame).
  answerScope: { type: 'string', default: 'photo' },
};

export class AnswerEditor {
  /**
   * feature: the WildlifeFeature (answerOf, answers, analysis, nameIndex);
   * current(): the photo on screen or selected; openDetails(): show the
   * details panel; goTo(path): show a photo; shownItems(): what the grid shows.
   */
  constructor({ feature, settings, current, openDetails, goTo, shownItems }) {
    this.feature = feature;
    this.settings = settings;
    this.current = current;
    this.openDetails = openDetails;
    this.goTo = goTo;
    this.shownItems = shownItems;
    this.editing = null;          // { path, ref, cb, row }
    this.returnFocus = null;
  }

  get active() { return !!this.editing; }

  // ---- scope -------------------------------------------------------------------------

  /** The burst of p as Find Animals grouped it, when it has more than one photo. */
  burstOf(p) {
    const b = this.feature.analysis.burstOf(p);
    return b && b.count > 1 ? b : null;
  }

  /** 'photo' or 'burst': the remembered choice, the other one with `other`; 'photo' outside a burst. */
  scopeFor(p, other = false) {
    if (!this.burstOf(p)) return 'photo';
    const s = this.settings.get('answerScope') === 'burst' ? 'burst' : 'photo';
    return other ? (s === 'burst' ? 'photo' : 'burst') : s;
  }

  remember(p, scope) {
    if (this.burstOf(p) && this.settings.get('answerScope') !== scope) this.settings.set('answerScope', scope);
  }

  pathsFor(p, scope) {
    const b = scope === 'burst' ? this.burstOf(p) : null;
    return b ? b.photos.slice() : [p];
  }

  // ---- what she changes --------------------------------------------------------------

  /** The names a photo shows now, as her answer's animals. */
  animalsOf(p) {
    return this.feature.answerOf(p).labels.map(animalOf);
  }

  /**
   * Save `answer` ({ animals } or { none: true }) for p, or p's burst (`other`
   * flips the remembered scope), and say so with an Undo.
   */
  async save(p, answer, { other = false, confirmed = false, what = '' } = {}) {
    const scope = this.scopeFor(p, other);
    this.remember(p, scope);
    const paths = this.pathsFor(p, scope);
    let undo;
    try {
      undo = await this.feature.answers.put(paths, answer, { scope, confirmed });
    } catch (err) {
      toast(`Could not save your answer: ${err.message}`, { error: true });
      return false;
    }
    this.say(what, paths.length, undo);
    return true;
  }

  say(what, n, undo) {
    const where = n > 1 ? ` · ${formatNumber(n)} photos of the burst` : '';
    toast(`${what}${where}`, { icon: 'check', action: 'Undo', onAction: () => this.feature.answers.restore(undo) });
  }

  /** The rows of the details panel she can correct, in order. */
  rows() {
    return Array.from(document.querySelectorAll('.iv-details .iv-animal[data-edit]'));
  }

  /** The row a key acts on: the focused one, else the first named one, else the first. */
  targetRow({ named = false } = {}) {
    const rows = this.rows();
    const focused = rows.find((r) => r === document.activeElement || r.contains(document.activeElement));
    if (focused) return focused;
    return rows.find((r) => r._ref && !r._ref.add) || (named ? null : rows[0]) || null;
  }

  /** Where in the shown names a row's animal is (-1: none, a crop no rank named). */
  indexOf(p, ref) {
    if (!ref || ref.add) return -1;
    const labels = this.feature.answerOf(p).labels;
    if (ref.mine) return ref.index < labels.length ? ref.index : -1;
    const k = labelKey(ref.label);
    return labels.findIndex((l) => labelKey(l) === k);
  }

  confirm(p, { other = false } = {}) {
    const ans = this.feature.answerOf(p);
    if (!ans.labels.length) {
      toast(ans.mine ? 'Your answer is already “no animal”' : 'No name to confirm: name the animal (N) or say there is none (Shift+N)', { icon: 'info' });
      return Promise.resolve(false);
    }
    const names = ans.labels.map(countedText).join(', ');
    return this.save(p, { animals: ans.labels.map(animalOf) }, { other, confirmed: !ans.mine || !!(ans.mine && ans.mine.confirmed),
      what: `${ans.mine ? 'Kept' : 'Confirmed'} ${names}` });
  }

  remove(p, ref, { other = false } = {}) {
    const i = this.indexOf(p, ref);
    const animals = this.animalsOf(p);
    if (i < 0 || i >= animals.length) return Promise.resolve(false);
    const [gone] = animals.splice(i, 1);
    return this.save(p, animals.length ? { animals } : { none: true }, { other,
      what: animals.length ? `Removed ${gone.name}` : `Removed ${gone.name}: no animal` });
  }

  none(p, { other = false } = {}) {
    return this.save(p, { none: true }, { other, what: 'No animal' });
  }

  async revert(p, { other = false } = {}) {
    const scope = this.scopeFor(p, other);
    const paths = this.pathsFor(p, scope);
    const undo = await this.feature.answers.revert(paths);
    if (!undo.length) { toast('The identifier’s names are showing already', { icon: 'info' }); return false; }
    this.say('Back to the identifier’s names', undo.length, undo);
    return true;
  }

  /** The next photo shown with an animal and no answer of hers; never a spider's. */
  nextToCheck() {
    const items = this.shownItems();
    if (!items.length) return null;
    const cur = this.current();
    const at = items.findIndex((it) => it.path === cur);
    const index = this.feature.nameIndex();
    for (let k = 1; k <= items.length; k++) {
      const it = items[(at + k + items.length) % items.length];
      if (it.path === cur) continue;
      const ans = this.feature.answerOf(it.path);
      if (ans.mine || !ans.animal) continue;
      if (ans.labels.some((l) => isArachnid(l, index))) continue;
      if (recordHasArachnid(this.feature.analysis.record(it.path))) continue;
      return it.path;
    }
    return null;
  }

  goNextToCheck() {
    const p = this.nextToCheck();
    if (p) this.goTo(p);
    else toast('Every photo with an animal has your answer', { icon: 'check' });
  }

  // ---- the details panel ------------------------------------------------------------------

  /** The edit hook labels.js calls for each row she can correct (bound to the photo). */
  hook(p) {
    return (el, ref) => this.decorate(el, ref, p);
  }

  /** A row she can correct: focusable, its name a click to edit, a check and a cross. */
  decorate(el, ref, p) {
    el._ref = ref;
    el.dataset.edit = ref.add ? 'add' : String(ref.index);
    el.tabIndex = 0;
    const name = el.querySelector('.iv-animal-name');
    name.classList.add('iv-animal-edit');
    name.title = ref.add ? 'Name this animal (N)' : 'Correct this name (N)';
    name.addEventListener('click', (e) => { e.stopPropagation(); this.startOn(el, p); });
    if (ref.add) return;
    const row = el.querySelector('.iv-animal-row');
    const btn = (iconName, tip, run) => h('button.icon-btn.small.iv-animal-act', {
      'data-tip': tip, 'aria-label': tip,
      onclick: (e) => { e.stopPropagation(); run({ other: !!e.shiftKey }); },
    }, icon(iconName));
    const acts = h('span.iv-animal-acts',
      ref.mine ? null : btn('check', 'Correct (Y)', (o) => this.confirm(p, o)),
      btn('x', 'Remove this one (X)', (o) => this.remove(p, ref, o)));
    row.append(acts);
  }

  /** The action bar: Confirm (when the identifier named something), Add, No animal, Revert, and the scope. */
  actions(p, ans) {
    const b = this.burstOf(p);
    const act = (label, tip, run, primary = false) => h(`button.btn.small${primary ? '' : '.ghost'}.iv-answer-act`, {
      'data-tip': tip, onclick: (e) => { e.stopPropagation(); run({ other: !!e.shiftKey }); },
    }, label);
    const bar = h('div.iv-answer-actions',
      ans.labels.length && !ans.mine ? act('Correct', 'The names shown are correct (Y)', (o) => this.confirm(p, o)) : null,
      act('Add animal', 'Add an animal (A)', () => this.startAdd(p)),
      !(ans.mine && ans.mine.answer.none) ? act('No animal', 'There is no animal (Shift+N)', (o) => this.none(p, o)) : null,
      ans.mine ? act('Revert to identifier', 'Show the identifier’s names again', (o) => this.revert(p, o)) : null);
    if (b) {
      const scope = this.scopeFor(p);
      const seg = (value, label) => h(`button${scope === value ? '.on' : ''}`, {
        role: 'radio', 'data-scope': value,
        onclick: (e) => { e.stopPropagation(); this.remember(p, value); this.feature.detailsChanged(); },
      }, label);
      bar.append(h('div.segmented.iv-answer-scope', { role: 'radiogroup', 'data-tip': 'Your answers apply to (Shift for the other)' },
        seg('photo', 'This photo'), seg('burst', `Whole burst (${b.count})`)));
    }
    return bar;
  }

  /** Her answer's section: her names (each correctable), marked as hers, and the actions. */
  section(p, ans, target) {
    const mine = ans.mine;
    if (!mine) return null;
    const edit = this.hook(p);
    const mark = () => h('span.iv-animal-mine', { title: mine.confirmed ? 'You confirmed the identifier’s name' : 'Your answer' },
      icon('check', 'sm'), 'yours');
    const items = ans.labels.map((l, index) => {
      const el = h(`div.iv-animal${target && l.boxes.length ? '.iv-animal-hit' : ''}`,
        h('div.iv-animal-row', h('span.iv-animal-name.ellipsis', labelText(l)),
          l.count > 1 ? h('span.iv-animal-count.num', `×${l.count}`) : null, mark()),
        l.rank ? h('div.iv-animal-meta.num', l.rank === 'species' ? l.scientific : RANK_NAMES[l.rank]) : null);
      el.title = labelText(l);
      if (target && l.boxes.length) {
        el._animal = { path: target.path, size: target.size, boxes: l.boxes };
        el.dataset.animal = `${target.path}|${JSON.stringify(l.boxes)}`;
      }
      edit(el, { index, label: l, mine: true });
      return el;
    });
    if (mine.answer.none) {
      items.push(h('div.iv-animal.iv-answer-none', h('div.iv-animal-row', h('span.iv-animal-name', 'No animal'), mark())));
    }
    return h('div.iv-details-section.iv-answer',
      h('div.micro.iv-details-title', 'Animals'),
      h('div.iv-animals-list', ...items),
      this.actions(p, ans));
  }

  /** For a photo the identifier has said nothing about: a section to name it anyway. */
  emptySection(p) {
    return h('div.iv-details-section.iv-answer',
      h('div.micro.iv-details-title', 'Animals'),
      h('div.iv-animals-list'),
      this.actions(p, this.feature.answerOf(p)));
  }

  // ---- editing a name ------------------------------------------------------------------

  /** Edit the focused or first animal (N, F2); with none, add one. */
  editCurrent() {
    const p = this.current();
    if (!p) return;
    this.openDetails();
    const row = this.targetRow();
    if (row) this.startOn(row, p);
    else this.startAdd(p);
  }

  /** A new row at the end of the animals for a name to add (A). */
  startAdd(p) {
    if (!p) return;
    this.openDetails();
    // Above the actions: under the names she is answering for.
    const bar = document.querySelector('.iv-details .iv-answer-actions');
    if (!bar) return;
    const row = h('div.iv-animal.iv-animal-new', h('div.iv-animal-row', h('span.iv-animal-name', '')));
    row._ref = { add: true };
    bar.before(row);
    this.startOn(row, p);
  }

  /** Put the field in a row's name. */
  startOn(row, p) {
    if (this.editing) this.cancel();
    const ref = row._ref || { add: true };
    const name = row.querySelector('.iv-animal-name');
    if (!name) return;
    const i = this.indexOf(p, ref);
    const label = i >= 0 ? this.feature.answerOf(p).labels[i] : null;
    if (!document.querySelector('.iv-details') || !document.querySelector('.iv-details').contains(document.activeElement)) {
      this.returnFocus = document.activeElement;
    }
    const index = this.feature.nameIndex();
    const cb = new Combobox({
      value: label ? editText(label, labelText(label)) : '',
      placeholder: 'Name, scientific name or group',
      label: 'Animal name',
      suggest: (text) => this.suggest(text, index),
      onCommit: ({ item, text, shiftKey }) => this.commit({ item, text, shiftKey }),
      onCancel: () => this.cancel(),
      onBlur: () => this.cancel(),
    });
    name.replaceWith(cb.el);
    row.classList.add('editing');
    const b = this.burstOf(p);
    const hint = b ? h('div.iv-answer-hint', this.scopeFor(p) === 'burst'
      ? `Enter: whole burst (${b.count}) · Shift+Enter: this photo` : `Enter: this photo · Shift+Enter: whole burst (${b.count})`)
      : h('div.iv-answer-hint', 'Enter saves · Escape cancels');
    cb.el.after(hint);
    this.editing = { path: p, ref, label, cb, row, hint };
    cb.focus();
  }

  suggest(text, index) {
    if (!index) return [];
    // "4 Mallard": the count is hers, the suggestions are for the name.
    return index.search(parseNameText(text).name, { limit: 8 }).map((e) => ({ label: e.label, detail: suggestionDetail(e), value: e, strong: e.score >= 80 }));
  }

  async commit({ item, text, shiftKey }) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const p = ed.path;
    const animal = animalFromText({ entry: item ? item.value : null, text, index: this.feature.nameIndex(),
      keepCount: ed.label && !/^\s*\d/.test(text) ? ed.label.count || 0 : 0 });
    this.restoreFocus();
    if (!animal) { this.feature.detailsChanged(); return; }
    const animals = this.animalsOf(p);
    const i = this.indexOf(p, ed.ref);
    if (i >= 0) animals[i] = animal; else animals.push(animal);
    const shown = animal.count > 1 ? `${animal.name} ×${animal.count}` : animal.name;
    const was = ed.label ? countedText(ed.label) : '';
    await this.save(p, { animals }, { other: shiftKey, what: was && was !== shown ? `${was} → ${shown}` : `Saved ${shown}` });
    this.feature.detailsChanged();
  }

  cancel() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.cb.destroy();
    this.restoreFocus();
    this.feature.detailsChanged();
  }

  /** Drop an edit whose photo is no longer the one shown (nothing saved, nothing redrawn). */
  abandon() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    this.returnFocus = null;
    ed.cb.destroy();
  }

  restoreFocus() {
    const f = this.returnFocus;
    this.returnFocus = null;
    if (f && f.isConnected && typeof f.focus === 'function') f.focus();
  }

  // ---- commands ---------------------------------------------------------------------------

  commandList({ browsing }) {
    const photo = () => browsing() && !!this.current();
    const named = () => photo() && this.feature.answerOf(this.current()).labels.length > 0;
    const inRow = () => photo() && !!document.activeElement && !!document.activeElement.closest &&
      !!document.activeElement.closest('.iv-details .iv-animal[data-edit]');
    return [
      { id: 'animal-edit', label: 'Correct the Animal’s Name…', icon: 'edit', keys: ['N'], enabled: photo, run: () => this.editCurrent() },
      { id: 'animal-edit-row', label: 'Correct This Name…', keys: ['F2'], enabled: inRow, run: () => this.editCurrent() },
      { id: 'animal-confirm', label: 'The Names Are Correct', icon: 'check', keys: ['Y'], enabled: photo,
        run: () => this.confirm(this.current()) },
      { id: 'animal-confirm-other', label: 'The Names Are Correct (Other Scope)', keys: ['Shift+Y'], enabled: photo,
        run: () => this.confirm(this.current(), { other: true }) },
      { id: 'animal-add', label: 'Add an Animal…', icon: 'plus', keys: ['A'], enabled: photo, run: () => this.startAdd(this.current()) },
      { id: 'animal-remove', label: 'Remove This Animal', icon: 'x', keys: ['X'], enabled: named,
        run: () => { const r = this.targetRow({ named: true }); if (r) this.remove(this.current(), r._ref); } },
      { id: 'animal-none', label: 'No Animal', keys: ['Shift+N'], enabled: photo, run: () => this.none(this.current()) },
      { id: 'animal-revert', label: 'Revert to Identifier', icon: 'undo',
        enabled: () => photo() && !!this.feature.answerOf(this.current()).mine, run: () => this.revert(this.current()) },
      { id: 'animal-next', label: 'Next Photo to Check', icon: 'arrow-right', keys: ['U'], enabled: browsing,
        run: () => this.goNextToCheck() },
    ];
  }
}
