/**
 * Disks (`helm.disks`): inspect physical drives, partition layouts, and
 * mounted volumes, with one-click handoff to Files (`helm.files`) and Disk
 * Usage (`helm.diskusage`). On Linux, through `bro.sys.disks` (UDisks2):
 * mount and unmount filesystems, eject or power off drives, and a SMART
 * health panel.
 */

import { startApp } from '/lib/app.js';
import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar, emptyState } from '/lib/layout.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { confirmDialog } from '/lib/dialog.js';
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
  annotateWithUDisks,
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
  busy: '',              // the UDisks action running, '' when none
  smart: new Map(),      // UDisks drive id -> { loading, data, error }
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
const btnEject = h('button.btn.small.disks-btn-eject.hidden', {
  onclick: () => commands.run('eject'),
}, icon('upload'), 'Eject');
const btnPowerOff = h('button.btn.small.disks-btn-poweroff.hidden', {
  onclick: () => commands.run('power-off'),
}, icon('power'), 'Power Off');

const driveCard = h('div.card.disks-drive-card',
  h('div.disks-drive-top',
    driveGlyph,
    h('div.disks-drive-meta', driveTitleEl, driveSubEl),
    h('div.disks-drive-badges', driveMediaBadge, driveRoBadge, btnEject, btnPowerOff)),
  h('div.disks-drive-metrics',
    h('div.disks-metric', h('span.micro', 'CAPACITY'), mCapVal, mCapSub),
    h('div.disks-metric', h('span.micro', 'USED SPACE'), mUsedVal, mUsedSub),
    h('div.disks-metric', h('span.micro', 'PARTITIONS'), mPartVal, mPartSub),
    h('div.disks-metric', h('span.micro', 'I/O ACTIVITY'), mIoRate, mIoTotal)));

// Drive health (SMART through UDisks2) card
const healthBadge = h('span.badge.disks-health-badge');
const healthSub = h('span.dim.num.disks-health-sub');
const healthRefresh = h('button.icon-btn.small.disks-health-refresh', {
  'data-tip': 'Read SMART Again',
  onclick: () => commands.run('refresh-health'),
}, icon('refresh', 'sm'));
const healthMsg = h('div.dim.disks-health-msg.hidden');
const healthWarn = h('div.disks-health-warn.hidden');
const hTemp = h('span.disks-stat-val.num.disks-health-temp');
const hHours = h('span.disks-stat-val.num.disks-health-hours');
const hWearLabel = h('span.micro', 'WEAR');
const hWear = h('span.disks-stat-val.num.disks-health-wear');
const hSpareLabel = h('span.micro', 'AVAILABLE SPARE');
const hSpare = h('span.disks-stat-val.num.disks-health-spare');
const hWritten = h('span.disks-stat-val.num.disks-health-written');
const hShutdowns = h('span.disks-stat-val.num.disks-health-shutdowns');
const hCycles = h('span.disks-stat-val.num.disks-health-cycles');
const hErrorsLabel = h('span.micro', 'MEDIA ERRORS');
const hErrors = h('span.disks-stat-val.num.disks-health-errors');
const healthGrid = h('div.disks-stat-grid.disks-health-grid',
  h('div.disks-stat-cell', h('span.micro', 'TEMPERATURE'), hTemp),
  h('div.disks-stat-cell', h('span.micro', 'POWER-ON TIME'), hHours),
  h('div.disks-stat-cell', hWearLabel, hWear),
  h('div.disks-stat-cell', hSpareLabel, hSpare),
  h('div.disks-stat-cell', h('span.micro', 'DATA WRITTEN'), hWritten),
  h('div.disks-stat-cell', h('span.micro', 'UNSAFE SHUTDOWNS'), hShutdowns),
  h('div.disks-stat-cell', h('span.micro', 'POWER CYCLES'), hCycles),
  h('div.disks-stat-cell', hErrorsLabel, hErrors));
