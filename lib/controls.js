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

const DEFAULT_SWATCH_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1',
  '#a855f7', '#ec4899', '#f8fafc', '#18181b',
];

function normalizeHex(input, fallback = '#3b82f6') {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(String(input || '').trim());
  if (!m) return fallback;
  const raw = m[1].toLowerCase();
  const hex = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return `#${hex}`;
}

function hexToHsv(hex) {
  const c = normalizeHex(hex).slice(1);
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h: Math.round(h), s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h, s, v) {
  const H = (((Number(h) || 0) % 360) + 360) % 360;
  const S = clamp(Number(s) || 0, 0, 1);
  const V = clamp(Number(v) || 0, 0, 1);
  const c = V * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = V - c;
  let r = 0, g = 0, b = 0;
  if (H < 60) [r, g, b] = [c, x, 0];
  else if (H < 120) [r, g, b] = [x, c, 0];
  else if (H < 180) [r, g, b] = [0, c, x];
  else if (H < 240) [r, g, b] = [0, x, c];
  else if (H < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex2 = (n) => Math.round(clamp((n + m) * 255, 0, 255)).toString(16).padStart(2, '0');
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/**
 * A compact color swatch button that opens a popover with preset swatches,
 * Hue/Saturation/Brightness sliders, and a HEX field.
 */
export class ColorSwatch {
  constructor({ value = '#3b82f6', presets = DEFAULT_SWATCH_PRESETS, showHex = false, title = 'Choose color', onInput, onChange } = {}) {
    this.presets = presets;
    this.onInput = onInput;
    this.onChange = onChange;
    this.popover = null;
    this.cleanup = null;
    this.chip = h('span.color-swatch-chip');
    this.labelEl = showHex ? h('span.mono', '') : null;
    this.el = h('button.color-swatch', { title, 'aria-label': title }, this.chip, this.labelEl);
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.popover) this.close(); else this.open();
    });
    this.set(value);
  }

  get isOpen() {
    return !!this.popover;
  }

  set(v) {
    this.value = normalizeHex(v, this.value || '#3b82f6');
    this.hsv = hexToHsv(this.value);
    this.chip.style.background = this.value;
    if (this.labelEl) this.labelEl.textContent = this.value;
    this.syncPopover();
  }

  setDisabled(d) {
    this.el.disabled = !!d;
    if (d && this.popover) this.close();
  }

  emit(commit = true) {
    if (this.onInput) this.onInput(this.value);
    if (commit && this.onChange) this.onChange(this.value);
  }

  syncPopover() {
    if (!this.popover) return;
    if (this.hexField && document.activeElement !== this.hexField) {
      this.hexField.value = this.value;
    }
    if (this.hueSlider && !this.hueSlider.dragging) this.hueSlider.set(this.hsv.h);
    if (this.satSlider && !this.satSlider.dragging) this.satSlider.set(Math.round(this.hsv.s * 100));
    if (this.valSlider && !this.valSlider.dragging) this.valSlider.set(Math.round(this.hsv.v * 100));
    for (const [hex, btn] of this.presetBtns) {
      btn.classList.toggle('active', hex === this.value);
    }
  }

  open() {
    if (this.popover || this.el.disabled) return;
    this.presetBtns = new Map();
    const grid = h('div.color-popover-presets', ...this.presets.map((p) => {
      const hex = normalizeHex(p);
      const b = h('button.color-popover-preset', {
        title: hex,
        'aria-label': hex,
        style: { background: hex },
        onclick: () => {
          this.set(hex);
          this.emit(true);
        },
      });
      this.presetBtns.set(hex, b);
      return b;
    }));

    const updateFromHsv = (commit) => {
      this.value = hsvToHex(this.hsv.h, this.hsv.s, this.hsv.v);
      this.chip.style.background = this.value;
      if (this.labelEl) this.labelEl.textContent = this.value;
      this.syncPopover();
      this.emit(commit);
    };

    this.hueSlider = new Slider({
      min: 0, max: 360, step: 1, value: this.hsv.h,
      onInput: (hDeg) => { this.hsv.h = hDeg; updateFromHsv(false); },
      onChange: (hDeg) => { this.hsv.h = hDeg; updateFromHsv(true); },
    });
    this.satSlider = new Slider({
      min: 0, max: 100, step: 1, value: Math.round(this.hsv.s * 100),
      onInput: (sPct) => { this.hsv.s = sPct / 100; updateFromHsv(false); },
      onChange: (sPct) => { this.hsv.s = sPct / 100; updateFromHsv(true); },
    });
    this.valSlider = new Slider({
      min: 0, max: 100, step: 1, value: Math.round(this.hsv.v * 100),
      onInput: (vPct) => { this.hsv.v = vPct / 100; updateFromHsv(false); },
      onChange: (vPct) => { this.hsv.v = vPct / 100; updateFromHsv(true); },
    });

    this.hexField = h('input.field.mono.color-popover-input', {
      type: 'text',
      value: this.value,
      'aria-label': 'HEX color',
    });
    const applyHex = () => {
      const next = normalizeHex(this.hexField.value, '');
      if (next) {
        this.set(next);
        this.emit(true);
      } else {
        this.hexField.value = this.value;
      }
    };
    this.hexField.addEventListener('change', applyHex);
    this.hexField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyHex(); this.close(); }
    });

    this.popover = h('div.popover.color-popover', { role: 'dialog', 'aria-label': 'Color picker' },
      grid,
      h('div.color-popover-sliders',
        h('div.color-popover-row', h('span.micro', 'H'), this.hueSlider.el),
        h('div.color-popover-row', h('span.micro', 'S'), this.satSlider.el),
        h('div.color-popover-row', h('span.micro', 'V'), this.valSlider.el),
      ),
      this.hexField,
    );
    document.body.appendChild(this.popover);
    this.syncPopover();

    const r = this.el.getBoundingClientRect();
    const pr = this.popover.getBoundingClientRect();
    const left = clamp(r.left, 8, Math.max(8, window.innerWidth - (pr.width || 216) - 8));
    const top = r.bottom + 6 + (pr.height || 180) <= window.innerHeight
      ? r.bottom + 6
      : Math.max(8, r.top - (pr.height || 180) - 6);
    this.popover.style.left = `${Math.round(left)}px`;
    this.popover.style.top = `${Math.round(top)}px`;

    const onDown = (e) => {
      if (this.popover && !this.popover.contains(e.target) && !this.el.contains(e.target)) {
        this.close();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    this.cleanup = () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }

  close() {
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    if (this.popover) { this.popover.remove(); this.popover = null; }
  }
}

export const ColorPopover = ColorSwatch;

export function colorInput(opts) {
  return new ColorSwatch(opts);
}
