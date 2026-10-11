/**
 * What Find Animals shows on a photo: a quiet tag on its grid tile (its top
 * label and how sure, "+N" when it has more, and on a burst's first frame
 * how many frames it has), and a section in the details panel (every animal
 * of the burst and of this photo, the unidentified ones with their guesses,
 * what the detector found, sharpness).
 *
 * Every name is bro.vision.wildlife.labels()': an animal is named at the
 * narrowest rank it is sure of (0.85 or more: a species, else its genus,
 * family, order or class, "Darners (Aeshnidae)"); one that clears no rank
 * is "Not identified", its guesses muted under it.
 *
 * An animal of the details with boxes in this photo is an `.iv-animal-hit`:
 * isolate.js darkens the rest of the photo while the pointer is on it, and
 * a click zooms the view to it (el._animal: { path, boxes, size }).
 *
 * A tile shows only its item's fields (lib/list.js): feature.js puts
 * `tag`, `conf`, `more`, `names` and `burst` on the item.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { formatPercent, formatNumber } from '/lib/format.js';
import { section } from '../details.js';

const path = require('path');

/** A label's key: the filter and the counts tell taxa apart by rank and scientific name. */
export const labelKey = (l) => `${l.rank}:${l.scientific}`;

/** A label's text: "Mallard", "Darners (Aeshnidae)". */
export const labelText = (l) => bro.vision.wildlife.formatLabel(l);

/** Put an item's tags on a grid tile (or take them off). */
export function decorateTile(item, el) {
  const show = !!(item.tag || item.burst);
  if (!show) {
    if (el._tags) el._tags.classList.add('hidden');
    return;
  }
  if (!el._tags) {
    el._tags = h('div.iv-tags');
    el.append(el._tags);
  }
  el._tags.classList.remove('hidden');
  const parts = [];
  if (item.tag) {
    parts.push(h('span.iv-tag', { title: item.names || `${item.tag} · ${item.conf}%` },
      h('span.iv-tag-name.ellipsis', item.tag), h('span.iv-tag-conf.num', `${item.conf}%`)));
    if (item.more) parts.push(h('span.iv-tag.iv-tag-more.num', { title: item.names }, `+${item.more}`));
  }
  if (item.burst) parts.push(h('span.iv-tag.iv-tag-burst.num', { title: `A burst of ${item.burst} photos` }, icon('layers', 'sm'), String(item.burst)));
  el._tags.replaceChildren(...parts);
}

const pct = (x) => formatPercent(x, x >= 0.995 || x < 0.1 ? 1 : 0);
const sharpText = (s) => (s ? formatNumber(Math.round(s.tenengrad)) : '');
const RANK_NAMES = { species: 'Species', genus: 'Genus', family: 'Family', order: 'Order', class: 'Class' };

/** 'a bird' -> 'birds', 'a fox' -> 'foxes', 'a deer' -> 'deer', 'a butterfly' -> 'butterflies'. */
export function plural(query, n) {
  const one = String(query || 'animal').replace(/^an? /, '');
  if (n === 1) return one;
  if (one === 'deer') return one;
  if (/[^aeiou]y$/.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(x|s|ch|sh)$/.test(one)) return `${one}es`;
  return `${one}s`;
}

/** A record's crops: its `animals`, or a record from before them, its top K on the best box. */
export function cropsOf(rec) {
  if (!rec || rec.error || !rec.animal) return [];
  if (Array.isArray(rec.animals)) return rec.animals.filter((a) => a && a.species && a.species.length);
  const d = rec.detections && rec.detections[0];
  return rec.species && rec.species.length ? [{ box: d ? d.box : null, label: d ? d.label : '', species: rec.species }] : [];
}

/** The boxes over the threshold not classified, by query: "+3 more birds". */
export function droppedText(rec) {
  const n = rec && rec.animalsDropped;
  if (!n) return '';
  const kept = new Set((rec.animals || []).map((a) => JSON.stringify(a.box)));
  const rest = (rec.detections || []).filter((d) => !kept.has(JSON.stringify(d.box)));
  const queries = new Set(rest.map((d) => d.label));
  const what = rest.length === n && queries.size === 1 ? plural([...queries][0], n) : n === 1 ? 'animal' : 'animals';
  return `+${formatNumber(n)} more ${what}`;
}

/**
 * One animal of the details: its name and score, a muted line under it
 * (rank and scientific name, frames of the burst), hoverable and clickable
 * when it has boxes in the photo on screen.
 */