const healthCard = h('div.card.disks-health-card.hidden',
  h('div.disks-section-head',
    h('span.micro', 'HEALTH'), healthBadge, healthSub, h('span.grow'), healthRefresh),
  healthWarn, healthMsg, healthGrid);

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
const btnMount = h('button.btn.disks-btn-mount.hidden', {
  onclick: () => commands.run('mount'),
}, icon('link'), 'Mount');
const btnUnmount = h('button.btn.disks-btn-unmount.hidden', {
  onclick: () => commands.run('unmount'),
}, icon('stop'), 'Unmount');

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
    h('div.disks-part-actions', btnMount, btnUnmount, btnOpenFiles, btnAnalyze, btnCopyMount)),
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

const mainPane = h('div.scroll.disks-main.hidden', driveCard, healthCard, mapCard, partCard);
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
  { id: 'mount', label: 'Mount', icon: 'link',
    enabled: () => !state.busy && Boolean(currentPartition()?.canMount), run: () => mountPartition() },
  { id: 'unmount', label: 'Unmount', icon: 'stop',
    enabled: () => !state.busy && Boolean(currentPartition()?.canUnmount), run: () => unmountPartition() },
  { id: 'eject', label: 'Eject', icon: 'upload',
    enabled: () => !state.busy && Boolean(currentDrive()?.udisks?.ejectable), run: () => ejectDrive() },
  { id: 'power-off', label: 'Power Off Drive', icon: 'power',
    enabled: () => !state.busy && Boolean(currentDrive()?.udisks?.canPowerOff), run: () => powerOffDrive() },
  { id: 'refresh-health', label: 'Read SMART Again', icon: 'activity',
    enabled: () => Boolean(currentDrive()?.udisks?.smartSupported), run: () => loadHealth(currentDrive(), true) },
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
  loadHealth(drive, false);
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
  btnEject.classList.toggle('hidden', !drive.udisks?.ejectable);
  btnPowerOff.classList.toggle('hidden', !drive.udisks?.canPowerOff);
  btnEject.disabled = Boolean(state.busy);
  btnPowerOff.disabled = Boolean(state.busy);

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
  btnMount.classList.toggle('hidden', !part.canMount);
  btnUnmount.classList.toggle('hidden', !part.canUnmount);
  btnMount.disabled = Boolean(state.busy);
  btnUnmount.disabled = Boolean(state.busy);

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

const ASSESSMENT = {
  good: ['badge ok', 'Healthy'],
  warning: ['badge warn', 'Warning'],
  failing: ['badge danger', 'Failing'],
  unknown: ['badge', 'Unknown'],
};

const WARNING_TEXT = {
  spare: 'available spare below threshold',
  temperature: 'temperature over its limit',
  degraded: 'reliability degraded',
  readonly: 'media placed in read-only mode',
  volatile_mem: 'volatile memory backup failed',
  pmr_readonly: 'persistent memory region read-only',
};

function orDash(v, fmt = String) {
  return v === null || v === undefined ? '—' : fmt(v);
}

function formatHours(hours) {
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return days < 730 ? `${days} days (${hours} h)` : `${(days / 365).toFixed(1)} years (${hours} h)`;
}

