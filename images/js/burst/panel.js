/**
 * The stabilize view's side panel: what is held still, the crop's shape,
 * the timing, the current frame's own settings, and the export. Kit
 * controls in kit groups; every change goes to `on.<what>(value)`, and
 * update(model) puts the model's values back without firing them.
 *
 *   const panel = new BurstPanel({ on: { lock, aspect, hold, speed, include, frameHold, format, size } });
 *   panel.update({ lock, aspect, hold, speed, frame, times, format, size, ... });
 */

import { h } from '/lib/dom.js';
import { Segmented, Select, Checkbox, Progress } from '/lib/controls.js';
import { ASPECTS } from './stabilize.js';

export const HOLD_CHOICES = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1];
export const SPEED_CHOICES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
export const FRAME_HOLD_CHOICES = [null, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2];
export const SIZE_CHOICES = [360, 480, 720, 1080, 1440];

const seconds = (s) => (s === 0 ? 'None' : `${s < 1 ? s.toFixed(2).replace(/0$/, '') : s.toFixed(1).replace(/\.0$/, '')} s`);
const times = (x) => `${String(x).replace(/^0\./, '0.')}×`;

function row(label, hint, control) {
  return h('div.form-row', h('div.form-label', h('span', label), hint ? h('span.dim', hint) : null),
    h('div.form-control', control));
}

function group(title, ...rows) {
  return h('div.group', h('div.micro', title), h('div.group-rows', ...rows));
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
    this.hold = new Select({ options: HOLD_CHOICES.map((s) => ({ value: s, label: seconds(s) })), value: 0.1, onChange: (v) => on.hold(v) });
    this.speed = new Select({ options: SPEED_CHOICES.map((s) => ({ value: s, label: times(s) })), value: 1, onChange: (v) => on.speed(v) });
    this.include = new Checkbox({ on: true, label: 'Include', onChange: (v) => on.include(v) });
    this.frameHold = new Select({ options: FRAME_HOLD_CHOICES.map((s) => ({ value: s, label: s == null ? 'As shot' : seconds(s) })),
      value: null, onChange: (v) => on.frameHold(v) });
    this.format = new Segmented({ options: [{ value: 'gif', label: 'GIF' }, { value: 'webm', label: 'WebM' }],
      value: 'gif', onChange: (v) => on.format(v) });
    this.size = new Select({ options: SIZE_CHOICES.map((s) => ({ value: s, label: `${s} px` })), value: 720, onChange: (v) => on.size(v) });

    this.frameTitle = h('div.micro');
    this.frameNote = h('span.dim');
    this.timesEl = h('div.iv-burst-times.num');
    this.outEl = h('span.dim.num');
    this.modelEl = h('div.iv-burst-model.dim');
    this.progress = new Progress(0);
    this.progressRow = h('div.iv-burst-progress.hidden', this.progress.el, h('span.dim.num.iv-burst-progress-text'));
    this.progressText = this.progressRow.lastChild;

    this.el = h('div.iv-burst-panel',
      group('Hold still', row('Lock', 'Subject: the bird stays put. Scene: the water does.', this.lock.el)),
      group('Crop', row('Shape', 'Drag the frame to move it, its corners to size it', this.aspect.el)),
      group('Timing',
        row('Gaps between bursts', 'Trimmed to this', this.hold.el),
        row('Speed', null, this.speed.el)),
      h('div.group', this.frameTitle, h('div.group-rows',
        row('In the animation', this.frameNote, this.include.el),
        row('Hold', 'Overrides its time and the speed', this.frameHold.el))),
      group('Export',
        row('Format', null, this.format.el),
        row('Size', this.outEl, this.size.el)),
      this.timesEl,
      this.progressRow,
      this.modelEl);
  }

  update(m) {
    this.lock.set(m.lock);
    this.aspect.set(m.aspect);
    this.hold.set(m.hold);
    this.speed.set(m.speed);
    this.format.set(m.format);
    this.size.set(m.size);
    const f = m.frame;
    this.frameTitle.textContent = f ? `Frame ${m.frameIndex + 1} · ${f.name}` : 'Frame';
    this.include.set(f ? f.included : false);
    this.frameHold.set(f ? f.hold : null);
    this.frameNote.textContent = f && f.status === 'lost' ? 'Click the subject in this frame' : '';
    this.timesEl.textContent = m.timesText || '';
    this.outEl.textContent = m.outText || '';
    this.modelEl.textContent = m.modelText || '';
  }

  /** p: 0..1, null (indeterminate) or undefined (hidden). */
  setProgress(p, text = '') {
    this.progressRow.classList.toggle('hidden', p === undefined);
    if (p !== undefined) this.progress.set(p);
    this.progressText.textContent = text;
  }
}
