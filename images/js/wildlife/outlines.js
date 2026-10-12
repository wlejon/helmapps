/**
 * The animals on the photo itself: each box the identifier classified is a
 * quiet outline over the photo on screen, following zoom and pan (drawn
 * through the viewer's pictureMatrix on every view draw, as isolate.js).
 * Its kind shows in its colour: hers, a sure name, or uncertain (no name at
 * the threshold); its name on hover. A click opens the picker for that
 * animal:
 *
 *   - chips: the identifier's sure name, its top guesses for the crop, and
 *     "Looks like your Blue Jay from Oct 3" when the crop's embedding is
 *     near one she has named (feature.lookalike: bro.vision.wildlife.nearest
 *     over her named crops, LOOKALIKE_MIN or more);
 *   - a field over every name of the lists, her own words kept (as the
 *     details' name field, editor.js suggest); its suggestions are in the
 *     picker's flow (Combobox inline), so they push the buttons down and
 *     never lie over them;
 *   - Remove (no name here) and Not an animal (the box is no animal; its
 *     outline goes).
 *
 * Every choice is the editor's (nameBox / dropBox): this photo or the same
 * animal in the burst's other frames (by box overlap), Shift for the other.
 * Off with the showOutlines setting (O), and while Select Subject or
 * Stabilize is open (their clicks are on the photo).
 *
 *   const o = new Outlines({ viewer, host, feature });
 *   o.draw();          // on every view draw
 *   o.open(i);         // the picker for record.animals[i] (tests; a click does it)
 *   o.state()          // { path, boxes: [{ i, kind, name }], picker: { i, chips } | null } (tests)
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { formatPercent } from '/lib/format.js';
import { Combobox } from '/lib/combobox.js';
import { pathKey } from './records.js';
import { cropList, labelOfBox, notAnimalBox, guessOf } from './crops.js';
import { labelText } from './labels.js';
import { animalFromText, animalOf } from './mine.js';

const pct = (x) => formatPercent(x, 0);

export class Outlines {
  constructor({ viewer, host, feature }) {
    this.viewer = viewer;
    this.feature = feature;
    this.layer = h('div.iv-outlines.hidden');
    host.append(this.layer);
    this.items = [];              // [{ i, box, kind, name, el }]
    this.key = '';
    this.path = '';
    this.picker = null;           // { i, el, cb, chips }
    // The wheel over an outline still zooms the photo.
    this.layer.addEventListener('wheel', (e) => this.viewer.onWheel(e), { passive: false });
    window.addEventListener('pointerdown', (e) => {
      if (this.picker && !this.picker.el.contains(e.target) && !(e.target.closest && e.target.closest('.combobox-list'))) this.close();
    }, true);
  }

  /** Whether outlines show now: on, a photo on screen, nothing else using clicks on it. */
  shown() {
    const f = this.feature;
    return f.active && f.mode() === 'image' && !f.holding() && f.settings.get('showOutlines') && !!this.viewer.pic;
  }

  /** The photo on screen's animals as outlines: [{ i, box, kind, name, label, crop }]. */
  animals(p) {
    const f = this.feature;
    const rec = f.analysis.record(p);
    if (!rec || rec.error || !rec.width) return [];
    const ans = f.answerOf(p);
    const answer = ans.mine ? ans.mine.answer : null;
    return cropList(rec, f.analysis.taxa).filter((c) => !notAnimalBox(answer, c.box)).map((c) => {
      const l = labelOfBox(ans.labels, c.box);
      // Her answer is the last word: a box she left unnamed is no animal of hers.
      const kind = l ? (l.mine ? 'mine' : 'sure') : ans.mine ? 'unnamed' : 'uncertain';
      const name = l ? labelText(l) : ans.mine ? 'Not named' : `${guessOf(c)}?`;
      return { i: c.i, box: c.box, kind, name, label: l, crop: c };
    });
  }

  draw() {
    if (!this.shown()) { this.hide(); return; }
    const v = this.viewer;
    const p = v.pic.path;
    const rec = this.feature.analysis.record(p);
    const M = v.pictureMatrix();
    if (!M || !rec || rec.error || !rec.width) { this.hide(); return; }
    if (this.picker && pathKey(this.path) !== pathKey(p)) this.close();
    const list = this.animals(p);
    // The outlines are made again only when what they show changed: a result landing for
    // another photo leaves them (and the picker placed on one) where they are.
    const key = `${pathKey(p)}|${list.map((a) => `${a.i}:${a.kind}:${a.name}:${a.box.join(' ')}`).join(',')}`;
    if (key === this.key) {
      this.items = list.map((a, j) => ({ ...a, el: this.items[j].el }));
      if (this.picker) this.picker.item = this.items.find((x) => x.el === this.picker.item.el) || this.picker.item;
    } else {
      this.key = key;
      this.path = p;
      this.items = list.map((a) => {
        const el = h(`div.iv-outline.${a.kind}`, { title: a.name, 'data-i': String(a.i) },
          h('span.iv-outline-tag.ellipsis', a.kind === 'mine' ? icon('user', 'sm') : null, a.name));
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => { e.stopPropagation(); this.open(a.i); });
        return { ...a, el };
      });
      this.layer.replaceChildren(...this.items.map((a) => a.el));
      // An open picker stays on its animal's new outline (gone: it closes).
      const pk = this.picker;
      const now = pk && this.items.find((x) => x.i === pk.i);
      if (now) { pk.item = now; now.el.classList.add('picking'); } else if (pk) this.close();
    }
    this.layer.classList.toggle('hidden', !this.items.length);
    // The record's pixels -> the picture's (a preview has a nominal size) -> stage px; the box's bounds.
    const k = v.pic.width / rec.width;
    for (const a of this.items) {
      const [x, y, w, ht] = a.box;
      const pts = [[x, y], [x + w, y], [x, y + ht], [x + w, y + ht]].map(([px, py]) =>
        [M[0] * px * k + M[1] * py * k + M[2], M[3] * px * k + M[4] * py * k + M[5]]);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const left = Math.min(...xs), top = Math.min(...ys);
      Object.assign(a.el.style, { left: `${left}px`, top: `${top}px`,
        width: `${Math.max(...xs) - left}px`, height: `${Math.max(...ys) - top}px` });
    }
    if (this.picker) this.place();
  }

  hide() {
    if (this.picker) this.close();
    if (!this.layer.classList.contains('hidden')) this.layer.classList.add('hidden');
    this.key = '';
  }

  /** The chips of a crop's picker: [{ text, detail, animal, kind }]. */
  chips(p, a) {
    const f = this.feature;
    const out = [];
    const seen = new Set();
    const add = (text, detail, animal, kind) => {
      const k = animal.scientific || animal.name;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ text, detail, animal, kind });
    };
    if (a.label && !a.label.mine) add(labelText(a.label), 'sure', animalOf({ ...a.label, boxes: [] }), 'sure');
    for (const s of a.crop.species.slice(0, 3)) {
      add(s.common || s.scientific, pct(s.score), { name: s.common || s.scientific, scientific: s.scientific, rank: 'species' }, 'guess');
    }
    const look = f.lookalike(p, a.i);
    if (look) {
      out.push({ text: `Looks like your ${labelText(look.label)}`, detail: `from ${look.when}`,
        animal: animalOf({ ...look.label, boxes: [], count: 0 }), kind: 'lookalike' });
    }
    return out;
  }

  /** The picker for record.animals[i] of the photo on screen. */
  open(i) {
    const a = this.items.find((x) => x.i === i);
    if (!a) return false;
    this.close();
    const p = this.path;
    const ed = this.feature.editor;
    const chips = this.chips(p, a);
    const b = ed.burstOf(p);
    const scope = ed.scopeFor(p);
    // Her choice closes this picker at once (her answer shows before it is on disk); the save's
    // end only refreshes the details, never closing a picker she has opened since.
    const mine = () => !!this.picker && this.picker.cb === cb;
    const done = () => this.feature.detailsChanged();
    const pick = (animal, shiftKey) => {
      if (mine()) this.close();
      ed.nameBox(p, a.box, animal, { other: shiftKey }).then(done, done);
    };
    const index = this.feature.nameIndex();
    // The suggestions in the picker's flow: Remove and Not an animal move down
    // under them rather than lying beneath a list a click would land on.
    const cb = new Combobox({
      placeholder: 'Name, scientific name or group', label: 'Animal name', inline: true,
      onLayout: () => { if (this.picker && this.picker.cb === cb) this.place(); },
      suggest: (text) => ed.suggest(text, index),
      onCommit: ({ item, text, shiftKey }) => {
        const animal = animalFromText({ entry: item ? item.value : null, text, index });
        if (animal) pick(animal, shiftKey); else this.close();
      },
      onCancel: () => this.close(),
    });
    const chipEls = chips.map((c) => h(`button.btn.small.iv-chip.${c.kind}`, {
      'data-tip': c.kind === 'lookalike' ? `${c.text} ${c.detail}` : null,
      onclick: (e) => { e.stopPropagation(); pick(c.animal, !!e.shiftKey); },
    }, c.kind === 'lookalike' ? icon('user', 'sm') : null, h('span.iv-chip-text.ellipsis', c.text), h('span.iv-chip-detail', c.detail)));
    const act = (label, tip, no) => h('button.btn.small.ghost', {
      'data-tip': tip, onclick: (e) => {
        e.stopPropagation();
        if (mine()) this.close();
        ed.dropBox(p, a.box, { other: !!e.shiftKey, notAnimal: no }).then(done, done);
      },
    }, label);
    const el = h('div.iv-picker', { role: 'dialog', 'aria-label': `Name this animal: ${a.name}` },
      h('div.iv-picker-head', h('span.iv-picker-name.ellipsis', a.name),
        h('span.iv-picker-kind', { mine: 'yours', sure: 'identifier', uncertain: 'uncertain', unnamed: '' }[a.kind])),
      chipEls.length ? h('div.iv-picker-chips', ...chipEls) : null,
      cb.el,
      h('div.iv-picker-acts', act('Remove', 'No name for this one (Shift: the other scope)', false),
        act('Not an animal', 'The box is not an animal (Shift: the other scope)', true)),
      h('div.iv-answer-hint', b ? (scope === 'burst' ? `Enter: same animal, whole burst (${b.count}) · Shift+Enter: this photo`
        : `Enter: this photo · Shift+Enter: same animal, whole burst (${b.count})`) : 'Enter saves · Escape closes'));
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('wheel', (e) => e.stopPropagation());
    document.body.append(el);
    a.el.classList.add('picking');
    this.picker = { i, el, cb, chips, item: a };
    this.place();
    cb.focus();
    return true;
  }

  /** Under its outline (above it when there is no room), inside the window. */
  place() {
    const pk = this.picker;
    const r = pk.item.el.getBoundingClientRect();
    const w = pk.el.offsetWidth, ht = pk.el.offsetHeight;
    const W = window.innerWidth, H = window.innerHeight;
    let top = r.bottom + 6;
    if (top + ht > H - 8) top = Math.max(8, r.top - ht - 6);
    const left = Math.min(Math.max(8, r.left), Math.max(8, W - w - 8));
    pk.el.style.left = `${left}px`;
    pk.el.style.top = `${top}px`;
  }

  close() {
    const pk = this.picker;
    if (!pk) return;
    this.picker = null;
    pk.cb.destroy();
    pk.el.remove();
    pk.item.el.classList.remove('picking');
  }

  state() {
    return {
      path: this.path,
      boxes: this.items.map((a) => ({ i: a.i, kind: a.kind, name: a.name })),
      picker: this.picker ? { i: this.picker.i, chips: this.picker.chips.map((c) => ({ text: c.text, detail: c.detail, kind: c.kind })) } : null,
    };
  }
}
