/**
 * Disks (`helm.disks`): inspect physical drives, partition layouts, and
 * mounted volumes, with one-click handoff to Files (`helm.files`) and Disk
 * Usage (`helm.diskusage`).
 */

import { startApp } from '/lib/app.js';
import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, emptyState } from '/lib/layout.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { Progress } from '/lib/controls.js';
import { formatBytes, formatCount, formatPercent } from '/lib/format.js';
import { openApp } from '/lib/files.js';
import {
  DisksModel,
  parseProcMounts,
  parseProcPartitions,
  parseProcDiskstats,
  computeDiskIoRates,
  classifyDriveMedia,
  groupVolumesAndBlockDevices,
} from './disks-model.js';

const app = startApp({
  settings: {
    lastDriveId: { type: 'string', default: '' },
    lastPartitionId: { type: 'string', default: '' },
  },
});
const { commands, settings } = app;
const model = new DisksModel();

// ---- state ------------------------------------------------------------------

const state = {
  drives: [],
  filteredDrives: [],
  selectedDriveId: '',
  selectedPartitionId: '',
  filter: '',
  loading: true,
  refreshSeq: 0,
};

function currentDrive() {
  return state.filteredDrives.find((d) => d.id === state.selectedDriveId) || null;
}

function currentPartition() {
  const drive = currentDrive();
  if (!drive) return null;
  return drive.segments.find((p) => p.id === state.selectedPartitionId) || drive.segments[0] || null;
}

// ---- the window (built synchronously before any I/O) ------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const sidebar = new Sidebar({
  onSelect: (item) => selectDrive(item.id),
  onContextMenu: (e, item) => {
    selectDrive(item.id);
    showContextMenu(e);
  },
});
ui.sidebar.appendChild(sidebar.el);

const searchInput = h('input', {
  type: 'text',
  placeholder: 'Filter drives & volumes…',
  'aria-label': 'Filter drives & volumes',
  oninput: () => setFilter(searchInput.value),
});
const clearBtn = h('button.icon-btn.small.hidden', {
  'data-tip': 'Clear Filter',
  onclick: () => setFilter(''),
}, icon('x'));
const searchField = h('div.search-field', icon('search'), searchInput, clearBtn);

const statusLeft = h('span.grow');
const statusRight = h('span.num.dim');
ui.statusbar.append(statusLeft, statusRight);

// Pre-built Drive Header Card nodes (updated in-place without recreating DOM)
const driveGlyph = h('div.disks-drive-glyph', icon('hard-drive', 'lg'));
let currentDriveIcon = 'hard-drive';
const driveTitleEl = h('div.head.ellipsis.disks-drive-title');
const driveSubEl = h('div.dim.num.disks-drive-sub');
const driveMediaBadge = h('span.badge.accent.disks-media-badge');
const driveRoBadge = h('span.badge.warn.hidden', 'Read-Only');
const mCapVal = h('span.disks-metric-val.num');
const mCapSub = h('span.dim.num');
const mUsedVal = h('span.disks-metric-val.num');
const mUsedSub = h('span.dim.num');
const mPartVal = h('span.disks-metric-val.num');
const mPartSub = h('span.dim');
const mIoRate = h('span.disks-metric-val.num.disks-drive-io-rate');
const mIoTotal = h('span.dim.num.disks-drive-io-total');

const driveCard = h('div.card.disks-drive-card',
  h('div.disks-drive-top',
    driveGlyph,
    h('div.disks-drive-meta', driveTitleEl, driveSubEl),
    h('div.disks-drive-badges', driveMediaBadge, driveRoBadge)),
  h('div.disks-drive-metrics',
    h('div.disks-metric', h('span.micro', 'CAPACITY'), mCapVal, mCapSub),
    h('div.disks-metric', h('span.micro', 'USED SPACE'), mUsedVal, mUsedSub),
    h('div.disks-metric', h('span.micro', 'PARTITIONS'), mPartVal, mPartSub),
    h('div.disks-metric', h('span.micro', 'I/O ACTIVITY'), mIoRate, mIoTotal)));

