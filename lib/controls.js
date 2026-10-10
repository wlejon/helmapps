/**
 * Controls built from divs, so they look the same everywhere: Switch,
 * Checkbox, Slider, Segmented, Select. Each has .el to place, .value (or
 * .on) to read, set() to change it without firing onChange, and fires
 * onChange(value) when the user changes it.
 *
 *   import { Switch, Slider, Segmented, Select } from '/lib/controls.js';
 *   const hidden = new Switch({ on: settings.get('showHidden'), onChange: (on) => settings.set('showHidden', on) });
 *   const zoom = new Slider({ min: 32, max: 256, step: 16, value: 64, onChange: setIconSize });
 *   const view = new Segmented({ options: [{ value: 'grid', icon: 'grid', title: 'Icons' },
 *                                          { value: 'list', icon: 'list', title: 'List' }],
 *                                value: 'grid', onChange: setView });
 *   const sortBy = new Select({ options: [{ value: 'name', label: 'Name' }, { value: 'size', label: 'Size' }],
 *                               value: 'name', onChange: setSort });
 *
 * A plain <input type="text" class="field"> is the text field; there is no
 * wrapper for it.
 */

import { h, clamp } from './dom.js';
import { icon } from './icons.js';
import { menu } from './menu.js';

export class Switch {
  constructor({ on = false, onChange, label } = {}) {
    this.on = !!on;
    this.onChange = onChange;
    this.el = h('button.switch', { role: 'switch', title: label || null }, h('span.switch-knob'));
    this.el.classList.toggle('on', this.on);
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.set(!this.on);
      if (this.onChange) this.onChange(this.on);
    });
  }

  get value() { return this.on; }

  set(on) {
    this.on = !!on;
    this.el.classList.toggle('on', this.on);
    this.el.setAttribute('aria-checked', String(this.on));
  }

  setDisabled(d) { this.el.disabled = !!d; }
}

export class Checkbox {
  constructor({ on = false, label = '', onChange } = {}) {
    this.on = !!on;
    this.onChange = onChange;
    this.box = h('span.checkbox-box', icon('check'));
    this.el = h('button.checkbox', { role: 'checkbox' }, this.box, label ? h('span', label) : null);
    this.el.classList.toggle('on', this.on);
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.set(!this.on);
      if (this.onChange) this.onChange(this.on);
    });
  }

  get value() { return this.on; }

  set(on) {
    this.on = !!on;
    this.el.classList.toggle('on', this.on);
    this.el.setAttribute('aria-checked', String(this.on));
  }

  setDisabled(d) { this.el.disabled = !!d; }
}

export class Slider {
  /**
   * onInput(v) fires while dragging, onChange(v) once on release (and on a
   * click, a wheel step or a key).
   */
  constructor({ min = 0, max = 1, step = 0, value = 0, onInput, onChange } = {}) {
    this.min = min;
    this.max = max;
    this.step = step;
    this.onInput = onInput;
    this.onChange = onChange;
    this.value = value;
    this.dragging = false;
    this.fill = h('div.slider-fill');
    this.knob = h('div.slider-knob');
    this.el = h('div.slider', { role: 'slider', tabindex: '0' }, h('div.slider-track'), this.fill, this.knob);

    this.el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      if (this.el.setPointerCapture) this.el.setPointerCapture(e.pointerId);
      this.fromPointer(e);
      e.preventDefault();
    });
    this.el.addEventListener('pointermove', (e) => { if (this.dragging) this.fromPointer(e); });
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.el.releasePointerCapture) this.el.releasePointerCapture(e.pointerId);
      if (this.onChange) this.onChange(this.value);
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.nudge(e.deltaY < 0 ? 1 : -1);
    });
    this.el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (d) { e.preventDefault(); this.nudge(d); }
    });
    requestAnimationFrame(() => this.draw());
  }

  nudge(dir) {
    const step = this.step || (this.max - this.min) / 20;
    this.set(this.value + dir * step);
    if (this.onInput) this.onInput(this.value);
    if (this.onChange) this.onChange(this.value);
  }

  fromPointer(e) {
    const r = this.el.getBoundingClientRect();
    if (r.width <= 0) return;
    const t = clamp((e.clientX - r.left) / r.width, 0, 1);
    this.set(this.min + t * (this.max - this.min));
    if (this.onInput) this.onInput(this.value);
  }

  set(v) {
    let x = clamp(Number(v), this.min, this.max);
    if (this.step) x = this.min + Math.round((x - this.min) / this.step) * this.step;
    this.value = clamp(x, this.min, this.max);
    this.draw();
  }

  draw() {
    const t = this.max > this.min ? (this.value - this.min) / (this.max - this.min) : 0;
    const pct = `${(t * 100).toFixed(2)}%`;
    this.fill.style.width = pct;
    this.knob.style.left = pct;
    this.el.setAttribute('aria-valuenow', String(this.value));
  }

  setDisabled(d) { this.el.classList.toggle('disabled', !!d); }
}

export class Segmented {
  /** options: [{ value, label?, icon?, title? }] */
  constructor({ options = [], value, onChange } = {}) {
    this.onChange = onChange;
    this.value = value;
    this.buttons = new Map();
    this.el = h('div.segmented', { role: 'radiogroup' });
    for (const opt of options) {
      const b = h('button', { title: opt.title || null, role: 'radio' },
        opt.icon ? icon(opt.icon) : null, opt.label ? h('span', opt.label) : null);
      b.addEventListener('click', () => {
        if (this.value === opt.value) return;
        this.set(opt.value);
        if (this.onChange) this.onChange(opt.value);
      });
      this.buttons.set(opt.value, b);
      this.el.appendChild(b);
    }
    this.set(value);
  }

  set(value) {
    this.value = value;
    for (const [v, b] of this.buttons) b.classList.toggle('on', v === value);
  }
}

export class Select {
  /** options: [{ value, label, icon? }] */
  constructor({ options = [], value, onChange, placeholder = '' } = {}) {
    this.options = options;
    this.onChange = onChange;
    this.placeholder = placeholder;
    this.labelEl = h('span.grow');
    this.el = h('button.select', { role: 'combobox' }, this.labelEl, icon('chevron-down'));
    this.el.addEventListener('click', () => this.open());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.open(); }
    });
    this.set(value);
  }

  open() {
    menu.showBelow(this.options.map((o) => ({
      label: o.label,
      icon: o.icon,
      checked: o.value === this.value,
      action: () => {
        if (o.value === this.value) return;
        this.set(o.value);
        if (this.onChange) this.onChange(o.value);
      },
    })), this.el);
  }

  setOptions(options) {
    this.options = options;
    this.set(this.value);
  }

  set(value) {
    this.value = value;
    const o = this.options.find((x) => x.value === value);
    this.labelEl.textContent = o ? o.label : this.placeholder;
  }

  setDisabled(d) { this.el.disabled = !!d; }
}

/** A determinate progress bar; set(null) makes it indeterminate. */
export class Progress {
  constructor(value = 0) {
    this.fill = h('div.progress-fill');
    this.el = h('div.progress', { role: 'progressbar' }, this.fill);
    this.set(value);
  }

  set(v) {
    const indeterminate = v == null;
    this.el.classList.toggle('indeterminate', indeterminate);
    if (!indeterminate) this.fill.style.width = `${(clamp(v, 0, 1) * 100).toFixed(1)}%`;
  }
}
