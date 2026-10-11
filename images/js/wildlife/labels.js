/**
 * What Find Animals shows on a photo: a quiet tag on its grid tile (the
 * burst's species and how sure, and on a burst's first frame how many
 * frames it has), and a section in the details panel (the burst's
 * consensus, this frame's own top species with scores, what the detector
 * found, sharpness).
 *
 * A tile shows only its item's fields (lib/list.js): feature.js puts
 * `tag`, `conf` and `burst` on the item.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { formatPercent, formatNumber } from '/lib/format.js';
import { section } from '../details.js';

const path = require('path');

/** Put an item's tag on a grid tile (or take it off). */
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
    parts.push(h('span.iv-tag', { title: `${item.tag} · ${item.conf}%` },
      h('span.iv-tag-name.ellipsis', item.tag), h('span.iv-tag-conf.num', `${item.conf}%`)));
  }
  if (item.burst) parts.push(h('span.iv-tag.iv-tag-burst.num', { title: `A burst of ${item.burst} photos` }, icon('layers', 'sm'), String(item.burst)));
  el._tags.replaceChildren(...parts);
}

const pct = (x) => formatPercent(x, x >= 0.995 || x < 0.1 ? 1 : 0);
const sharpText = (s) => (s ? formatNumber(Math.round(s.tenengrad)) : '');

/**
 * The details panel's section for a photo: `rec` its record (or null while
 * it waits), `burst` the burst holding it, `pending` whether it is still to
 * be looked at.
 */
export function detailsSection(rec, burst, { pending = false } = {}) {
  if (!rec) return pending ? section('Animals', [['Status', 'Not looked at yet']]) : null;
  if (rec.error) return section('Animals', [['Status', `Could not be read (${rec.error})`]]);
  const parts = [];
  if (burst && (burst.count > 1 || burst.species)) {
    const s = burst.species;
    parts.push(section(burst.count > 1 ? 'Burst' : 'Animal', [
      ['Species', s ? `${s.common} · ${pct(s.share)}` : 'No animal'],
      ['Scientific name', s ? s.scientific : ''],
      ['Agreement', s && burst.count > 1 ? `${s.agree} of ${burst.animalCount} frames with an animal name it first` : ''],
      ['Photos', burst.count > 1 ? `${burst.count} over ${burst.durationS.toFixed(1)} s` : ''],
      ['Sharpest frame', burst.count > 1 ? (burst.keeper === rec.path ? 'This one' : path.basename(burst.keeper)) : ''],
    ]));
  }
  const own = [];
  if (!rec.animal) own.push(['Animal', 'None found']);
  rec.species.forEach((s, i) => own.push([i === 0 ? 'Species' : `${i + 1}.`, `${s.common} · ${pct(s.score)}`]));
  if (rec.detections.length) {
    own.push(['Found', rec.detections.map((d) => `${d.label.replace(/^an? /, '')} ${d.score.toFixed(2)}`).join(', ')]);
  }
  own.push(['Sharpness', [sharpText(rec.sharpness.subject) && `subject ${sharpText(rec.sharpness.subject)}`,
    sharpText(rec.sharpness.frame) && `frame ${sharpText(rec.sharpness.frame)}`].filter(Boolean).join(', ')]);
  parts.push(section('This photo', own));
  return h('div.iv-details-group', ...parts);
}