function animalItem({ name, score = null, meta = '', guess = '', boxes = [], target = null, dim = false }) {
  const hit = !!(target && boxes.length);
  const el = h(`div.iv-animal${hit ? '.iv-animal-hit' : ''}${dim ? '.dim' : ''}`,
    h('div.iv-animal-row', h('span.iv-animal-name.ellipsis', name), score != null ? h('span.iv-animal-score.num', pct(score)) : null),
    meta ? h('div.iv-animal-meta.num', meta) : null,
    guess ? h('div.iv-animal-guess.num', guess) : null);
  el.title = [name, meta, guess].filter(Boolean).join(' · ');
  if (hit) {
    el._animal = { path: target.path, size: target.size, boxes };
    el.dataset.animal = `${target.path}|${JSON.stringify(boxes)}`;
  }
  return el;
}

/** A titled section of animals, then label / value rows (details.js section()'s). */
function animalSection(title, animals, rows) {
  const s = section(title, rows);
  const head = s.firstChild;
  if (animals.length) head.after(h('div.iv-animals-list', ...animals));
  return s;
}

/**
 * The details panel's sections for a photo: `rec` its record (or null while
 * it waits), `burst` the burst holding it, `pending` whether it is still to
 * be looked at, `taxa` the lists' names of genera and up, `target` the
 * photo on screen ({ path, size: [w, h] of its record }) or null when its
 * animals cannot be isolated (the grid).
 */
export function detailsSection(rec, burst, { pending = false, taxa = {}, target = null } = {}) {
  if (!rec) return pending ? section('Animals', [['Status', 'Not looked at yet']]) : null;
  if (rec.error) return section('Animals', [['Status', `Could not be read (${rec.error})`]]);
  const wl = bro.vision.wildlife;
  const opts = { taxa };
  const parts = [];
  const meta = (l, extra) => [l.rank === 'species' ? l.scientific : RANK_NAMES[l.rank], ...extra].filter(Boolean).join(' · ');
  if (burst && burst.count > 1) {
    const shown = wl.labels(rec, burst, opts);
    const fromBurst = shown.length && shown[0].from === 'burst' ? shown : [];
    const items = fromBurst.map((l) => animalItem({
      name: labelText(l), score: l.score, boxes: l.boxes, target,
      meta: meta(l, [l.frames ? `${l.frames} of ${burst.count} frames` : '',
        l.boxes.length ? (l.boxes.length > 1 ? `${l.boxes.length} here` : '') : 'not in this photo']),
    }));
    const s = burst.species;
    if (!items.length && burst.animalCount > 0) {
      items.push(animalItem({ name: 'Not identified', guess: s ? `Possibly ${s.common} ${pct(s.share)}` : '' }));
    }
    parts.push(animalSection('Burst', items, [
      ['Animals', burst.animalCount ? '' : 'None found'],
      ['Photos', `${burst.count} over ${burst.durationS.toFixed(1)} s`],
      ['Sharpest frame', burst.keeper === rec.path ? 'This one' : path.basename(burst.keeper)],
    ]));
  }
  // This photo's own: every label, then each crop no rank is sure of.
  const own = wl.labels(rec, null, opts).map((l) => animalItem({
    name: labelText(l), score: l.score, boxes: l.boxes, target,
    meta: meta(l, [l.boxes.length > 1 ? `${l.boxes.length} here` : '']),
  }));
  for (const crop of cropsOf(rec)) {
    if (wl.labels({ animal: true, animals: [crop] }, null, opts).length) continue;
    own.push(animalItem({
      name: 'Not identified', boxes: crop.box ? [crop.box] : [], target,
      meta: crop.label ? crop.label.replace(/^an? /, '') : '',
      guess: `Possibly ${crop.species.map((sp) => `${sp.common} ${pct(sp.score)}`).join(', ')}`,
    }));
  }
  const dropped = droppedText(rec);
  if (dropped) own.push(animalItem({ name: dropped, dim: true }));
  const rows = [];
  if (!rec.animal) rows.push(['Animals', 'None found']);
  if (rec.detections.length) {
    rows.push(['Found', rec.detections.map((d) => `${d.label.replace(/^an? /, '')} ${d.score.toFixed(2)}`).join(', ')]);
  }
  rows.push(['Sharpness', [sharpText(rec.sharpness.subject) && `subject ${sharpText(rec.sharpness.subject)}`,
    sharpText(rec.sharpness.frame) && `frame ${sharpText(rec.sharpness.frame)}`].filter(Boolean).join(', ')]);
  parts.push(animalSection(parts.length ? 'This photo' : 'Animals', own, rows));
  return h('div.iv-details-group', ...parts);
}
