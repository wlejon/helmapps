/**
 * The animals on the photo itself, only when asked for: the photo is for
 * looking, so by default nothing lies over it. An animal's box shows
 *
 *   - while the pointer is on it in the details panel (with isolate.js's
 *     darkening; setFocus), that animal's boxes alone;
 *   - while its picker is open (a click on it in the details opens it:
 *     openBox), that box alone;
 *   - and every box with the showOutlines setting on (O, or the toolbar's
 *     outline button; remembered).
 *
 * A box is a quiet outline over the photo on screen, following zoom and
 * pan (drawn through the viewer's pictureMatrix on every view draw, as
 * isolate.js). Its kind shows in its colour: hers, a sure name, or
 * uncertain (no name at the threshold). Its name tag shows over the
 * focused or picked box and on hover: above the box, else inside its top
 * left, else under it, always whole inside the stage (a long name ends in
 * an ellipsis at TAG_MAX). A click on a box opens the picker for that animal:
 *
 *   - chips: the identifier's sure name, the names already in this photo
 *     or its burst (a second Mallard by the first), the crop's guesses
 *     (labels.js suggestionsOf: of its box's query's classes, a bird box
 *     birds; none at 0%), and "Looks like your Blue Jay from Oct 3" when
 *     the crop's embedding is near one she has named (feature.lookalike:
 *     bro.vision.wildlife.nearest over her named crops, LOOKALIKE_MIN or more);
 *   - a field over every name of the lists, her own words kept (as the
 *     details' name field, editor.js suggest); its suggestions are in the
 *     picker's flow (Combobox inline), so they push the buttons down and
 *     never lie over them;
 *   - Remove (no name here) and Not an animal (the box is no animal; its
 *     outline goes).
 *
 * Every choice is the editor's (nameBox / dropBox): this photo or the same
 * animal in the burst's other frames (by box overlap), Shift for the other.
 * None while Select Subject or Stabilize is open (their clicks are on the photo).
 *
 *   const o = new Outlines({ viewer, host, feature });
 *   o.draw();             // on every view draw
 *   o.setFocus(animal);   // { path, boxes } of the details row under the pointer, or null
 *   o.open(i);            // the picker for record.animals[i] of a box shown (tests; a click does it)
 *   o.openBox(path, box); // the picker for the animal in `box`, its box shown
 *   o.state()             // { path, boxes: [{ i, kind, name }], picker: { i, chips } | null } (tests)
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Combobox } from '/lib/combobox.js';
import { pathKey } from './records.js';
import { cropList, labelOfBox, notAnimalBox, guessOf, sameBox } from './crops.js';
import { labelText, suggestionsOf, percentText } from './labels.js';
import { animalFromText, animalOf } from './mine.js';

/** A name tag's widest (px): a longer name ends in an ellipsis. */
export const TAG_MAX = 200;
/** Names of this photo and its burst offered in a picker, at most. */
const SIBLINGS_MAX = 3;

export class Outlines {
  constructor({ viewer, host, feature }) {
    this.viewer = viewer;
    this.feature = feature;
    this.layer = h('div.iv-outlines.hidden');
    host.append(this.layer);
    this.items = [];              // [{ i, box, kind, name, el, tag, tagW, tagH }]
    this.key = '';
    this.path = '';
    this.picker = null;           // { i, el, cb, chips, item }
    this.focus = null;            // { path, boxes }: the details row under the pointer
    this.opening = null;          // openBox's animal while its picker opens
    // The wheel over an outline still zooms the photo.
    this.layer.addEventListener('wheel', (e) => this.viewer.onWheel(e), { passive: false });
    window.addEventListener('pointerdown', (e) => {
      if (this.picker && !this.picker.el.contains(e.target) && !(e.target.closest && e.target.closest('.combobox-list'))) this.close();
    }, true);
  }

  /** Whether boxes may show now: on, a photo on screen, nothing else using clicks on it. */
  shown() {
    const f = this.feature;
    return f.active && f.mode() === 'image' && !f.holding() && !!this.viewer.pic;
  }

  /** Every box of the photo, or only the ones asked for (the setting off). */
  all() {
    return !!this.feature.settings.get('showOutlines');
  }

  /** Whether a box is the focused animal's (the details row under the pointer). */
  focused(p, box) {
    const fo = this.focus;
    return !!fo && pathKey(fo.path) === pathKey(p) && fo.boxes.some((b) => sameBox(b, box));
  }

