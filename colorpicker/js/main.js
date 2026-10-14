/**
 * Color Picker & Contrast Inspector (helm.colorpicker) — main module.
 *
 * Follows docs/performance.md:
 *  - Builds and paints the entire window synchronously from the kit before any I/O.
 *  - Uses `bro.themes` for Oklab/Oklch conversions, WCAG 2.1 contrast, APCA Lc,
 *    and minimum-contrast adjustment, with complete pure-JS fallback math.
 */

import { startApp } from '/lib/app.js';
import { h, clamp, isTyping } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar } from '/lib/layout.js';
import { Slider, Segmented } from '/lib/controls.js';
import { Dialog, promptDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';

import * as colorEngine from './color-engine.js';
import {
  parseColorInput,
  toHexString,
  srgbToHsv,
  hsvToSrgb,
  srgbToOklch,
  oklchToSrgb,
  formatAllRepresentations,
  wcagContrast,
  fixContrastColor,
  setForceFallbackMath,
  isUsingNativeThemes,
} from './color-engine.js';
import {
  ColorPlane,
  MAX_CHROMA,
  openEyedropperDialog,
  setEyedropperSource,
  acquireEyedropperFrame,
  sampleFramePixel,
} from './picker-canvas.js';
import { ContrastInspector } from './contrast-view.js';
import { HarmoniesAndPalettesView } from './harmonies-view.js';

const DEFAULT_HISTORY = [
  '#3b82f6', '#6366f1', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#0f172a', '#f8fafc',
];

const DEFAULT_PALETTES = [
  {
    id: 'helm-graphite',
    name: 'Helm Graphite Accents',
    colors: ['#3b82f6', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899'],
  },
];

const app = startApp({
  settings: {
    view: { type: 'string', default: 'picker' },
    planeSpace: { type: 'string', default: 'hsv' },
    color: { type: 'string', default: '#3b82f6' },
    fgColor: { type: 'string', default: '#f8fafc' },
    bgColor: { type: 'string', default: '#0f172a' },
    history: { type: 'json', default: DEFAULT_HISTORY },
    palettes: { type: 'json', default: DEFAULT_PALETTES },
  },
});
const { commands, settings } = app;

// ---- state ------------------------------------------------------------------

const initialRgb = parseColorInput(settings.get('color')) || { r: 59, g: 130, b: 246, a: 255 };
const initialHsv = srgbToHsv(initialRgb);

const state = {
  view: ['picker', 'contrast', 'harmonies', 'palettes'].includes(settings.get('view'))
    ? settings.get('view')
    : 'picker',
  planeSpace: settings.get('planeSpace') === 'oklch' ? 'oklch' : 'hsv',
  color: initialRgb,
  hue: initialHsv.h || 217,
  alpha: initialRgb.a == null ? 100 : Math.round((initialRgb.a / 255) * 100),
  formats: formatAllRepresentations(initialRgb),
  lastCopied: '',
};

// ---- the window -------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const sidebar = new Sidebar({ onSelect: (item) => setView(item.id) });
ui.sidebar.appendChild(sidebar.el);

const statusLeft = h('span.grow.num');
const statusRight = h('span.dim.num');
ui.statusbar.append(statusLeft, statusRight);

// ---- Picker & Formats View --------------------------------------------------

const plane = new ColorPlane({
  space: state.planeSpace,
  onChange: (x, y) => onPlaneInput(x, y),
});

const spaceSwitch = new Segmented({
  options: [
    { value: 'hsv', label: 'HSV Plane' },
    { value: 'oklch', label: 'Oklch Plane' },
  ],
  value: state.planeSpace,
  onChange: (sp) => setPlaneSpace(sp),
});

const hueValLabel = h('span.cp-slider-val.num', '217°');
const hueSlider = new Slider({
  min: 0,
  max: 360,
  step: 1,
  value: Math.round(state.hue),
  onInput: (v) => onHueChange(v, false),
  onChange: (v) => onHueChange(v, true),
});

const alphaValLabel = h('span.cp-slider-val.num', '100%');
const alphaSlider = new Slider({
  min: 0,
  max: 100,
  step: 1,
  value: state.alpha,
  onInput: (v) => onAlphaChange(v, false),
  onChange: (v) => onAlphaChange(v, true),
});

const quickDarkBadge = h('span.badge');
const quickLightBadge = h('span.badge');

const leftPickerCard = h('div.cp-card',
  h('div.cp-card-head',
    h('span.title', 'Color Surface'),
    spaceSwitch.el,
  ),
  plane.el,
  h('div.cp-sliders',
    h('div.cp-slider-row',
      h('span.cp-slider-label', 'Hue'),
      hueSlider.el,
      hueValLabel,
    ),
    h('div.cp-slider-row',
      h('span.cp-slider-label', 'Alpha'),
      alphaSlider.el,
      alphaValLabel,
    ),
  ),
  h('div.cp-pair-box',
    h('div.cp-pair-fields',
      h('div.micro', 'QUICK CONTRAST CHECK'),
      h('div.cp-check-badges', quickDarkBadge, quickLightBadge),
    ),
    h('button.btn.small', {
      onclick: () => {
        contrastView.setForeground(state.formats.hex6);
        setView('contrast');
      },
    }, icon('eye'), 'Inspect'),
  ),
);

// Active Swatch & Bi-directional Format Fields
const heroSwatch = h('div.cp-swatch-large');
const heroHexTitle = h('div.head.mono');
const heroSubTitle = h('div.dim.mono');

const FORMAT_SPECS = [
  { id: 'hex', label: 'HEX', cmd: 'copy-hex' },
  { id: 'rgb', label: 'RGB', cmd: 'copy-rgb' },
  { id: 'hsl', label: 'HSL', cmd: 'copy-hsl' },
  { id: 'oklch', label: 'OKLCH', cmd: 'copy-oklch' },
  { id: 'oklab', label: 'OKLAB', cmd: 'copy-oklab' },
  { id: 'cssVar', label: 'CSS VAR', cmd: 'copy-css' },
];

const formatInputs = new Map();
const formatRows = FORMAT_SPECS.map((spec) => {
  const input = h('input.field.cp-format-input', {
    type: 'text',
    dataset: { format: spec.id },
    'aria-label': `${spec.label} value`,
  });
  input.addEventListener('change', () => applyUserColorString(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyUserColorString(input.value);
  });
  formatInputs.set(spec.id, input);

  return h('div.cp-format-row',
    h('span.cp-format-tag', spec.label),
    input,
    h('button.icon-btn', {
      'aria-label': `Copy ${spec.label}`,
      'data-tip': `Copy ${spec.label}`,
      dataset: { copyFormat: spec.id },
      onclick: () => commands.run(spec.cmd),
    }, icon('copy')),
  );
});

const historyRow = h('div.cp-swatch-row');

const rightFormatsCard = h('div.cp-card',
  h('div.cp-hero',
    heroSwatch,
    h('div.cp-hero-meta', heroHexTitle, heroSubTitle),
    h('div.cp-hero-actions',
      h('button.btn.small', { onclick: () => commands.run('eyedropper') }, icon('eye'), 'Eyedropper'),
      h('button.btn.primary.small', { onclick: () => commands.run('add-to-palette') }, icon('plus'), 'Save Swatch'),
    ),
  ),
  h('div.cp-formats', ...formatRows),
  h('div.micro', 'RECENT COLORS'),
  historyRow,
);

const pickerSection = h('div.cp-layout',
  h('div.cp-top-grid', leftPickerCard, rightFormatsCard),
);

// ---- Contrast Inspector & Harmonies/Palettes Views --------------------------

const contrastView = new ContrastInspector({
  commands,
  onPairChange: (fg, bg) => {
    settings.set('fgColor', fg);
    settings.set('bgColor', bg);
    updateStatus();
  },
  onPickColor: (hex) => {
    setColor(hex, { pushHistory: true });
    setView('picker');
  },
});
contrastView.setPair(settings.get('fgColor'), settings.get('bgColor'), { notify: false });

const harmoniesView = new HarmoniesAndPalettesView({
  settings,
  commands,
  onSelectColor: (hex) => {
    setColor(hex, { pushHistory: true });
    toast(`Selected ${hex}`, { key: 'select-swatch' });
  },
  onCopyText: (text, msg) => copyText(text, msg),
});

const contrastSection = h('div.cp-layout', contrastView.el);

ui.content.append(
  pickerSection,
  contrastSection,
  harmoniesView.harmoniesSection,
  harmoniesView.palettesSection,
);

// ---- Commands & Shortcuts ---------------------------------------------------

commands.addAll([
  { id: 'view-picker', label: 'Picker & Formats', icon: 'palette', keys: ['Mod+1'],
    checked: () => state.view === 'picker', run: () => setView('picker') },
  { id: 'view-contrast', label: 'Contrast Inspector', icon: 'eye', keys: ['Mod+2'],
    checked: () => state.view === 'contrast', run: () => setView('contrast') },
  { id: 'view-harmonies', label: 'Harmonies & Scale', icon: 'layers', keys: ['Mod+3'],
    checked: () => state.view === 'harmonies', run: () => setView('harmonies') },
  { id: 'view-palettes', label: 'Saved Palettes', icon: 'star', keys: ['Mod+4'],
    checked: () => state.view === 'palettes', run: () => setView('palettes') },
  { id: 'eyedropper', label: 'Pick from Screen…', icon: 'eye', keys: ['Mod+I'],
    run: () => pickFromEyedropper() },
  { id: 'copy-hex', label: 'Copy HEX', icon: 'copy', keys: ['Mod+C'],
    run: () => copyText(state.formats.hex, `Copied ${state.formats.hex}`) },
  { id: 'copy-rgb', label: 'Copy RGB', icon: 'copy',
    run: () => copyText(state.formats.rgb, `Copied ${state.formats.rgb}`) },
  { id: 'copy-hsl', label: 'Copy HSL', icon: 'copy',
    run: () => copyText(state.formats.hsl, `Copied ${state.formats.hsl}`) },
  { id: 'copy-oklch', label: 'Copy OKLCH', icon: 'copy', keys: ['Mod+Shift+C'],
    run: () => copyText(state.formats.oklch, `Copied ${state.formats.oklch}`) },
  { id: 'copy-oklab', label: 'Copy OKLAB', icon: 'copy',
    run: () => copyText(state.formats.oklab, `Copied ${state.formats.oklab}`) },
  { id: 'copy-css', label: 'Copy CSS Variable', icon: 'code',
    run: () => copyText(state.formats.cssVar, 'Copied CSS variable') },
  { id: 'use-as-fg', label: 'Use as Foreground', icon: 'type',
    run: () => contrastView.setForeground(state.formats.hex6) },
  { id: 'use-as-bg', label: 'Use as Background', icon: 'layers',
    run: () => contrastView.setBackground(state.formats.hex6) },
  { id: 'swap-contrast', label: 'Swap Foreground & Background', icon: 'arrow-up-down', keys: ['X'],
    run: () => contrastView.swap() },
  { id: 'fix-contrast-aa', label: 'Fix Contrast (AA 4.5:1)', icon: 'sparkles',
    run: () => fixContrast(4.5) },
  { id: 'fix-contrast-aaa', label: 'Fix Contrast (AAA 7.0:1)', icon: 'sparkles',
    run: () => fixContrast(7.0) },
  { id: 'add-to-palette', label: 'Save to Palette', icon: 'plus', keys: ['Mod+S'],
    inText: true,
    run: () => {
      pushHistory(state.formats.hex6);
      harmoniesView.addColorToLatestPalette(state.formats.hex6);
      updateStatus();
    } },
  { id: 'new-palette', label: 'New Palette…', icon: 'folder-plus', keys: ['Mod+N'],
    run: async () => {
      const name = await promptDialog({
        title: 'New Color Palette',
        value: 'Custom Palette',
        placeholder: 'Palette name',
        ok: 'Create',
      });
      if (name) {
        harmoniesView.savePalette(name.trim(), [state.formats.hex6]);
        setView('palettes');
      }
    } },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q', 'Mod+W'], run: () => app.quit() },
]);

window.addEventListener('copy', (e) => {
  if (isTyping(e) || Dialog.current) return;
  e.preventDefault();
  commands.run('copy-hex');
});

toolbar.button('eyedropper', { label: true });
toolbar.sep();
toolbar.button('copy-hex', { label: true });
toolbar.button('copy-oklch', { label: true });
toolbar.button('add-to-palette');
toolbar.spacer();

const viewSeg = new Segmented({
  options: [
    { value: 'picker', label: 'Picker', icon: 'palette' },
    { value: 'contrast', label: 'Contrast', icon: 'eye' },
    { value: 'harmonies', label: 'Harmonies', icon: 'layers' },
    { value: 'palettes', label: 'Palettes', icon: 'star' },
  ],
  value: state.view,
  onChange: (v) => setView(v),
});
toolbar.add(viewSeg.el);

let lastPalCount = -1;
function drawSidebar() {
  const palCount = harmoniesView.getPalettes().length;
  if (palCount !== lastPalCount) {
    lastPalCount = palCount;
    sidebar.setSections([
      {
        title: 'Inspector',
        items: [
          { id: 'picker', label: 'Picker & Formats', icon: 'palette' },
          { id: 'contrast', label: 'Contrast Inspector', icon: 'eye' },
          { id: 'harmonies', label: 'Harmonies & Scale', icon: 'layers' },
          { id: 'palettes', label: 'Saved Palettes', icon: 'star', count: palCount },
        ],
      },
    ]);
  }
  sidebar.select(state.view);
}

// ---- Actions & State Synchronization ----------------------------------------

function setView(v) {
  if (!['picker', 'contrast', 'harmonies', 'palettes'].includes(v)) return;
  state.view = v;
  settings.set('view', v);
  viewSeg.set(v);
  sidebar.select(v);
  pickerSection.classList.toggle('hidden', v !== 'picker');
  contrastSection.classList.toggle('hidden', v !== 'contrast');
  harmoniesView.harmoniesSection.classList.toggle('hidden', v !== 'harmonies');
  harmoniesView.palettesSection.classList.toggle('hidden', v !== 'palettes');
  if (v === 'harmonies') harmoniesView.updateColor(state.color);
  toolbar.refresh();
  updateStatus();
}

function setPlaneSpace(space) {
  state.planeSpace = space === 'oklch' ? 'oklch' : 'hsv';
  settings.set('planeSpace', state.planeSpace);
  spaceSwitch.set(state.planeSpace);
  plane.setSpace(state.planeSpace);
  syncPlanePositionFromColor();
}

function syncPlanePositionFromColor() {
  if (state.planeSpace === 'hsv') {
    const hsv = srgbToHsv(state.color);
    if (hsv.s > 0.01) state.hue = hsv.h;
    plane.setState({ hue: state.hue, x: hsv.s, y: hsv.v });
  } else {
    const lch = srgbToOklch(state.color);
    if (lch.c > 0.005) state.hue = lch.h;
    plane.setState({ hue: state.hue, x: clamp(lch.c / MAX_CHROMA, 0, 1), y: lch.l });
  }
  hueSlider.set(Math.round(state.hue));
  hueValLabel.textContent = `${Math.round(state.hue)}°`;
}

function onPlaneInput(x, y) {
  const a = Math.round((state.alpha / 100) * 255);
  let rgb;
  if (state.planeSpace === 'hsv') {
    rgb = hsvToSrgb({ h: state.hue, s: x, v: y }, a);
  } else {
    rgb = oklchToSrgb({ l: y, c: x * MAX_CHROMA, h: state.hue }, a);
  }
  updateActiveColorObject(rgb, { syncPlane: false, pushHistory: false });
}

function onHueChange(deg, commit = false) {
  state.hue = clamp(Number(deg) || 0, 0, 360);
  hueValLabel.textContent = `${Math.round(state.hue)}°`;
  plane.setState({ hue: state.hue });
  onPlaneInput(plane.x, plane.y);
  if (commit) pushHistory(state.formats.hex6);
}

function onAlphaChange(pct) {
  state.alpha = clamp(Math.round(Number(pct) || 0), 0, 100);
  alphaValLabel.textContent = `${state.alpha}%`;
  const a = Math.round((state.alpha / 100) * 255);
  updateActiveColorObject({ ...state.color, a }, { syncPlane: false, pushHistory: false });
}

function applyUserColorString(raw) {
  const parsed = parseColorInput(raw);
  if (!parsed) {
    toast(`Invalid color format: ${raw}`, { error: true });
    renderPickerState();
    return false;
  }
  setColor(parsed, { pushHistory: true });
  return true;
}

function setColor(input, { pushHistory: record = true } = {}) {
  const parsed = parseColorInput(input);
  if (!parsed) return false;
  state.alpha = Math.round(((parsed.a == null ? 255 : parsed.a) / 255) * 100);
  alphaSlider.set(state.alpha);
  alphaValLabel.textContent = `${state.alpha}%`;
  updateActiveColorObject(parsed, { syncPlane: true, pushHistory: record });
  return true;
}

function updateActiveColorObject(rgb, { syncPlane = true, pushHistory: record = false } = {}) {
  state.color = {
    r: clamp(Math.round(rgb.r || 0), 0, 255),
    g: clamp(Math.round(rgb.g || 0), 0, 255),
    b: clamp(Math.round(rgb.b || 0), 0, 255),
    a: rgb.a == null ? 255 : clamp(Math.round(rgb.a), 0, 255),
  };
  state.formats = formatAllRepresentations(state.color);
  if (record) settings.set('color', state.formats.hex);
  if (syncPlane) syncPlanePositionFromColor();
  if (record) pushHistory(state.formats.hex6);
  renderPickerState();
  if (state.view === 'harmonies') harmoniesView.updateColor(state.color);
  updateStatus();
}

let historyKey = '';
function pushHistory(hex) {
  const clean = String(hex).toLowerCase();
  const list = (settings.get('history') || DEFAULT_HISTORY).filter((h) => String(h).toLowerCase() !== clean);
  list.unshift(clean);
  settings.set('history', list.slice(0, 14));
  renderHistory();
}

function renderHistory() {
  const list = settings.get('history') || DEFAULT_HISTORY;
  const sig = list.join(',');
  if (sig !== historyKey) {
    historyKey = sig;
    historyRow.replaceChildren(...list.map((hex) =>
      h('button.cp-swatch-btn', {
        style: { backgroundColor: hex },
        title: hex,
        dataset: { historyHex: hex },
        onclick: () => setColor(hex, { pushHistory: false }),
      }, h('span.cp-swatch-chip.mono', hex))
    ));
  }
  const activeHex = state.formats.hex6.toLowerCase();
  for (const btn of historyRow.children) {
    btn.classList.toggle('active', (btn.dataset.historyHex || '').toLowerCase() === activeHex);
  }
}

function renderPickerState() {
  const f = state.formats;
  heroSwatch.style.backgroundColor = f.hex;
  heroHexTitle.textContent = f.hex.toUpperCase();
  heroSubTitle.textContent = f.oklch;
  app.setTitle(f.hex.toUpperCase());

  for (const [id, input] of formatInputs) {
    if (document.activeElement !== input) {
      input.value = f[id] || '';
    }
  }

  const ratioDark = wcagContrast(state.color, '#0f172a');
  const ratioLight = wcagContrast(state.color, '#ffffff');
  quickDarkBadge.className = `badge ${ratioDark >= 4.5 ? 'ok' : ratioDark >= 3.0 ? 'warn' : 'danger'}`;
  quickDarkBadge.textContent = `On Dark: ${ratioDark.toFixed(1)}:1`;
  quickLightBadge.className = `badge ${ratioLight >= 4.5 ? 'ok' : ratioLight >= 3.0 ? 'warn' : 'danger'}`;
  quickLightBadge.textContent = `On Light: ${ratioLight.toFixed(1)}:1`;

  renderHistory();
}

function fixContrast(minRatio = 4.5) {
  const fixed = fixContrastColor(contrastView.fg, contrastView.bg, minRatio);
  contrastView.setForeground(fixed);
  setColor(fixed, { pushHistory: true });
  toast(`Adjusted foreground to ${fixed} (${contrastView.metrics.ratio.toFixed(2)}:1)`, { icon: 'sparkles', key: 'fix-contrast' });
  return fixed;
}

async function pickFromEyedropper(directCoords = null) {
  if (directCoords && typeof directCoords.x === 'number' && typeof directCoords.y === 'number') {
    const frame = await acquireEyedropperFrame();
    const sampled = sampleFramePixel(frame, directCoords.x, directCoords.y);
    setColor(sampled, { pushHistory: true });
    return sampled;
  }
  const picked = await openEyedropperDialog();
  if (picked && picked.hex) {
    setColor(picked, { pushHistory: true });
    toast(`Sampled ${picked.hex}`, { icon: 'eye' });
  }
  return picked;
}

async function copyText(text, message) {
  state.lastCopied = text;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
    }
    toast(message || `Copied ${text}`, { icon: 'copy', key: 'copy' });
  } catch (_) {
    toast(message || `Copied ${text}`, { icon: 'copy', key: 'copy' });
  }
  return text;
}

function updateStatus() {
  const f = state.formats;
  const m = contrastView.metrics;
  statusLeft.textContent = `${f.hex.toUpperCase()} · ${f.oklch} · Contrast ${m.ratio.toFixed(2)}:1 (Lc ${m.lc > 0 ? '+' : ''}${m.lc.toFixed(1)})`;
  statusRight.textContent = isUsingNativeThemes() ? 'bro.themes color engine' : 'Oklch fallback engine';
  drawSidebar();
}

// ---- Startup & Launch -------------------------------------------------------

syncPlanePositionFromColor();
renderPickerState();
setView(state.view);

app.onLaunch(({ argv }) => {
  const arg = (argv || []).find((a) => !a.startsWith('--'));
  if (arg) setColor(arg, { pushHistory: true });
  if ((argv || []).includes('--contrast')) setView('contrast');
  if ((argv || []).includes('--eyedropper')) pickFromEyedropper();
});

app.expose({
  state,
  plane,
  contrastView,
  harmoniesView,
  colorEngine,
  setColor,
  setView,
  setPlaneSpace,
  applyUserColorString,
  fixContrast,
  pickFromEyedropper,
  setEyedropperSource,
  setForceFallbackMath: (f) => { setForceFallbackMath(f); updateStatus(); },
});
