/**
 * Screenshot (helm.screenshot) — main application module.
 * Supports Full Screen, Current Display, and Region capture via Wayland
 * screencopy (or synthetic test sources), opening existing images, object-based
 * annotations with Undo/Redo, region cropping, and saving/copying.
 */

import { startApp } from '/lib/app.js';
import { h, clamp } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, emptyState } from '/lib/layout.js';
import { Switch, Segmented } from '/lib/controls.js';
import { toast } from '/lib/toast.js';
import { homeDir } from '/lib/files.js';

import {
  setCaptureSource as setCaptureSourceImpl,
  hasScreencopy,
  hasCaptureAvailable,
  captureUnavailableReason,
  createSyntheticSource,
  captureOutput,
  openImageBuffer,
  cropImageBuffer,
} from './capture.js';
import {
  registerToolIcons,
  TOOLS,
  PALETTE,
  STROKE_WIDTHS,
  renderFlattenedPixels,
} from './tools.js';
import { AnnotateStage, RegionOverlay } from './annotate.js';
import {
  formatFilename,
  getSaveFolder,
  saveScreenshotToFolder,
  saveScreenshotAsDialog,
  copyScreenshotToClipboard,
  openSavedInViewer,
  showSavedInFiles,
} from './export.js';

const path = require('path');

registerToolIcons();

const MAX_UNDO = 50;

const app = startApp({
  settings: {
    mode: { type: 'string', default: 'full' },
    delay: { type: 'int', default: 0 },
    includePointer: { type: 'bool', default: false },
    saveFolder: { type: 'string', default: '' },
    format: { type: 'string', default: 'png' },
    jpegQuality: { type: 'int', default: 90 },
    color: { type: 'string', default: '#ef4444' },
    strokeWidth: { type: 'int', default: 4 },
  },
});
const { commands, settings } = app;

const state = {
  view: 'home',              // 'home' | 'region' | 'result'
  prevView: 'home',
  image: null,               // { width, height, channels, pixels: Uint8Array }
  annotations: [],           // non-destructive annotation objects
  undoStack: [],
  redoStack: [],
  tool: 'rect',
  regionRect: null,          // { x, y, w, h } in image pixel coordinates
  lastSavedPath: '',
  capturing: false,
  captureAvailable: hasCaptureAvailable(),
};

function setCaptureSource(fn) {
  setCaptureSourceImpl(fn);
  state.captureAvailable = hasCaptureAvailable();
  refreshChrome();
}

// ---- window & views ---------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: false, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const statusText = h('span.grow.num');
const statusRight = h('span.dim.num');
ui.statusbar.append(statusText, statusRight);

const modeCards = new Map();
const MODES = [
  { id: 'full', title: 'Full Screen', sub: 'Capture the entire desktop', icon: 'fullscreen' },
  { id: 'display', title: 'Current Display', sub: 'Capture active monitor', icon: 'monitor' },
  { id: 'region', title: 'Region', sub: 'Drag to select an area', icon: 'crop' },
];

const modesRow = h('div.ss-modes', ...MODES.map((m) => {
  const card = h('button.ss-mode-card', {
    dataset: { mode: m.id },
    onclick: () => { settings.set('mode', m.id); refreshChrome(); },
  }, icon(m.icon, 'lg'), h('div.ss-mode-title', m.title), h('div.ss-mode-sub', m.sub));
  modeCards.set(m.id, card);
  return card;
}));

const delaySeg = new Segmented({
  options: [
    { value: 0, label: 'No Delay' },
    { value: 3, label: '3 s' },
    { value: 5, label: '5 s' },
    { value: 10, label: '10 s' },
  ],
  value: settings.get('delay') || 0,
  onChange: (v) => settings.set('delay', Number(v)),
});

const pointerSwitch = new Switch({
  on: settings.get('includePointer'),
  label: 'Include Mouse Pointer',
  onChange: (on) => settings.set('includePointer', on),
});

