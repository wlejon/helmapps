/**
 * Harmonies, Tints & Shades Scale (50..950), and Saved Palettes View
 * for helm.colorpicker.
 *
 * Pre-allocates the 11 scale cells and 15 harmony swatch buttons once so
 * updating colors mutates styles/text in-place with zero DOM node churn.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { toast } from '/lib/toast.js';
import { generateHarmonies, generateScale } from './color-engine.js';

const HARMONY_META = [
  { key: 'complementary', label: 'Complementary (0°, 180°)', count: 2 },
  { key: 'analogous', label: 'Analogous (-30°, 0°, +30°)', count: 3 },
  { key: 'triadic', label: 'Triadic (0°, 120°, 240°)', count: 3 },
  { key: 'splitComplementary', label: 'Split-Complementary (0°, 150°, 210°)', count: 3 },
  { key: 'tetradic', label: 'Tetradic (0°, 90°, 180°, 270°)', count: 4 },
];

const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export class HarmoniesAndPalettesView {
  constructor({ settings, commands, onSelectColor, onCopyText } = {}) {
    this.settings = settings;
    this.commands = commands;
    this.onSelectColor = onSelectColor;
    this.onCopyText = onCopyText;
    this.currentColor = { r: 59, g: 130, b: 246, a: 255 };
    this.scale = [];
    this.harmonies = {};

    // Pre-allocate 11 scale cells
    this.scaleCells = SCALE_STEPS.map((step) => {
      const hexSpan = h('span.cp-scale-hex.mono', '#000000');
      const btn = h('button.cp-scale-cell', {
        dataset: { step: String(step), hex: '#000000' },
        onclick: () => this.onSelectColor && this.onSelectColor(btn.dataset.hex),
      },
      h('span.cp-scale-step.num', String(step)),
      hexSpan);
      return { btn, hexSpan };
    });

    this.scaleStrip = h('div.cp-scale-strip', ...this.scaleCells.map((c) => c.btn));

    // Pre-allocate harmony cards and buttons
    this.harmonySlots = new Map();
    const harmonyCards = HARMONY_META.map(({ key, label, count }) => {
      const slots = [];
      for (let i = 0; i < count; i++) {
        const chip = h('span.cp-swatch-chip.mono', '#000000');
        const btn = h('button.cp-swatch-btn', {
          dataset: { hex: '#000000' },
          onclick: () => this.onSelectColor && this.onSelectColor(btn.dataset.hex),
        }, chip);
        slots.push({ btn, chip });
      }
      this.harmonySlots.set(key, slots);
      return h('div.cp-palette-card',
        h('div.cp-card-head',
          h('span.micro', label.toUpperCase()),
          h('button.btn.ghost.small', {
            onclick: () => {
              const items = this.harmonies[key] || [];
              this.savePalette(label.split(' ')[0], items.map((x) => x.hex));
            },
          }, icon('plus'), 'Save Palette'),
        ),
        h('div.cp-swatch-row', ...slots.map((s) => s.btn)),
      );
    });

    this.harmoniesList = h('div.cp-palette-list', ...harmonyCards);
    this.palettesList = h('div.cp-palette-list');

    this.harmoniesSection = h('div.cp-layout',
      h('div.cp-card',
        h('div.cp-card-head',
          h('div',
            h('div.title', 'Tints & Shades Scale (50 – 950)'),
            h('div.dim', 'Perceptually uniform Oklch lightness ramp preserving hue'),
          ),
          h('div.cp-hero-actions',
            h('button.btn.small', {
              onclick: () => this.copyScaleCss(),
            }, icon('copy'), 'Copy CSS Variables'),
            h('button.btn.small', {
              onclick: () => this.savePalette('Scale ' + (this.scale[5] ? this.scale[5].hex : ''), this.scale.map((s) => s.hex)),
            }, icon('plus'), 'Save as Palette'),
          ),
        ),
        this.scaleStrip,
      ),
      h('div.cp-card',
        h('div.cp-card-head',
          h('span.title', 'Oklch Color Harmonies'),
          h('span.dim', 'Click any swatch to inspect it'),
        ),
        this.harmoniesList,
      ),
    );

    this.palettesSection = h('div.cp-layout',
      h('div.cp-card',
        h('div.cp-card-head',
          h('div',
            h('div.title', 'Saved Palettes'),
            h('div.dim', 'Persisted in bro.conf across launches'),
          ),
          h('div.cp-hero-actions',
            h('button.btn.small', {
              onclick: () => this.commands.run('add-to-palette'),
            }, icon('plus'), 'Add Current Color'),
            h('button.btn.primary.small', {
              onclick: () => this.commands.run('new-palette'),
            }, icon('folder-plus'), 'New Palette…'),
          ),
        ),
        this.palettesList,
      ),
    );

    this.updateColor(this.currentColor);
    this.renderPalettes();
  }

  updateColor(color) {
    this.currentColor = color;
    this.scale = generateScale(color);
    this.harmonies = generateHarmonies(color);
    this.renderScaleAndHarmonies();
  }

  renderScaleAndHarmonies() {
    for (let i = 0; i < this.scale.length && i < this.scaleCells.length; i++) {
      const item = this.scale[i];
      const cell = this.scaleCells[i];
      cell.btn.style.backgroundColor = item.hex;
      cell.btn.dataset.hex = item.hex;
      cell.btn.title = `${item.step}: ${item.hex}`;
      cell.hexSpan.textContent = item.hex;
    }

    for (const { key } of HARMONY_META) {
      const items = this.harmonies[key] || [];
      const slots = this.harmonySlots.get(key) || [];
      for (let i = 0; i < items.length && i < slots.length; i++) {
        const sw = items[i];
        const slot = slots[i];
        slot.btn.style.backgroundColor = sw.hex;
        slot.btn.dataset.hex = sw.hex;
        slot.btn.title = `${sw.hex} (${sw.h}°)`;
        slot.chip.textContent = sw.hex;
      }
    }
  }

  copyScaleCss() {
    const lines = this.scale.map((s) => `  --color-${s.step}: ${s.hex};`);
    const css = `:root {\n${lines.join('\n')}\n}`;
    if (this.onCopyText) this.onCopyText(css, 'Copied 50–950 CSS scale');
  }

  getPalettes() {
    const list = this.settings.get('palettes');
    return Array.isArray(list) ? list : [];
  }

  savePalette(name, colors) {
    const list = this.getPalettes().slice();
    const id = `pal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cleanColors = (colors || []).map((c) => String(c).toLowerCase());
    list.unshift({ id, name: name || 'Untitled Palette', colors: cleanColors });
    this.settings.set('palettes', list);
    this.renderPalettes();
    toast(`Saved palette “${name}”`, { icon: 'palette' });
    return id;
  }

  addColorToLatestPalette(hex) {
    const list = this.getPalettes().slice();
    if (!list.length) {
      this.savePalette('My Palette', [hex]);
      return;
    }
    const first = { ...list[0], colors: [...(list[0].colors || [])] };
    if (!first.colors.includes(hex.toLowerCase())) {
      first.colors.push(hex.toLowerCase());
    }
    list[0] = first;
    this.settings.set('palettes', list);
    this.renderPalettes();
    toast(`Added ${hex} to “${first.name}”`, { key: 'palette-add' });
  }

  deletePalette(id) {
    const list = this.getPalettes().filter((p) => p.id !== id);
    this.settings.set('palettes', list);
    this.renderPalettes();
  }

  removeColorFromPalette(id, index) {
    const list = this.getPalettes().map((p) => {
      if (p.id !== id) return p;
      const colors = p.colors.slice();
      colors.splice(index, 1);
      return { ...p, colors };
    });
    this.settings.set('palettes', list);
    this.renderPalettes();
  }

  renderPalettes() {
    const list = this.getPalettes();
    if (!list.length) {
      this.palettesList.replaceChildren(emptyState({
        icon: 'palette',
        title: 'No saved palettes yet',
        hint: 'Create a palette from the current color or save a harmony/scale.',
        action: { label: 'New Palette…', run: () => this.commands.run('new-palette') },
      }));
      return;
    }

    this.palettesList.replaceChildren(...list.map((pal) => {
      const swatches = (pal.colors || []).map((hex, idx) =>
        h('button.cp-swatch-btn', {
          style: { backgroundColor: hex },
          title: `${hex} (Click to load, Right-click to remove)`,
          dataset: { hex },
          onclick: () => this.onSelectColor && this.onSelectColor(hex),
          oncontextmenu: (e) => {
            e.preventDefault();
            this.removeColorFromPalette(pal.id, idx);
          },
        }, h('span.cp-swatch-chip.mono', hex))
      );

      return h('div.cp-palette-card', { dataset: { paletteId: pal.id } },
        h('div.cp-card-head',
          h('span.title', pal.name),
          h('div.cp-hero-actions',
            h('button.btn.ghost.small', {
              onclick: () => {
                const css = (pal.colors || []).map((c, i) => `  --palette-${i + 1}: ${c};`).join('\n');
                if (this.onCopyText) this.onCopyText(`:root {\n${css}\n}`, `Copied “${pal.name}” CSS`);
              },
            }, icon('copy'), 'Copy CSS'),
            h('button.icon-btn.small', {
              'aria-label': `Delete ${pal.name}`,
              title: 'Delete Palette',
              onclick: () => this.deletePalette(pal.id),
            }, icon('trash')),
          ),
        ),
        swatches.length ? h('div.cp-swatch-row', ...swatches) : h('div.dim', 'Empty palette'),
      );
    }));
  }
}
