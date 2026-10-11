/**
 * The stabilize view's side panel: what is held still, the crop's shape,
 * the selected frames, and the export, with the summary and the Export
 * button pinned at its foot. Each setting is a label over a full-width
 * control with its note under it, so nothing is squeezed beside a control.
 * Kit controls; every change goes to `on.<what>(value)`, and update(model)
 * puts the model's values back without firing them.
 *
 *   const panel = new BurstPanel({ on: { lock, aspect, format, size, export, reseed, remove, asShot } });
 *   panel.update({ lock, aspect, format, size, outText, summary, modelText, inspector });
 *   panel.setProgress(0.4, 'Rendering 3 of 8');
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Segmented, Select, Progress } from '/lib/controls.js';
import { ASPECTS } from './stabilize.js';

export const SIZE_CHOICES = [360, 480, 720, 1080, 1440];

function field(label, control, note) {
  return h('div.iv-bp-field',
    label ? h('div.iv-bp-label', label) : null,
    control,
    note ? h('div.iv-bp-note', note) : null);
}

function section(title, ...children) {
  const head = typeof title === 'string' ? h('div.iv-bp-head', h('span.micro', title)) : title;
  return h('section.iv-bp-sec', head, ...children);
}

export class BurstPanel {
  constructor({ on }) {
    this.on = on;
    this.lock = new Segmented({
      options: [{ value: 'subject', label: 'Subject', title: 'Hold the subject still' },
                { value: 'scene', label: 'Scene', title: 'Hold the scene still; the subject moves in it' }],
      value: 'subject', onChange: (v) => on.lock(v),
    });
    this.aspect = new Segmented({
      options: ASPECTS.map((a) => ({ value: a.value, label: a.label })),
      value: '1:1', onChange: (v) => on.aspect(v),
    });
    this.format = new Segmented({ options: [{ value: 'gif', label: 'GIF' }, { value: 'webm', label: 'WebM' }],
      value: 'gif', onChange: (v) => on.format(v) });
    this.size = new Select({ options: SIZE_CHOICES.map((s) => ({ value: s, label: `${s} px` })), value: 720, onChange: (v) => on.size(v) });
    for (const c of [this.lock, this.aspect, this.format]) c.el.classList.add('iv-bp-fill');
    this.size.el.classList.add('iv-bp-fill');

    // The selected frames.
    this.inspTitle = h('span.micro');
    this.inspSub = h('span.iv-bp-sub.ellipsis');
    this.props = h('div.iv-bp-props');
    this.calloutText = h('div.iv-bp-callout-text');
    this.reseedBtn = h('button.btn.small', { onclick: () => on.reseed() }, 'Click the subject', h('span.kbd', 'C'));
    this.callout = h('div.iv-bp-callout.hidden', icon('alert'), h('div.iv-bp-callout-body', this.calloutText, this.reseedBtn));
    this.asShotBtn = h('button.btn.ghost.small', { onclick: () => on.asShot() }, icon('undo'), 'Hold as shot');
    this.removeBtn = h('button.btn.ghost.small', { onclick: () => on.remove() }, icon('trash'), h('span'), h('span.kbd', 'Del'));
    this.actions = h('div.iv-bp-actions', this.removeBtn, this.asShotBtn);
    this.inspector = section(h('div.iv-bp-head', this.inspTitle, this.inspSub), this.props, this.callout, this.actions);
    this.inspector.classList.add('iv-bp-frames');

    this.outEl = h('span.num');
    this.summary = h('div.iv-bp-summary.num');
    this.modelEl = h('div.iv-bp-model');
    this.progress = new Progress(0);
    this.progressRow = h('div.iv-burst-progress.hidden', this.progress.el, h('span.num.iv-burst-progress-text'));
    this.progressText = this.progressRow.lastChild;
    this.exportButton = h('button.btn.primary.iv-burst-export', { onclick: () => on.export() }, icon('download'), 'Export…');

    this.el = h('div.iv-burst-panel',
      h('div.iv-bp-body',
        section('Hold still', field(null, this.lock.el, 'Subject keeps the bird in place; Scene keeps the background still and lets the bird move.')),
        section('Crop', field(null, this.aspect.el, 'Drag the frame on the photo to move it, its corners to size it.')),
        this.inspector,
        section('Export',
          field('Format', this.format.el),
          field('Size', this.size.el, h('span', 'Output ', this.outEl)))),
      h('div.iv-bp-foot', this.summary, this.progressRow, this.exportButton, this.modelEl));
  }

  update(m) {
    this.lock.set(m.lock);
    this.aspect.set(m.aspect);
    this.format.set(m.format);
    this.size.set(m.size);
    this.outEl.textContent = m.outText || '–';
    this.summary.textContent = m.summary || '';
    this.modelEl.textContent = m.modelText || '';
    this.modelEl.classList.toggle('hidden', !m.modelText);
    this.showInspector(m.inspector);
  }

  /**
   * i: { title, sub, rows: [[key, value, kind?]], flagged: { text } | null,
   *      custom, count } or null (no frame).
   */
  showInspector(i) {
    this.inspector.classList.toggle('hidden', !i);
    if (!i) return;
    this.inspTitle.textContent = i.title;
    this.inspSub.textContent = i.sub || '';
    this.props.replaceChildren(...i.rows.map(([k, v, kind]) => h('div.iv-bp-prop',
      h('span.iv-bp-key', k),
      kind ? h(`span.badge.${kind}.iv-bp-val`, v) : h('span.iv-bp-val.num', v))));
    this.callout.classList.toggle('hidden', !i.flagged);
    if (i.flagged) this.calloutText.textContent = i.flagged.text;
    this.reseedBtn.classList.toggle('hidden', !i.flagged || !i.flagged.canReseed);
    this.asShotBtn.classList.toggle('hidden', !i.custom);
    this.removeBtn.children[1].textContent = i.count > 1 ? `Remove ${i.count} frames` : 'Remove frame';
  }

  setExportEnabled(on) { this.exportButton.disabled = !on; }

  /** p: 0..1, null (indeterminate) or undefined (hidden). */
  setProgress(p, text = '') {
    this.progressRow.classList.toggle('hidden', p === undefined);
    if (p !== undefined) this.progress.set(p);
    this.progressText.textContent = text;
  }
}