function renderHealth(drive) {
  const ud = drive.udisks;
  if (!ud || !ud.smartSupported) {
    healthCard.classList.add('hidden');
    return;
  }
  healthCard.classList.remove('hidden');
  const entry = state.smart.get(ud.id);
  const s = entry && entry.data;
  healthRefresh.disabled = Boolean(entry && entry.loading);
  if (!s) {
    healthBadge.className = 'badge disks-health-badge';
    healthBadge.textContent = entry && entry.error ? 'Unavailable' : 'Reading…';
    healthSub.textContent = ud.smartKind === 'nvme' ? 'NVMe' : ud.smartKind === 'ata' ? 'ATA SMART' : '';
    healthMsg.textContent = entry && entry.error ? `Could not read SMART: ${entry.error}` : 'Reading SMART data…';
    healthMsg.classList.remove('hidden');
    healthWarn.classList.add('hidden');
    healthGrid.classList.add('hidden');
    return;
  }
  const [cls, text] = ASSESSMENT[s.assessment] || ASSESSMENT.unknown;
  healthBadge.className = `${cls} disks-health-badge`;
  healthBadge.textContent = text;
  const kind = s.kind === 'nvme' ? 'NVMe' : 'ATA SMART';
  healthSub.textContent = s.updated ? `${kind} • read ${new Date(s.updated).toLocaleTimeString()}` : kind;
  healthMsg.classList.add('hidden');
  healthGrid.classList.remove('hidden');

  const warnings = (s.criticalWarnings || []).map((w) => WARNING_TEXT[w] || w);
  if (s.kind === 'ata' && s.badSectors > 0) warnings.push(`${formatCount(s.badSectors, 'bad sector')}`);
  if (s.kind === 'ata' && s.failing) warnings.push('the drive predicts its own failure');
  healthWarn.textContent = warnings.length ? `⚠ ${warnings.join(' • ')}` : '';
  healthWarn.classList.toggle('hidden', warnings.length === 0);

  hTemp.textContent = orDash(s.temperatureC, (t) => `${Math.round(t)} °C`);
  hHours.textContent = orDash(s.powerOnHours, formatHours);
  if (s.kind === 'nvme') {
    hWearLabel.textContent = 'WEAR';
    hWear.textContent = orDash(s.percentUsed, (p) => `${p}% used`);
    hSpareLabel.textContent = 'AVAILABLE SPARE';
    hSpare.textContent = orDash(s.availableSpare, (p) => `${p}%${s.spareThreshold != null ? ` (min ${s.spareThreshold}%)` : ''}`);
    hErrorsLabel.textContent = 'MEDIA ERRORS';
    hErrors.textContent = orDash(s.mediaErrors, (n) => String(n));
  } else {
    hWearLabel.textContent = 'BAD SECTORS';
    hWear.textContent = orDash(s.badSectors, (n) => String(n));
    hSpareLabel.textContent = 'SELF-TEST';
    hSpare.textContent = s.selftestStatus || '—';
    hErrorsLabel.textContent = 'FAILING ATTRIBUTES';
    hErrors.textContent = String((s.attributes || []).filter((a) => a.failing).length);
  }
  hWritten.textContent = orDash(s.bytesWritten, formatBytes);
  hShutdowns.textContent = orDash(s.unsafeShutdowns, (n) => String(n));
  hCycles.textContent = orDash(s.powerCycles, (n) => String(n));
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
  renderHealth(drive);
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

/**
 * Run one UDisks action: the buttons disable while it runs, a refusal (polkit,
 * a busy filesystem) is a toast with UDisks' message, and the view refreshes
 * after. Resolves with the action's value, or null when it failed.
 */
async function runDiskAction(label, failText, fn) {
  if (state.busy) return null;
  state.busy = label;
  renderAll();
  try {
    return await fn();
  } catch (err) {
    toast(`${failText}: ${err && err.message ? err.message : err}`, { error: true, key: 'disk-action' });
    return null;
  } finally {
    state.busy = '';
    await refresh();
  }
}

async function mountPartition() {
  const part = currentPartition();
  const ud = model.disks();
  if (!ud || !part || !part.canMount) return null;
  const where = await runDiskAction('mount', `Could not mount ${part.device}`, () => ud.mount(part.block.id));
  if (where) toast(`Mounted ${part.label || part.device} at ${where}`, { icon: 'link', key: 'disk-action' });
  return where;
}

async function unmountPartition() {
  const part = currentPartition();
  const ud = model.disks();
  if (!ud || !part || !part.canUnmount) return false;
  const ok = await runDiskAction('unmount', `Could not unmount ${part.device}`,
    () => ud.unmount(part.block.id).then(() => true));
  if (ok) toast(`Unmounted ${part.label || part.device}`, { icon: 'stop', key: 'disk-action' });
  return Boolean(ok);
}

async function ejectDrive() {
  const drive = currentDrive();
  const ud = model.disks();
  if (!ud || !drive || !drive.udisks?.ejectable) return false;
  const ok = await runDiskAction('eject', `Could not eject ${drive.title}`,
    () => ud.eject(drive.udisks.id).then(() => true));
  if (ok) toast(`Ejected ${drive.title}`, { icon: 'upload', key: 'disk-action' });
  return Boolean(ok);
}

async function powerOffDrive() {
  const drive = currentDrive();
  const ud = model.disks();
  if (!ud || !drive || !drive.udisks?.canPowerOff) return false;
  const yes = await confirmDialog({
    title: `Power off ${drive.title}?`,
    body: 'Its mounted filesystems are unmounted first. Once it is off it can be unplugged safely.',
    ok: 'Power Off',
    icon: 'power',
  });
  if (!yes) return false;
  const ok = await runDiskAction('power-off', `Could not power off ${drive.title}`,
    () => ud.powerOff(drive.udisks.id).then(() => true));
  if (ok) toast(`${drive.title} is powered off`, { icon: 'power', key: 'disk-action' });
  return Boolean(ok);
}

/** Read SMART for `drive` (once per drive unless `force`), then re-render it if shown. */
async function loadHealth(drive, force) {
  const ud = model.disks();
  const id = drive && drive.udisks && drive.udisks.smartSupported ? drive.udisks.id : '';
  if (!ud || !id) return null;
  const have = state.smart.get(id);
  if (have && (have.loading || (!force && (have.data || have.error)))) return have.data || null;
  const entry = { loading: true, data: have ? have.data : null, error: '' };
  state.smart.set(id, entry);
  if (currentDrive()?.udisks?.id === id) renderHealth(currentDrive());
  try {
    entry.data = await ud.smart(id);
  } catch (err) {
    entry.error = err && err.message ? err.message : String(err);
  }
  entry.loading = false;
  const cur = currentDrive();
  if (cur && cur.udisks?.id === id) renderHealth(cur);
  return entry.data;
}

function showContextMenu(e) {
  const part = currentPartition();
  const drive = currentDrive();
  menu.show([
    part ? { heading: part.label || part.name } : null,
    part?.canMount ? commands.item('mount') : null,
    part?.canUnmount ? commands.item('unmount') : null,
    commands.item('open-files'),
    commands.item('analyze-usage'),
    commands.item('copy-mount'),
    drive?.udisks?.ejectable || drive?.udisks?.canPowerOff ? { separator: true } : null,
    drive?.udisks?.ejectable ? commands.item('eject') : null,
    drive?.udisks?.canPowerOff ? commands.item('power-off') : null,
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
  loadHealth(currentDrive(), false);
  return drives;
}

// UDisks reports drives and filesystems coming and going (a stick plugged in,
// a mount made elsewhere): refresh on the next frame after a burst of changes.
let watchedDisks = null;
let changeQueued = false;
function onDisksChange() {
  if (changeQueued) return;
  changeQueued = true;
  requestAnimationFrame(() => {
    changeQueued = false;
    refresh();
  });
}

function watchDisks() {
  const ud = model.disks();
  if (ud === watchedDisks) return;
  if (watchedDisks && typeof watchedDisks.off === 'function') watchedDisks.off('change', onDisksChange);
  watchedDisks = ud;
  if (ud && typeof ud.on === 'function') ud.on('change', onDisksChange);
}

/** Use `ns` (bro.sys.disks's shape) for UDisks2; null for none, undefined for the real one. */
function setDisks(ns) {
  model.setDisks(ns);
  state.smart.clear();
  watchDisks();
  return refresh();
}

// ---- launch & expose --------------------------------------------------------

watchDisks();
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
  setDisks,
  mountPartition,
  unmountPartition,
  ejectDrive,
  powerOffDrive,
  loadHealth,
  parsers: {
    parseProcMounts,
    parseProcPartitions,
    parseProcDiskstats,
    computeDiskIoRates,
    classifyDriveMedia,
    groupVolumesAndBlockDevices,
    annotateWithUDisks,
  },
});