const formatSeg = new Segmented({
  options: [{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPEG' }],
  value: settings.get('format') || 'png',
  onChange: (v) => settings.set('format', v),
});

const folderPathLabel = h('span.dim.mono.ellipsis', getSaveFolder(settings));
const chooseFolderBtn = h('button.btn.small', { onclick: () => commands.run('choose-save-folder') },
  icon('folder-open'), 'Change…');

const unavailBox = h('div.ss-unavail',
  emptyState({ icon: 'camera', title: 'Screen capture is unavailable here', hint: captureUnavailableReason() }));

const openImgHomeBtn = h('button.btn.ss-open-btn', { onclick: () => commands.run('open-image') },
  icon('folder-open'), 'Open Image…');
const takeHomeBtn = h('button.btn.primary.ss-take-btn', { onclick: () => commands.run('take-screenshot') },
  icon('camera'), 'Take Screenshot');

const homeView = h('div.ss-home',
  h('div.ss-home-inner',
    h('div.ss-home-head',
      h('div.head', 'Capture Screen'),
      h('div.dim', 'Choose a capture mode and timer, or open an existing image to annotate and crop.')),
    modesRow,
    unavailBox,
    h('div.group',
      h('div.micro', 'CAPTURE OPTIONS'),
      h('div.group-rows',
        h('div.form-row',
          h('div.form-label', h('span', 'Delay'), h('span.dim', 'Wait before capturing')),
          h('div.form-control.num', delaySeg.el)),
        h('div.form-row',
          h('div.form-label', h('span', 'Include Pointer'), h('span.dim', 'Show the cursor in the capture')),
          h('div.form-control', pointerSwitch.el)),
        h('div.form-row',
          h('div.form-label', h('span', 'Format'), h('span.dim', 'File format when saving')),
          h('div.form-control', formatSeg.el)),
        h('div.form-row',
          h('div.form-label', h('span', 'Save Folder'), folderPathLabel),
          h('div.form-control', chooseFolderBtn)))),
    h('div.ss-actions', openImgHomeBtn, takeHomeBtn)));

const stage = new AnnotateStage({
  state,
  settings,
  onAddAnnotation: (ann) => addAnnotation(ann),
  onChange: () => refreshChrome(),
});

const toolstrip = h('div.ss-toolstrip');
const toolToolbar = new Toolbar(toolstrip, commands);

const swatchButtons = new Map();
const swatchesEl = h('div.ss-swatches', ...PALETTE.map((c) => {
  const b = h('button.ss-swatch', {
    'data-tip': c.label,
    'aria-label': c.label,
    dataset: { color: c.hex },
    onclick: () => { settings.set('color', c.hex); refreshChrome(); },
  });
  b.style.background = c.hex;
  swatchButtons.set(c.hex.toLowerCase(), b);
  return b;
}));

const strokeSeg = new Segmented({
  options: STROKE_WIDTHS.map((s) => ({ value: s.value, label: `${s.value}px`, title: s.label })),
  value: settings.get('strokeWidth') || 4,
  onChange: (v) => settings.set('strokeWidth', Number(v)),
});

const resultView = h('div.ss-result.hidden', toolstrip, stage.el);
const regionOverlay = new RegionOverlay({
  state,
  onConfirm: () => confirmRegion(),
  onCancel: () => cancelRegion(),
});

ui.content.append(homeView, resultView);
document.body.appendChild(regionOverlay.el);

// ---- commands ---------------------------------------------------------------

const inResult = () => state.view === 'result' && !!state.image;
const inRegion = () => state.view === 'region' && !!state.image;

commands.addAll([
  { id: 'take-screenshot', label: 'Take Screenshot', icon: 'camera', keys: ['Mod+Shift+N'],
    enabled: () => hasCaptureAvailable() && !state.capturing, run: () => takeScreenshot() },
  { id: 'new-screenshot', label: 'New Screenshot', icon: 'plus', keys: ['Mod+N'], run: () => showHomeView() },
  { id: 'open-image', label: 'Open Image…', icon: 'folder-open', keys: ['Mod+O'], run: () => pickAndOpenImage() },
  { id: 'choose-save-folder', label: 'Choose Save Folder…', icon: 'folder', run: () => pickSaveFolder() },
  ...TOOLS.map((t) => ({
    id: `tool-${t.id}`, label: t.label, icon: t.icon, keys: t.keys,
    enabled: inResult, checked: () => state.tool === t.id, run: () => setTool(t.id),
  })),
  { id: 'crop', label: 'Crop Region', icon: 'crop', keys: ['C'], enabled: inResult, run: () => startRegionSelect() },
  { id: 'undo', label: 'Undo', icon: 'undo', keys: ['Mod+Z'],
    enabled: () => inResult() && state.undoStack.length > 0, run: () => undo() },
  { id: 'redo', label: 'Redo', icon: 'redo', keys: ['Mod+Shift+Z', 'Mod+Y'],
    enabled: () => inResult() && state.redoStack.length > 0, run: () => redo() },
  { id: 'clear-annotations', label: 'Clear Annotations', icon: 'trash',
    enabled: () => inResult() && state.annotations.length > 0, run: () => clearAnnotations() },
  { id: 'save', label: 'Save', icon: 'save', keys: ['Mod+S'], enabled: inResult, run: () => saveScreenshot() },
  { id: 'save-as', label: 'Save As…', icon: 'download', keys: ['Mod+Shift+S'], enabled: inResult, run: () => saveScreenshotAs() },
  { id: 'copy', label: 'Copy', icon: 'copy', keys: ['Mod+C'], enabled: inResult, run: () => copyScreenshot() },
  { id: 'open-with', label: 'Open in Image Viewer', icon: 'external-link', enabled: inResult,
    run: () => openSavedInViewer({ state, settings }) },
  { id: 'show-in-files', label: 'Show in Files', icon: 'folder', enabled: inResult,
    run: () => showSavedInFiles({ state, settings }) },
  { id: 'region-confirm', label: 'Confirm Region', icon: 'check', keys: ['Enter'], enabled: inRegion, run: () => confirmRegion() },
  { id: 'region-cancel', label: 'Cancel Region', icon: 'x', keys: ['Escape'], enabled: inRegion, run: () => cancelRegion() },
  { id: 'region-left', label: 'Nudge Left', keys: ['ArrowLeft'], enabled: inRegion, run: () => nudgeRegion(-1, 0) },
  { id: 'region-right', label: 'Nudge Right', keys: ['ArrowRight'], enabled: inRegion, run: () => nudgeRegion(1, 0) },
  { id: 'region-up', label: 'Nudge Up', keys: ['ArrowUp'], enabled: inRegion, run: () => nudgeRegion(0, -1) },
  { id: 'region-down', label: 'Nudge Down', keys: ['ArrowDown'], enabled: inRegion, run: () => nudgeRegion(0, 1) },
  { id: 'region-shift-left', label: 'Nudge Left 10px', keys: ['Shift+ArrowLeft'], enabled: inRegion, run: () => nudgeRegion(-10, 0) },
  { id: 'region-shift-right', label: 'Nudge Right 10px', keys: ['Shift+ArrowRight'], enabled: inRegion, run: () => nudgeRegion(10, 0) },
  { id: 'region-shift-up', label: 'Nudge Up 10px', keys: ['Shift+ArrowUp'], enabled: inRegion, run: () => nudgeRegion(0, -10) },
  { id: 'region-shift-down', label: 'Nudge Down 10px', keys: ['Shift+ArrowDown'], enabled: inRegion, run: () => nudgeRegion(0, 10) },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

toolbar.button('new-screenshot', { label: true });
toolbar.button('open-image');
toolbar.sep();
toolbar.button('undo');
toolbar.button('redo');
toolbar.button('clear-annotations');
toolbar.spacer();
toolbar.button('copy', { label: true });
toolbar.button('save-as');
const saveTopBtn = toolbar.button('save', { label: true });
saveTopBtn.classList.remove('ghost');
saveTopBtn.classList.add('primary');
toolbar.sep();
toolbar.button('open-with');
toolbar.button('show-in-files');

for (const t of TOOLS) toolToolbar.button(`tool-${t.id}`);
toolToolbar.sep();
toolToolbar.button('crop');
toolToolbar.sep();
toolToolbar.add(swatchesEl);
toolToolbar.sep();
toolToolbar.add(strokeSeg.el);

// ---- view transitions & actions ---------------------------------------------

function showHomeView() {
  state.view = 'home';
  regionOverlay.close();
  resultView.classList.add('hidden');
  homeView.classList.remove('hidden');
  app.setTitle('');
  refreshChrome();
}

function showResultView() {
  state.view = 'result';
  regionOverlay.close();
  homeView.classList.add('hidden');
  resultView.classList.remove('hidden');
  if (state.image) {
    stage.setImage(state.image);
    app.setTitle(`${state.image.width} × ${state.image.height}`);
  }
  refreshChrome();
}

function startRegionSelect(initialRect = null) {
  if (!state.image) return false;
  state.prevView = state.view;
  state.view = 'region';
  state.regionRect = initialRect ? { ...initialRect } : null;
  regionOverlay.open(state.image);
  refreshChrome();
  return true;
}

function setRegionRect(rect) {
  if (!state.image || !rect) return null;
  const x = clamp(Math.round(rect.x || 0), 0, state.image.width);
  const y = clamp(Math.round(rect.y || 0), 0, state.image.height);
  const w = clamp(Math.round(rect.w || 0), 0, state.image.width - x);
  const h = clamp(Math.round(rect.h || 0), 0, state.image.height - y);
  state.regionRect = { x, y, w, h };
  if (state.view === 'region') regionOverlay.drawNow();
  refreshChrome();
  return state.regionRect;
}

function nudgeRegion(dx, dy) {
  if (!state.image || !state.regionRect) return null;
  const r = state.regionRect;
  r.x = clamp(r.x + dx, 0, Math.max(0, state.image.width - r.w));
  r.y = clamp(r.y + dy, 0, Math.max(0, state.image.height - r.h));
  if (state.view === 'region') regionOverlay.drawNow();
  refreshChrome();
  return { ...r };
}

function confirmRegion() {
  if (!state.image) return null;
  const r = state.regionRect;
  if (r && r.w > 0 && r.h > 0) {
    const basePixels = state.annotations.length
      ? renderFlattenedPixels(state.image, state.annotations)
      : state.image.pixels;
    state.image = cropImageBuffer({ width: state.image.width, height: state.image.height, pixels: basePixels }, r);
    state.annotations = [];
    state.undoStack = [];
    state.redoStack = [];
    state.regionRect = null;
  }
  showResultView();
  return state.image;
}

function cancelRegion() {
  state.regionRect = null;
  if (state.prevView === 'result' && state.image) showResultView();
  else showHomeView();
}

function setTool(toolId) {
  state.tool = toolId;
  stage.canvas.classList.toggle('tool-select', toolId === 'select');
  refreshChrome();
}

function cloneAnnotations(list) {
  return list.map((a) => ({
    ...a,
    points: Array.isArray(a.points) ? a.points.map((p) => ({ x: p.x, y: p.y })) : undefined,
  }));
}

function pushUndo() {
  state.undoStack.push(cloneAnnotations(state.annotations));
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
}

function addAnnotation(ann) {
  if (!ann || !ann.type) return null;
  pushUndo();
  const entry = { color: settings.get('color') || '#ef4444', strokeWidth: settings.get('strokeWidth') || 4, ...ann };
  state.annotations.push(entry);
  stage.scheduleDraw();
  refreshChrome();
  return entry;
}

function undo() {
  if (!state.undoStack.length) return false;
  state.redoStack.push(cloneAnnotations(state.annotations));
  state.annotations = state.undoStack.pop();
  stage.scheduleDraw();
  refreshChrome();
  return true;
}

function redo() {
  if (!state.redoStack.length) return false;
  state.undoStack.push(cloneAnnotations(state.annotations));
  state.annotations = state.redoStack.pop();
  stage.scheduleDraw();
  refreshChrome();
  return true;
}

function clearAnnotations() {
  if (!state.annotations.length) return false;
  pushUndo();
  state.annotations = [];
  stage.scheduleDraw();
  refreshChrome();
  return true;
}

async function takeScreenshot(modeOverride, { delayOverride, autoSaveAndQuit = false } = {}) {
  if (state.capturing) return null;
  const mode = modeOverride || settings.get('mode') || 'full';
  const delaySec = delayOverride != null ? Number(delayOverride) : (Number(settings.get('delay')) || 0);
  if (!hasCaptureAvailable()) {
    toast('Screen capture is unavailable here', { error: true });
    refreshChrome();
    return null;
  }
  state.capturing = true;
  refreshChrome();
  try {
    if (delaySec > 0 && !autoSaveAndQuit) {
      for (let s = delaySec; s > 0; s--) {
        toast(`Capturing in ${s} s…`, { key: 'countdown', icon: 'timer', ms: 1200 });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    const captured = await captureOutput(0);
    if (!captured) {
      toast('Could not capture screen', { error: true });
      return null;
    }
    state.image = captured;
    state.annotations = [];
    state.undoStack = [];
    state.redoStack = [];
    state.lastSavedPath = '';
    if (autoSaveAndQuit) {
      await saveScreenshotToFolder({ state, settings });
      app.quit();
      return captured;
    }
    if (mode === 'region') startRegionSelect();
    else showResultView();
    return captured;
  } finally {
    state.capturing = false;
    refreshChrome();
  }
}

async function openImageFile(filePath) {
  if (!filePath) return null;
  const res = await openImageBuffer(filePath);
  if (!res || !res.width || !res.height) {
    toast(`Could not open image: ${(res && res.error) || filePath}`, { error: true });
    return null;
  }
  state.image = { width: res.width, height: res.height, channels: 4, pixels: res.pixels };
  state.annotations = [];
  state.undoStack = [];
  state.redoStack = [];
  state.lastSavedPath = filePath;
  showResultView();
  return state.image;
}

async function pickAndOpenImage() {
  const filter = 'Images|png;jpg;jpeg;webp;bmp;gif;avif;tif;tiff';
  const picked = typeof showOpenFileDialogAsync === 'function'
    ? await showOpenFileDialogAsync(filter, false)
    : (typeof showOpenFileDialog === 'function' ? showOpenFileDialog(filter, false) : []);
  if (picked && picked.length) await openImageFile(picked[0]);
}

async function pickSaveFolder() {
  const cur = getSaveFolder(settings) || homeDir();
  const picked = typeof showOpenFolderDialogAsync === 'function'
    ? await showOpenFolderDialogAsync(cur, false)
    : (typeof showOpenFolderDialog === 'function' ? showOpenFolderDialog(cur, false) : []);
  if (picked && picked.length) {
    settings.set('saveFolder', picked[0]);
    refreshChrome();
  }
}

async function saveScreenshot() {
  const p = await saveScreenshotToFolder({ state, settings });
  refreshChrome();
  return p;
}

async function saveScreenshotAs() {
  const p = await saveScreenshotAsDialog({ state, settings });
  refreshChrome();
  return p;
}

async function copyScreenshot() {
  const ok = await copyScreenshotToClipboard({ state, settings });
  refreshChrome();
  return ok;
}

function refreshChrome() {
  state.captureAvailable = hasCaptureAvailable();
  const mode = settings.get('mode') || 'full';
  for (const [id, card] of modeCards) card.classList.toggle('active', id === mode);
  unavailBox.classList.toggle('hidden', state.captureAvailable);
  takeHomeBtn.disabled = !state.captureAvailable || state.capturing;
  folderPathLabel.textContent = getSaveFolder(settings);

  const activeColor = (settings.get('color') || '#ef4444').toLowerCase();
  for (const [hex, btn] of swatchButtons) btn.classList.toggle('active', hex === activeColor);
  strokeSeg.set(settings.get('strokeWidth') || 4);
  delaySeg.set(settings.get('delay') || 0);
  pointerSwitch.set(settings.get('includePointer'));
  formatSeg.set(settings.get('format') || 'png');

  toolbar.refresh();
  toolToolbar.refresh();

  if (state.view === 'region' && state.image) {
    const r = state.regionRect;
    statusText.textContent = r && r.w > 0 && r.h > 0
      ? `Region: ${r.w} × ${r.h} px at (${r.x}, ${r.y})`
      : 'Drag to select a region';
    statusRight.textContent = `${state.image.width} × ${state.image.height} px`;
  } else if (state.view === 'result' && state.image) {
    const n = state.annotations.length;
    statusText.textContent = `${state.image.width} × ${state.image.height} px` +
      (n ? ` · ${n} annotation${n === 1 ? '' : 's'}` : '');
    statusRight.textContent = state.lastSavedPath ? path.basename(state.lastSavedPath) : 'Unsaved';
  } else {
    statusText.textContent = state.captureAvailable
      ? 'Ready to capture'
      : 'Screen capture unavailable — open an image to annotate';
    statusRight.textContent = '';
  }
}

refreshChrome();

async function handleLaunch({ argv = [], cwd = '' } = {}) {
  let delayOverride = null;
  for (const arg of argv) {
    if (arg.startsWith('--delay=')) {
      const n = Number(arg.slice('--delay='.length));
      if (Number.isFinite(n) && n >= 0) delayOverride = n;
    }
  }
  if (argv.includes('--full')) return await takeScreenshot('full', { delayOverride, autoSaveAndQuit: true });
  if (argv.includes('--region')) return await takeScreenshot('region', { delayOverride });
  const target = argv.find((a) => !a.startsWith('-'));
  if (target) return await openImageFile(path.resolve(cwd || '.', target));
  return null;
}

app.onLaunch((info) => { handleLaunch(info); });

app.expose({
  state, settings, commands, hasScreencopy, hasCaptureAvailable, setCaptureSource,
  createSyntheticSource, takeScreenshot, openImageFile, startRegionSelect, setRegionRect,
  nudgeRegion, confirmRegion, cancelRegion, setTool, addAnnotation, undo, redo,
  clearAnnotations, saveScreenshot, saveScreenshotAs, copyScreenshot, formatFilename,
  handleLaunch,
  renderFlattenedPixels: (img = state.image, anns = state.annotations) => renderFlattenedPixels(img, anns),
});