// Visual Partition Layout Map card
const mapBar = h('div.disks-map-bar', { role: 'listbox', 'aria-label': 'Partition layout' });
const mapSub = h('span.dim.num');
const mapCard = h('div.card.disks-map-card',
  h('div.disks-section-head', h('span.micro', 'PARTITION LAYOUT'), mapSub),
  mapBar);

// Pre-built Partition Details Card nodes
const partTitleEl = h('div.title.ellipsis.disks-part-title');
const partFsBadge = h('span.badge.accent.disks-part-fs');
const partStatusBadge = h('span.badge');
const partRoBadge = h('span.badge.warn.hidden', 'Read-Only');
const btnOpenFiles = h('button.btn.primary.disks-btn-open', {
  onclick: () => commands.run('open-files'),
}, icon('folder-open'), 'Open in Files');
const btnAnalyze = h('button.btn.disks-btn-analyze', {
  onclick: () => commands.run('analyze-usage'),
}, icon('pie-chart'), 'Analyze in Disk Usage');
const btnCopyMount = h('button.btn.disks-btn-copy', {
  onclick: () => commands.run('copy-mount'),
}, icon('copy'), 'Copy Mount Path');

const partProgress = new Progress(0);
const stTotal = h('span.disks-stat-val.num.disks-stat-total');
const stUsed = h('span.disks-stat-val.num.disks-stat-used');
const stFree = h('span.disks-stat-val.num.disks-stat-free');
const stAvail = h('span.disks-stat-val.num.disks-stat-avail');

const mountLinkText = h('span');
const mountLinkBtn = h('button.btn.ghost.small.disks-mount-link.mono', {
  'data-tip': 'Open in Files',
  onclick: () => commands.run('open-files'),
}, icon('folder-open', 'sm'), mountLinkText);
const mountNoneEl = h('span.dim.disks-mount-none.hidden', 'Not mounted');
const propDeviceEl = h('span.mono.selectable.disks-prop-device');
const propFsEl = h('span.mono.disks-prop-fs');
const propReadEl = h('span.num.disks-prop-read');
const propWriteEl = h('span.num.disks-prop-write');

function propRow(label, sub, ...controlEls) {
  return h('div.form-row',
    h('div.form-label', h('span', label), sub ? h('span.dim', sub) : null),
    h('div.form-control', ...controlEls));
}

const partCard = h('div.card.disks-part-card',
  h('div.disks-part-head',
    h('div.disks-part-title-wrap', partTitleEl, partFsBadge, partStatusBadge, partRoBadge),
    h('div.disks-part-actions', btnOpenFiles, btnAnalyze, btnCopyMount)),
  h('div.disks-part-usage',
    partProgress.el,
    h('div.disks-stat-grid',
      h('div.disks-stat-cell', h('span.micro', 'TOTAL CAPACITY'), stTotal),
      h('div.disks-stat-cell', h('span.micro', 'USED'), stUsed),
      h('div.disks-stat-cell', h('span.micro', 'FREE'), stFree),
      h('div.disks-stat-cell', h('span.micro', 'AVAILABLE'), stAvail))),
  h('div.group-rows.disks-prop-rows',
    propRow('Mount Point', 'Directory where this volume is attached', mountLinkBtn, mountNoneEl),
    propRow('Device Identifier', 'Block device node or volume root', propDeviceEl),
    propRow('Filesystem', 'Volume format and mount flags', propFsEl),
    propRow('I/O Read Activity', 'Live throughput and cumulative bytes read', propReadEl),
    propRow('I/O Write Activity', 'Live throughput and cumulative bytes written', propWriteEl)));

const mainPane = h('div.scroll.disks-main.hidden', driveCard, mapCard, partCard);
const emptyView = emptyState({
  icon: 'hard-drive',
  title: 'No drives found',
  hint: 'No matching block devices or mounted volumes are available.',
});
emptyView.classList.add('hidden');
ui.content.append(mainPane, emptyView);