  /** The photo on screen's animals: [{ i, box, kind, name, label, crop }]. */
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
      const guess = guessOf(c);
      const name = l ? labelText(l) : ans.mine ? 'Not named' : guess ? `${guess}?` : 'Not identified';
      return { i: c.i, box: c.box, kind, name, label: l, crop: c };
    });
  }

  /** The details row under the pointer is this animal ({ path, boxes }), or none (null): its boxes show. */
  setFocus(animal) {
    const next = animal && animal.boxes && animal.boxes.length ? { path: animal.path, boxes: animal.boxes } : null;
    const k = (x) => (x ? `${pathKey(x.path)}|${JSON.stringify(x.boxes)}` : '');
    if (k(next) === k(this.focus)) return;
    this.focus = next;
    this.draw();
  }

  draw() {
    if (!this.shown()) { this.hide(); return; }
    const v = this.viewer;
    const p = v.pic.path;
    const rec = this.feature.analysis.record(p);
    const M = v.pictureMatrix();
    if (!M || !rec || rec.error || !rec.width) { this.hide(); return; }
    if (this.picker && pathKey(this.path) !== pathKey(p)) this.close({ redraw: false });
    const all = this.all();
    const pk = this.picker;
    const list = this.animals(p).filter((a) => all || this.focused(p, a.box) || (pk && pk.i === a.i) || this.opening === a.i);
    // The outlines are made again only when what they show changed: a result landing for
    // another photo leaves them (and the picker placed on one) where they are.
    const key = `${pathKey(p)}|${list.map((a) => `${a.i}:${a.kind}:${a.name}:${a.box.join(' ')}`).join(',')}`;
    if (key === this.key) {
      this.items = list.map((a, j) => ({ ...this.items[j], ...a }));
      if (pk) pk.item = this.items.find((x) => x.el === pk.item.el) || pk.item;
    } else {
      this.key = key;
      this.path = p;
      this.items = list.map((a) => {
        const el = h(`div.iv-outline.${a.kind}`, { title: a.name, 'data-i': String(a.i) });
        // The tag is the outline's next sibling (hover shows it, CSS) and the layer's child, so
        // it is placed in the stage, not cut to the box; measured once, at its own width.
        const tag = h('span.iv-outline-tag', { 'data-i': String(a.i), style: { left: '0px', top: '0px', maxWidth: `${TAG_MAX}px` } },
          a.kind === 'mine' ? icon('user', 'sm') : null, h('span.iv-outline-tag-text.ellipsis', a.name));
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => { e.stopPropagation(); this.open(a.i); });
        return { ...a, el, tag, tagW: 0, tagH: 0 };
      });
      this.layer.replaceChildren(...this.items.flatMap((a) => [a.el, a.tag]));
      // An open picker stays on its animal's new outline (gone: it closes).
      const now = pk && this.items.find((x) => x.i === pk.i);
      if (now) { pk.item = now; now.el.classList.add('picking'); } else if (pk) this.close({ redraw: false });
    }
    this.layer.classList.toggle('hidden', !this.items.length);
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    // The record's pixels -> the picture's (a preview has a nominal size) -> stage px; the box's bounds.
    const k = v.pic.width / rec.width;
    for (const a of this.items) {
      const [x, y, w, ht] = a.box;
      const pts = [[x, y], [x + w, y], [x, y + ht], [x + w, y + ht]].map(([px, py]) =>
        [M[0] * px * k + M[1] * py * k + M[2], M[3] * px * k + M[4] * py * k + M[5]]);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const left = Math.min(...xs), top = Math.min(...ys);
      const bw = Math.max(...xs) - left, bh = Math.max(...ys) - top;
      Object.assign(a.el.style, { left: `${left}px`, top: `${top}px`, width: `${bw}px`, height: `${bh}px` });
      a.el.classList.toggle('focus', this.focused(p, a.box));
      this.placeTag(a, left, top, bw, bh, W, H);
    }
    if (this.picker) this.place();
  }

  /**
   * A box's name tag: above it, else inside its top left when it is tall
   * enough, else under it; then moved whole into the stage (W x H).
   */
  placeTag(a, left, top, bw, bh, W, H) {
    if (!a.tagW) {
      a.tagW = Math.min(TAG_MAX, a.tag.offsetWidth);
      a.tagH = a.tag.offsetHeight;
      a.tag.style.width = `${a.tagW}px`;
    }
    const tw = Math.min(a.tagW, W), th = a.tagH;
    let tx = left, ty = top - th - 2;
    if (ty < 0) {
      if (bh >= th + 4) { tx = left + 2; ty = top + 2; } else ty = top + bh + 2;
    }
    tx = Math.min(Math.max(0, tx), W - tw);
    ty = Math.min(Math.max(0, ty), H - th);
    Object.assign(a.tag.style, { left: `${tx}px`, top: `${ty}px`, width: `${tw}px` });
  }

  hide() {
    if (this.picker) this.close({ redraw: false });
    if (!this.layer.classList.contains('hidden')) this.layer.classList.add('hidden');
    if (this.items.length) { this.items = []; this.layer.replaceChildren(); }
    this.key = '';
  }

  /**
   * The names already in photo p or its burst, but the one on box a: [{ label, where }],
   * what she or the identifier shows for this photo first, then hers on the burst's other frames.
   */
  siblingNames(p, a) {
    const f = this.feature;
    const out = [];
    const keyOf = (l) => `${l.scientific || l.common || ''}`.toLowerCase();
    // The box's own name is not a sibling's.
    const seen = new Set(a.label ? [keyOf(a.label)] : []);
    const add = (l, where) => {
      const k = keyOf(l);
      if (!k || seen.has(k) || out.length >= SIBLINGS_MAX) return;
      seen.add(k);
      out.push({ label: l, where });
    };
    for (const l of f.answerOf(p).labels) {
      if ((l.boxes || []).some((b) => sameBox(b, a.box))) continue;
      add(l, l.from === 'burst' && !(l.boxes || []).length ? 'in the burst' : 'in this photo');
    }
    const b = f.editor.burstOf(p);
    for (const q of b ? b.photos : []) {
      if (pathKey(q) === pathKey(p)) continue;
      for (const l of f.answerOf(q).labels) add(l, 'in the burst');
    }
    return out;
  }

  /** The chips of a crop's picker: [{ text, detail, animal, kind }]. */
  chips(p, a) {
    const f = this.feature;
    const out = [];
    const seen = new Set();
    const add = (text, detail, animal, kind) => {
      const k = (animal.scientific || animal.name || '').toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ text, detail, animal, kind });
    };
    if (a.label && !a.label.mine) add(labelText(a.label), 'sure', animalOf({ ...a.label, boxes: [] }), 'sure');
    for (const s of this.siblingNames(p, a)) add(labelText(s.label), s.where, animalOf({ ...s.label, boxes: [], count: 0 }), 'here');
    for (const s of suggestionsOf(a.crop, 3)) {
      add(s.common || s.scientific, percentText(s.score), { name: s.common || s.scientific, scientific: s.scientific, rank: 'species' }, 'guess');
    }
    const look = f.lookalike(p, a.i);
    if (look) {
      out.push({ text: `Looks like your ${labelText(look.label)}`, detail: `from ${look.when}`,
        animal: animalOf({ ...look.label, boxes: [], count: 0 }), kind: 'lookalike' });
    }
    return out;
  }

  /** The picker for the animal in `box` of photo `path` (the photo on screen), its box shown. */
  openBox(path, box) {
    if (!this.shown() || pathKey(this.viewer.pic.path) !== pathKey(path)) return false;
    const a = this.animals(path).find((x) => sameBox(x.box, box));
    if (!a) return false;
    this.opening = a.i;
    try {
      this.draw();
      return this.open(a.i);
    } finally {
      this.opening = null;
    }
  }

  /** The picker for record.animals[i] of the photo on screen (its box shown). */
  open(i) {
    const a = this.items.find((x) => x.i === i);
    if (!a) return false;
    this.close({ redraw: false });
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
    }, c.kind === 'lookalike' ? icon('user', 'sm') : null, h('span.iv-chip-text.ellipsis', c.text),
      c.detail ? h('span.iv-chip-detail', c.detail) : null));
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

  /** Close the picker; its box goes with it unless it shows anyway (`redraw`: draw now). */
  close({ redraw = true } = {}) {
    const pk = this.picker;
    if (!pk) return;
    this.picker = null;
    pk.cb.destroy();
    pk.el.remove();
    pk.item.el.classList.remove('picking');
    if (redraw) this.draw();
  }

  state() {
    return {
      path: this.path,
      boxes: this.items.map((a) => ({ i: a.i, kind: a.kind, name: a.name })),
      picker: this.picker ? { i: this.picker.i, chips: this.picker.chips.map((c) => ({ text: c.text, detail: c.detail, kind: c.kind })) } : null,
    };
  }
}
