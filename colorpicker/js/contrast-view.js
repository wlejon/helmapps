/**
 * WCAG 2.1 & APCA Contrast Inspector View for helm.colorpicker.
 * Compares Foreground and Background colors with live specimen preview,
 * WCAG AA/AAA badges, APCA Lc perceptual score, and one-click Oklch contrast fixing.
 *
 * Updates existing badge elements in-place so frame updates allocate zero DOM nodes.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { evaluateContrast, parseColorInput, toHexString } from './color-engine.js';

function applyBadge(el, pass, label) {
  const cls = `badge ${pass ? 'ok' : 'danger'}`;
  const txt = pass ? `${label} Pass` : `${label} Fail`;
  if (el.className !== cls) el.className = cls;
  if (el.textContent !== txt) el.textContent = txt;
}

export class ContrastInspector {
  constructor({ commands, onPairChange, onPickColor } = {}) {
    this.commands = commands;
    this.onPairChange = onPairChange;
    this.onPickColor = onPickColor;
    this.fg = '#f8fafc';
    this.bg = '#0f172a';
    this.metrics = evaluateContrast(this.fg, this.bg);

    // Foreground box
    this.fgSwatch = h('button.cp-pair-swatch', {
      title: 'Load Foreground into Picker',
      onclick: () => this.onPickColor && this.onPickColor(this.fg),
    });
    this.fgInput = h('input.field.cp-format-input', {
      type: 'text',
      value: this.fg,
      'aria-label': 'Foreground Color',
    });
    this.fgInput.addEventListener('change', () => this.setForeground(this.fgInput.value));
    this.fgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.setForeground(this.fgInput.value);
    });

    const fgBox = h('div.cp-pair-box',
      this.fgSwatch,
      h('div.cp-pair-fields',
        h('div.micro', 'FOREGROUND (TEXT)'),
        this.fgInput,
      ),
      h('button.btn.small', {
        title: 'Use current picker color as Foreground',
        onclick: () => this.commands.run('use-as-fg'),
      }, 'Use Picked'),
    );

    // Swap button
    const swapBtn = h('button.icon-btn', {
      'aria-label': 'Swap Foreground and Background',
      'data-tip': 'Swap Foreground & Background',
      onclick: () => this.commands.run('swap-contrast'),
    }, icon('arrow-up-down'));

    // Background box
    this.bgSwatch = h('button.cp-pair-swatch', {
      title: 'Load Background into Picker',
      onclick: () => this.onPickColor && this.onPickColor(this.bg),
    });
    this.bgInput = h('input.field.cp-format-input', {
      type: 'text',
      value: this.bg,
      'aria-label': 'Background Color',
    });
    this.bgInput.addEventListener('change', () => this.setBackground(this.bgInput.value));
    this.bgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.setBackground(this.bgInput.value);
    });

    const bgBox = h('div.cp-pair-box',
      this.bgSwatch,
      h('div.cp-pair-fields',
        h('div.micro', 'BACKGROUND (SURFACE)'),
        this.bgInput,
      ),
      h('button.btn.small', {
        title: 'Use current picker color as Background',
        onclick: () => this.commands.run('use-as-bg'),
      }, 'Use Picked'),
    );

    // Score readouts
    this.wcagScoreEl = h('span.cp-score-big.num');
    this.wcagOverallBadge = h('span.badge');
    this.apcaScoreEl = h('span.cp-score-big.num');
    this.apcaOverallBadge = h('span.badge');
    this.apcaPolarityEl = h('div.dim');

    this.fixAaBtn = h('button.btn.primary.small', {
      onclick: () => this.commands.run('fix-contrast-aa'),
    }, icon('sparkles'), 'Fix Contrast (AA 4.5:1)');

    this.fixAaaBtn = h('button.btn.small', {
      onclick: () => this.commands.run('fix-contrast-aaa'),
    }, 'Fix AAA (7.0:1)');

    const scoresRow = h('div.cp-scores-grid',
      h('div.cp-card',
        h('div.cp-card-head',
          h('span.micro', 'WCAG 2.1 CONTRAST RATIO'),
          this.wcagOverallBadge,
        ),
        h('div.cp-card-head',
          this.wcagScoreEl,
          h('div.cp-hero-actions', this.fixAaBtn, this.fixAaaBtn),
        ),
      ),
      h('div.cp-card',
        h('div.cp-card-head',
          h('span.micro', 'APCA PERCEPTUAL CONTRAST (Lc)'),
          this.apcaOverallBadge,
        ),
        h('div.cp-card-head',
          this.apcaScoreEl,
          this.apcaPolarityEl,
        ),
      ),
    );

    // Persistent badge elements for detailed checks
    this.bNormalAA = h('span.badge');
    this.bNormalAAA = h('span.badge');
    this.bLargeAA = h('span.badge');
    this.bLargeAAA = h('span.badge');
    this.bUiWCAG = h('span.badge');
    this.bUiAPCA = h('span.badge');

    const checksGrid = h('div.cp-checks-grid',
      h('div.cp-check-item',
        h('div.title', 'Normal Text'),
        h('div.dim', 'Under 18pt (24px) regular or 14pt bold'),
        h('div.cp-check-badges', this.bNormalAA, this.bNormalAAA),
      ),
      h('div.cp-check-item',
        h('div.title', 'Large Text'),
        h('div.dim', '18pt+ (24px+) regular or 14pt+ (18.6px+) bold'),
        h('div.cp-check-badges', this.bLargeAA, this.bLargeAAA),
      ),
      h('div.cp-check-item',
        h('div.title', 'UI Components & Icons'),
        h('div.dim', 'Controls, focus rings, icons, and chart lines'),
        h('div.cp-check-badges', this.bUiWCAG, this.bUiAPCA),
      ),
    );

    // Live Specimen Preview
    this.previewBox = h('div.cp-preview-box',
      h('div.cp-preview-large', 'The quick brown fox jumps over the lazy dog'),
      h('div.cp-preview-body', 'Perceptually uniform Oklch color spaces make it effortless to tune lightness for crisp readability across both dark and light desktop themes without shifting hue.'),
      h('div.cp-preview-ui-row',
        h('span.cp-preview-pill', icon('check'), 'Interactive Control (3.0:1+)'),
        h('span.mono.num', '0123456789 — U+2192'),
      ),
    );

    this.el = h('div.cp-card',
      h('div.cp-card-head',
        h('span.title', 'Contrast & Accessibility Inspector'),
        h('span.dim', 'WCAG 2.1 + APCA-W3 Perceptual Readability'),
      ),
      h('div.cp-contrast-pair', fgBox, swapBtn, bgBox),
      scoresRow,
      checksGrid,
      this.previewBox,
    );

    this.render();
  }

  setPair(fg, bg, { notify = true } = {}) {
    const pFg = parseColorInput(fg);
    const pBg = parseColorInput(bg);
    if (pFg) this.fg = toHexString(pFg);
    if (pBg) this.bg = toHexString(pBg);
    this.metrics = evaluateContrast(this.fg, this.bg);
    this.render();
    if (notify && this.onPairChange) this.onPairChange(this.fg, this.bg, this.metrics);
  }

  setForeground(fg, opts) {
    this.setPair(fg, this.bg, opts);
  }

  setBackground(bg, opts) {
    this.setPair(this.fg, bg, opts);
  }

  swap() {
    this.setPair(this.bg, this.fg);
  }

  render() {
    const m = this.metrics;
    this.fgSwatch.style.backgroundColor = this.fg;
    this.bgSwatch.style.backgroundColor = this.bg;
    if (document.activeElement !== this.fgInput) this.fgInput.value = this.fg;
    if (document.activeElement !== this.bgInput) this.bgInput.value = this.bg;

    this.wcagScoreEl.textContent = `${m.ratio.toFixed(2)}:1`;
    if (m.normalAAA) {
      this.wcagOverallBadge.className = 'badge ok';
      this.wcagOverallBadge.textContent = 'AAA Compliant';
    } else if (m.normalAA) {
      this.wcagOverallBadge.className = 'badge ok';
      this.wcagOverallBadge.textContent = 'AA Compliant';
    } else if (m.largeAA) {
      this.wcagOverallBadge.className = 'badge warn';
      this.wcagOverallBadge.textContent = 'AA Large Only';
    } else {
      this.wcagOverallBadge.className = 'badge danger';
      this.wcagOverallBadge.textContent = 'Low Contrast';
    }

    const sign = m.lc > 0 ? '+' : '';
    this.apcaScoreEl.textContent = `Lc ${sign}${m.lc.toFixed(1)}`;
    this.apcaPolarityEl.textContent = m.lc < 0 ? 'Light text on dark surface' : m.lc > 0 ? 'Dark text on light surface' : 'Identical luminance';

    if (m.apcaBody) {
      this.apcaOverallBadge.className = 'badge ok';
      this.apcaOverallBadge.textContent = 'Body Text (Lc 75+)';
    } else if (m.apcaLarge) {
      this.apcaOverallBadge.className = 'badge ok';
      this.apcaOverallBadge.textContent = 'Content / Large (Lc 60+)';
    } else if (m.apcaSub) {
      this.apcaOverallBadge.className = 'badge warn';
      this.apcaOverallBadge.textContent = 'Headings Only (Lc 45+)';
    } else {
      this.apcaOverallBadge.className = 'badge danger';
      this.apcaOverallBadge.textContent = 'Below Lc 45';
    }

    applyBadge(this.bNormalAA, m.normalAA, 'AA 4.5:1');
    applyBadge(this.bNormalAAA, m.normalAAA, 'AAA 7.0:1');
    applyBadge(this.bLargeAA, m.largeAA, 'AA 3.0:1');
    applyBadge(this.bLargeAAA, m.largeAAA, 'AAA 4.5:1');
    applyBadge(this.bUiWCAG, m.uiAA, 'WCAG 3.0:1');
    applyBadge(this.bUiAPCA, m.apcaLarge, 'APCA Lc 60+');

    this.previewBox.style.backgroundColor = this.bg;
    this.previewBox.style.color = this.fg;
  }
}