// ---- commands & toolbar -----------------------------------------------------

commands.addAll([
  { id: 'refresh', label: 'Refresh', icon: 'refresh', keys: ['F5', 'Mod+R'], run: () => refresh() },
  { id: 'open-files', label: 'Open in Files', icon: 'folder-open', keys: ['Mod+O'],
    enabled: () => Boolean(currentPartition()?.mountPoint), run: () => openInFiles() },
  { id: 'analyze-usage', label: 'Analyze in Disk Usage', icon: 'pie-chart', keys: ['Mod+U'],
    enabled: () => Boolean(currentPartition()?.mountPoint), run: () => analyzeInDiskUsage() },
  { id: 'copy-mount', label: 'Copy Mount Path', icon: 'copy', keys: ['Mod+Shift+C'],
    enabled: () => Boolean(currentPartition()?.mountPoint || currentPartition()?.device), run: () => copyMountPath() },
  { id: 'find', label: 'Filter Drives & Volumes', icon: 'search', keys: ['Mod+F'], inText: true,
    run: () => { searchInput.focus(); searchInput.select(); } },
  { id: 'clear-filter', label: 'Clear Filter', keys: ['Escape'], inText: true,
    enabled: () => state.filter.length > 0 || document.activeElement === searchInput,
    run: () => {
      if (state.filter) setFilter('');
      if (document.activeElement === searchInput) searchInput.blur();
    } },
  { id: 'prev-partition', label: 'Previous Partition', keys: ['ArrowLeft'],
    enabled: () => (currentDrive()?.segments.length || 0) > 1, run: () => stepPartition(-1) },
  { id: 'next-partition', label: 'Next Partition', keys: ['ArrowRight'],
    enabled: () => (currentDrive()?.segments.length || 0) > 1, run: () => stepPartition(1) },
  { id: 'new-window', label: 'New Window', keys: ['Mod+N'], run: () => app.newWindow() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

toolbar.button('refresh');
toolbar.sep();
toolbar.button('open-files', { label: true });
toolbar.button('analyze-usage', { label: true });
toolbar.button('copy-mount');
toolbar.spacer();
toolbar.add(searchField);

// ---- filtering & selection --------------------------------------------------

function matchesDriveOrPart(drive, q) {
  if (!q) return true;
  const hayDrive = `${drive.name} ${drive.title} ${drive.model} ${drive.vendor} ${drive.device} ${drive.mediaType}`.toLowerCase();
  if (hayDrive.includes(q)) return true;
  return drive.segments.some((p) => matchesPart(p, q));
}

function matchesPart(p, q) {
  if (!q) return true;
  const hay = `${p.name} ${p.label} ${p.volumeLabel} ${p.device} ${p.mountPoint} ${p.fsType}`.toLowerCase();
  return hay.includes(q);
}

function applyFilter() {
  const q = state.filter.trim().toLowerCase();
  state.filteredDrives = q ? state.drives.filter((d) => matchesDriveOrPart(d, q)) : [...state.drives];

  if (!state.filteredDrives.some((d) => d.id === state.selectedDriveId)) {
    const saved = settings.get('lastDriveId');
    const pick = state.filteredDrives.find((d) => d.id === saved) || state.filteredDrives[0] || null;
    state.selectedDriveId = pick ? pick.id : '';
  }

  const drive = currentDrive();
  if (drive) {
    if (q && !matchesPart(currentPartition() || {}, q)) {
      const matchingPart = drive.segments.find((p) => matchesPart(p, q));
      if (matchingPart) state.selectedPartitionId = matchingPart.id;
    }
    if (!drive.segments.some((p) => p.id === state.selectedPartitionId)) {
      const savedPart = settings.get('lastPartitionId');
      const pickPart = drive.segments.find((p) => p.id === savedPart) || drive.segments[0] || null;
      state.selectedPartitionId = pickPart ? pickPart.id : '';
    }
  } else {
    state.selectedPartitionId = '';
  }
}

function setFilter(q) {
  const next = String(q || '');
  if (searchInput.value !== next) searchInput.value = next;
  state.filter = next;
  clearBtn.classList.toggle('hidden', !next);
  applyFilter();
  renderAll();
}

function selectDrive(driveId) {
  const drive = state.filteredDrives.find((d) => d.id === driveId);
  if (!drive) return;
  state.selectedDriveId = drive.id;
  settings.set('lastDriveId', drive.id);
  if (!drive.segments.some((p) => p.id === state.selectedPartitionId)) {
    const first = drive.segments[0] || null;
    state.selectedPartitionId = first ? first.id : '';
    if (first) settings.set('lastPartitionId', first.id);
  }
  sidebar.select(drive.id);
  renderDetail();
  toolbar.refresh();
  updateStatus();
}

function selectPartition(partId) {
  const drive = currentDrive();
  if (!drive) return;
  const seg = drive.segments.find((p) => p.id === partId);
  if (!seg) return;
  state.selectedPartitionId = seg.id;
  settings.set('lastPartitionId', seg.id);
  for (const el of mapBar.querySelectorAll('.disks-map-seg')) {
    el.classList.toggle('selected', el.dataset.segmentId === seg.id);
    el.setAttribute('aria-selected', String(el.dataset.segmentId === seg.id));
  }
  renderPartitionCard(drive, seg);
  toolbar.refresh();
  updateStatus();
}

function stepPartition(delta) {
  const drive = currentDrive();
  if (!drive || drive.segments.length < 2) return;
  const idx = Math.max(0, drive.segments.findIndex((p) => p.id === state.selectedPartitionId));
  const nextIdx = (idx + delta + drive.segments.length) % drive.segments.length;
  selectPartition(drive.segments[nextIdx].id);
}

// ---- rendering --------------------------------------------------------------

function renderSidebar() {
  const items = state.filteredDrives.map((d) => ({
    id: d.id,
    label: `${d.title} (${d.name})`,
    icon: d.icon,
    sub: `${formatBytes(d.availableBytes)} free of ${formatBytes(d.sizeBytes)}`,
    meter: d.usedPct,
    title: `${d.title} — ${d.device} (${d.mediaType})`,
  }));
  sidebar.setSections([{ title: 'Drives & Volumes', items }]);
  sidebar.select(state.selectedDriveId);
}

function renderDriveCard(drive) {
  if (currentDriveIcon !== drive.icon) {
    currentDriveIcon = drive.icon;
    driveGlyph.replaceChildren(icon(drive.icon, 'lg'));
  }
  driveTitleEl.textContent = drive.title;
  driveSubEl.textContent = `${drive.device} • ${formatCount(drive.partitions.length, 'partition')}`;
  driveMediaBadge.textContent = drive.mediaType;
  driveRoBadge.classList.toggle('hidden', !drive.isReadOnly);

  mCapVal.textContent = formatBytes(drive.sizeBytes);
  mCapSub.textContent = drive.unallocatedBytes >= 1024 * 1024
    ? `${formatBytes(drive.unallocatedBytes)} unallocated`
    : 'Fully allocated';
  mUsedVal.textContent = `${formatBytes(drive.usedBytes)} (${formatPercent(drive.usedPct)})`;
  mUsedSub.textContent = `${formatBytes(drive.availableBytes)} available`;
  mPartVal.textContent = String(drive.partitions.length);
  mPartSub.textContent = `${drive.partitions.filter((p) => p.isMounted).length} mounted`;
  mIoRate.textContent = (drive.readBps > 0 || drive.writeBps > 0)
    ? `↓ ${formatBytes(drive.readBps)}/s  ↑ ${formatBytes(drive.writeBps)}/s`
    : 'Idle (0 B/s)';
  mIoTotal.textContent = `${formatBytes(drive.readBytes)} read • ${formatBytes(drive.writeBytes)} written`;
}

function renderMapCard(drive, selectedSeg) {
  mapSub.textContent = `${formatCount(drive.partitions.length, 'partition')} • ${formatBytes(drive.sizeBytes)}`;
  const total = Math.max(1, drive.sizeBytes);
  const segEls = drive.segments.map((seg) => {
    const ratio = Math.max(0.08, seg.sizeBytes / total);
    const isSel = selectedSeg && seg.id === selectedSeg.id;
    const cls = [
      'disks-map-seg',
      isSel ? 'selected' : '',
      seg.isUnallocated ? 'unallocated' : '',
      !seg.isMounted && !seg.isUnallocated ? 'unmounted' : '',
    ].filter(Boolean).join('.');

    const fsBadge = seg.isUnallocated
      ? h('span.badge.disks-seg-fs', 'free')
      : seg.fsType
        ? h('span.badge.disks-seg-fs', seg.fsType)
        : null;

    return h(`button.${cls}`, {
      role: 'option',
      'aria-selected': String(!!isSel),
      'data-segment-id': seg.id,
      'data-device': seg.device,
      'data-mount': seg.mountPoint || '',
      style: { flex: `${(ratio * 100).toFixed(2)} 1 0px` },
      onclick: () => selectPartition(seg.id),
      oncontextmenu: (e) => {
        e.preventDefault();
        selectPartition(seg.id);
        showContextMenu(e);
      },
    },
    h('div.disks-seg-top',
      h('span.disks-seg-name.ellipsis', seg.label || seg.name),
      fsBadge),
    h('div.disks-seg-mid.num',
      h('span.disks-seg-size', formatBytes(seg.sizeBytes)),
      seg.usedBytes != null && !seg.isUnallocated ? h('span.dim', formatPercent(seg.usedPct)) : null),
    h('div.disks-seg-mount.ellipsis.mono',
      seg.mountPoint || (seg.isUnallocated ? 'Unallocated' : 'Not mounted')),
    seg.isMounted
      ? h('div.disks-seg-meter',
        h('div.disks-seg-meter-fill', { style: { width: `${(seg.usedPct * 100).toFixed(1)}%` } }))
      : null);
  });
  mapBar.replaceChildren(...segEls);
}

function renderPartitionCard(drive, part) {
  if (!part) return;
  partProgress.set(part.isMounted ? part.usedPct : 0);

  partTitleEl.textContent = part.isUnallocated ? 'Unallocated Space' : `${part.label || part.name} (${part.device})`;
  const hasFs = Boolean(part.fsType && !part.isUnallocated);
  partFsBadge.classList.toggle('hidden', !hasFs);
  if (hasFs) partFsBadge.textContent = part.fsType;

  partStatusBadge.className = part.isMounted ? 'badge ok' : 'badge';
  partStatusBadge.textContent = part.isUnallocated ? 'Unallocated' : (part.isMounted ? 'Mounted' : 'Unmounted');
  partRoBadge.classList.toggle('hidden', !part.isReadOnly);

  btnOpenFiles.disabled = !part.mountPoint;
  btnAnalyze.disabled = !part.mountPoint;
  btnCopyMount.disabled = !(part.mountPoint || part.device);

  stTotal.textContent = formatBytes(part.sizeBytes);
  stUsed.textContent = part.usedBytes != null ? `${formatBytes(part.usedBytes)} (${formatPercent(part.usedPct)})` : '—';
  stFree.textContent = part.freeBytes != null ? formatBytes(part.freeBytes) : '—';
  stAvail.textContent = part.availableBytes != null ? formatBytes(part.availableBytes) : '—';

  if (part.mountPoint) {
    mountLinkText.textContent = part.mountPoint;
    mountLinkBtn.classList.remove('hidden');
    mountNoneEl.classList.add('hidden');
  } else {
    mountLinkBtn.classList.add('hidden');
    mountNoneEl.classList.remove('hidden');
  }

  propDeviceEl.textContent = part.device || '—';
  propFsEl.textContent = part.isUnallocated
    ? 'Unallocated'
    : `${part.fsType || 'Unknown'}${part.optionsText ? ` (${part.optionsText})` : ''}`;
  propReadEl.textContent = `${formatBytes(part.readBps || 0)}/s (${formatBytes(part.readBytes || 0)} total)`;
  propWriteEl.textContent = `${formatBytes(part.writeBps || 0)}/s (${formatBytes(part.writeBytes || 0)} total)`;
}

function renderDetail() {
  const drive = currentDrive();
  if (!drive) {
    mainPane.classList.add('hidden');
    emptyView.classList.remove('hidden');
    return;
  }
  emptyView.classList.add('hidden');
  mainPane.classList.remove('hidden');
  const part = currentPartition();
  app.setTitle(`${drive.title} — Disks`);
  renderDriveCard(drive);
  renderMapCard(drive, part);
  renderPartitionCard(drive, part);
}

function updateStatus() {
  const totalCap = state.filteredDrives.reduce((s, d) => s + d.sizeBytes, 0);
  const totalParts = state.filteredDrives.reduce((s, d) => s + d.partitions.length, 0);
  statusLeft.textContent = state.filteredDrives.length
    ? `${formatCount(state.filteredDrives.length, 'drive')}, ${formatCount(totalParts, 'partition')} (${formatBytes(totalCap)} total)`
    : (state.loading ? 'Scanning drives…' : 'No matching drives');
  const part = currentPartition();
  statusRight.textContent = part
    ? `${part.device}${part.mountPoint ? ` → ${part.mountPoint}` : ''}`
    : '';
}

function renderAll() {
  renderSidebar();
  renderDetail();
  toolbar.refresh();
  updateStatus();
}

// ---- actions ----------------------------------------------------------------

async function openInFiles() {
  const part = currentPartition();
  if (!part || !part.mountPoint) {
    toast('Partition is not mounted', { error: true });
    return false;
  }
  const ok = await openApp('helm.files', [part.mountPoint]);
  if (!ok) toast('The Files app is not available', { error: true });
  return ok;
}

async function analyzeInDiskUsage() {
  const part = currentPartition();
  if (!part || !part.mountPoint) {
    toast('Partition is not mounted', { error: true });
    return false;
  }
  const ok = await openApp('helm.diskusage', [part.mountPoint]);
  if (!ok) toast('The Disk Usage app is not available', { error: true });
  return ok;
}

async function copyMountPath() {
  const part = currentPartition();
  const target = part?.mountPoint || part?.device || '';
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target);
    toast(`Copied ${target}`, { icon: 'copy', key: 'copy-mount' });
  } catch (err) {
    toast(`Could not copy: ${err.message}`, { error: true });
  }
}

function showContextMenu(e) {
  const part = currentPartition();
  menu.show([
    part ? { heading: part.label || part.name } : null,
    commands.item('open-files'),
    commands.item('analyze-usage'),
    commands.item('copy-mount'),
    { separator: true },
    commands.item('refresh'),
  ], e.clientX, e.clientY);
}

async function refresh(nowMs = Date.now()) {
  const seq = ++state.refreshSeq;
  const drives = await model.refresh(nowMs);
  if (seq !== state.refreshSeq) return drives;
  state.loading = false;
  state.drives = drives;
  applyFilter();
  renderAll();
  return drives;
}

// ---- launch & expose --------------------------------------------------------

refresh();

app.onLaunch(({ argv, first }) => {
  if (argv.includes('--new-window') && !first) {
    app.newWindow();
    return;
  }
  const target = argv.find((a) => !a.startsWith('--'));
  if (target) setFilter(target);
});

app.expose({
  state,
  model,
  sidebar,
  selectDrive,
  selectPartition,
  setFilter,
  refresh,
  parsers: {
    parseProcMounts,
    parseProcPartitions,
    parseProcDiskstats,
    computeDiskIoRates,
    classifyDriveMedia,
    groupVolumesAndBlockDevices,
  },
});
