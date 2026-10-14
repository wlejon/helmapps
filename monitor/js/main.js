/**
 * System Monitor (helm.monitor): processes, live performance graphs, and file
 * systems.
 *
 * Follows docs/performance.md:
 *  - Builds and paints the full window synchronously before any disk or /proc
 *    I/O starts.
 *  - Uses async fs.promises and bro.vfs.volumes() on worker threads.
 *  - Redraws charts and virtual list once per sampler tick, never at 60 fps.
 */

import { startApp } from '/lib/app.js';
import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { appFrame, Toolbar, Sidebar } from '/lib/layout.js';
import { menu } from '/lib/menu.js';
import { toast } from '/lib/toast.js';
import { Select } from '/lib/controls.js';
import { formatBytes, formatCount } from '/lib/format.js';

import {
  Sampler,
  parseProcStat,
  computeCpuDelta,
  parseMeminfo,
  parseDiskstats,
  parseNetDev,
  parseLoadavg,
  parseUptime,
  parseCpuinfoModel,
  parsePidStat,
  parsePidStatus,
  parsePidCmdline,
  computeProcCpuPct,
} from './sampler.js';
import { ProcessesView } from './processes-view.js';
import { ResourcesView } from './resources-view.js';
import { FilesystemsView } from './filesystems-view.js';

const app = startApp({
  settings: {
    interval: { type: 'double', default: 1.0 },
    page: { type: 'string', default: 'processes' },
    sort: { type: 'json', default: { id: 'cpu', dir: -1 } },
    treeMode: { type: 'bool', default: false },
    perCore: { type: 'bool', default: false },
    columns: { type: 'json', default: {} },
  },
});

const { commands, settings } = app;

const state = {
  page: settings.get('page') || 'processes',
  root: '/',
  tickCount: 0,
};

// ---- the window (built synchronously before any I/O) --------------------------

const ui = appFrame({ toolbar: true, sidebar: true, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const sidebar = new Sidebar({ onSelect: (item) => setPage(item.id) });
sidebar.setSections([
  {
    title: 'Monitor',
    items: [
      { id: 'processes', label: 'Processes', icon: 'list' },
      { id: 'performance', label: 'Performance', icon: 'activity' },
      { id: 'filesystems', label: 'File Systems', icon: 'hard-drive' },
    ],
  },
]);
ui.sidebar.appendChild(sidebar.el);

const statusLeft = h('span.grow.num', 'Starting…');
const statusRight = h('span.num.dim', '');
ui.statusbar.append(statusLeft, statusRight);

// ---- views --------------------------------------------------------------------

const processesView = new ProcessesView({
  settings,
  commands,
  onContextMenu: (e, items) => showProcessContextMenu(e, items),
  onSelectionChange: () => {
    toolbar.refresh();
    updateStatusBar();
  },
});

const resourcesView = new ResourcesView({ settings });
const filesystemsView = new FilesystemsView();

ui.content.append(processesView.el, resourcesView.el, filesystemsView.el);

// ---- sampler ------------------------------------------------------------------

const sampler = new Sampler({
  root: state.root,
  intervalSec: settings.get('interval') || 1.0,
  onTick: () => onSampleTick(),
});

function onSampleTick() {
  state.tickCount = sampler.tickCount;
  processesView.update(sampler.proc);
  resourcesView.update(sampler.sys);
  updateStatusBar();
  toolbar.refresh();
}

function updateStatusBar() {
  const sys = sampler.sys;
  const proc = sampler.proc;
  const sel = processesView.selectedItems();

  if (state.page === 'processes') {
    if (!proc.supported) {
      statusLeft.textContent = 'Process data on this platform needs bro support';
    } else if (sel.length > 0) {
      const sumMem = sel.reduce((acc, p) => acc + (p.memory || 0), 0);
      statusLeft.textContent = `${formatCount(sel.length, 'process', 'processes')} selected (${formatBytes(sumMem)})`;
    } else {
      const shown = processesView.list.items.length;
      const total = proc.processes.length;
      statusLeft.textContent = shown !== total
        ? `Showing ${shown} of ${formatCount(total, 'process', 'processes')}`
        : formatCount(total, 'process', 'processes');
    }
  } else if (state.page === 'filesystems') {
    statusLeft.textContent = formatCount(filesystemsView.volumes.length, 'volume');
  } else {
    statusLeft.textContent = sys.cpuModel || 'System Performance';
  }

  const cpuStr = `CPU ${sys.cpu.totalPct.toFixed(1)}%`;
  const memStr = sys.mem.totalBytes > 0
    ? `Memory ${formatBytes(sys.mem.usedBytes)} / ${formatBytes(sys.mem.totalBytes)} (${sys.mem.usedPct.toFixed(0)}%)`
    : '';
  statusRight.textContent = memStr ? `${cpuStr}  •  ${memStr}` : cpuStr;
}

// ---- commands & toolbar -------------------------------------------------------

const searchInput = h('input', {
  type: 'text',
  placeholder: 'Filter processes…',
  'aria-label': 'Filter processes',
});
searchInput.addEventListener('input', () => {
  setFilter(searchInput.value);
});
const searchBox = h('div.search-field', icon('search'), searchInput);

const intervalSelect = new Select({
  options: [
    { value: 0.5, label: '0.5 s' },
    { value: 1, label: '1 s' },
    { value: 2, label: '2 s' },
    { value: 5, label: '5 s' },
  ],
  value: Number(settings.get('interval')) || 1,
  onChange: (val) => {
    settings.set('interval', val);
    sampler.setIntervalSec(val);
  },
});

const selectedProcs = () => processesView.selectedItems();

commands.addAll([
  {
    id: 'page-processes',
    label: 'Processes',
    icon: 'list',
    keys: ['Mod+1'],
    run: () => setPage('processes'),
  },
  {
    id: 'page-performance',
    label: 'Performance',
    icon: 'activity',
    keys: ['Mod+2'],
    run: () => setPage('performance'),
  },
  {
    id: 'page-filesystems',
    label: 'File Systems',
    icon: 'hard-drive',
    keys: ['Mod+3'],
    run: () => setPage('filesystems'),
  },
  {
    id: 'find',
    label: 'Filter Processes',
    icon: 'search',
    keys: ['Mod+F'],
    inText: true,
    run: () => {
      if (state.page !== 'processes') setPage('processes');
      searchInput.focus();
      if (searchInput.select) searchInput.select();
    },
  },
  {
    id: 'clear-filter',
    label: 'Clear Filter',
    keys: ['Escape'],
    inText: true,
    enabled: () => Boolean(searchInput.value) || document.activeElement === searchInput,
    run: () => {
      setFilter('');
      processesView.list.focus();
    },
  },
  {
    id: 'toggle-tree',
    label: 'Tree Mode',
    icon: 'layers',
    keys: ['Mod+T'],
    checked: () => processesView.treeMode,
    run: () => {
      processesView.setTreeMode(!processesView.treeMode);
      toolbar.refresh();
    },
  },
  {
    id: 'toggle-per-core',
    label: 'Per-Core Graphs',
    icon: 'cpu',
    checked: () => resourcesView.perCore,
    run: () => resourcesView.setPerCore(!resourcesView.perCore),
  },
  {
    id: 'proc-properties',
    label: 'Properties',
    icon: 'info',
    keys: ['Alt+Enter'],
    enabled: () => state.page === 'processes' && selectedProcs().length === 1,
    run: () => processesView.showPropertiesDialog(selectedProcs()[0], sampler.proc, sampler.sys),
  },
  {
    id: 'copy-cmdline',
    label: 'Copy Command Line',
    icon: 'copy',
    keys: ['Mod+Shift+C'],
    enabled: () => state.page === 'processes' && selectedProcs().length >= 1,
    run: async () => {
      const text = selectedProcs().map((p) => p.cmdline || p.name).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied command line', { icon: 'copy', key: 'copy-cmdline' });
      } catch (err) {
        toast(`Could not copy: ${err.message}`, { error: true });
      }
    },
  },
  {
    id: 'end-process',
    label: 'End Process (needs bro support)',
    icon: 'stop',
    keys: ['Delete'],
    enabled: () => false,
    run: () => {},
  },
  {
    id: 'kill-process',
    label: 'Kill Process (needs bro support)',
    icon: 'x-circle',
    danger: true,
    enabled: () => false,
    run: () => {},
  },
  {
    id: 'refresh',
    label: 'Refresh Now',
    icon: 'refresh',
    keys: ['F5', 'Mod+R'],
    run: async () => {
      await Promise.all([sampler.tick(), filesystemsView.refresh()]);
    },
  },
  { id: 'new-window', label: 'New Window', keys: ['Mod+N'], run: () => app.newWindow() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() },
]);

toolbar.add(searchBox);
const treeBtn = toolbar.button('toggle-tree');
const propsBtn = toolbar.button('proc-properties');
const copyBtn = toolbar.button('copy-cmdline');
const endBtn = toolbar.button('end-process');
toolbar.spacer();
toolbar.add(h('div.mon-toolbar-group',
  h('span.mon-interval-label', 'Update:'),
  intervalSelect.el
));
toolbar.button('refresh');

function showProcessContextMenu(e, items) {
  if (!items || !items.length) {
    menu.show([
      commands.item('toggle-tree'),
      commands.item('refresh'),
    ], e.clientX, e.clientY);
    return;
  }
  menu.show([
    { heading: items.length === 1 ? `${items[0].name} (${items[0].pid})` : formatCount(items.length, 'process', 'processes') },
    commands.item('proc-properties'),
    commands.item('copy-cmdline'),
    { separator: true },
    commands.item('end-process'),
    commands.item('kill-process'),
    { separator: true },
    commands.item('toggle-tree'),
  ], e.clientX, e.clientY);
}

// ---- navigation & helpers -----------------------------------------------------

function setPage(pageId) {
  const valid = ['processes', 'performance', 'filesystems'].includes(pageId) ? pageId : 'processes';
  state.page = valid;
  settings.set('page', valid);
  sidebar.select(valid);

  processesView.el.classList.toggle('hidden', valid !== 'processes');
  resourcesView.el.classList.toggle('hidden', valid !== 'performance');
  filesystemsView.el.classList.toggle('hidden', valid !== 'filesystems');

  const onProcs = valid === 'processes';
  searchBox.classList.toggle('hidden', !onProcs);
  treeBtn.classList.toggle('hidden', !onProcs);
  propsBtn.classList.toggle('hidden', !onProcs);
  copyBtn.classList.toggle('hidden', !onProcs);
  endBtn.classList.toggle('hidden', !onProcs);

  if (valid === 'processes') {
    processesView.render();
  } else if (valid === 'performance') {
    resourcesView.update(sampler.sys);
  }
  updateStatusBar();
  toolbar.refresh();
}

function setFilter(text) {
  const val = String(text ?? '');
  if (searchInput.value !== val) searchInput.value = val;
  processesView.setFilter(val);
  updateStatusBar();
}

function setRoot(rootDir) {
  state.root = rootDir || '/';
  sampler.setRoot(state.root);
}

// Pause sampling while the window is hidden or minimised
document.addEventListener('visibilitychange', () => {
  sampler.setPaused(document.hidden || document.visibilityState === 'hidden');
});

// Initialize active page synchronously, then start async sampling and volume lookup
setPage(state.page);
sampler.start();
filesystemsView.refresh().then(() => updateStatusBar());

app.onLaunch(({ argv, first }) => {
  if (argv && argv.includes('--new-window') && !first) {
    app.newWindow();
    return;
  }
  if (argv && argv.includes('--performance')) setPage('performance');
  else if (argv && argv.includes('--filesystems')) setPage('filesystems');
  else if (argv && argv.includes('--processes')) setPage('processes');
});

app.expose({
  state,
  settings,
  commands,
  sampler,
  sysSampler: sampler.sys,
  procSampler: sampler.proc,
  processesView,
  resourcesView,
  filesystemsView,
  list: processesView.list,
  sidebar,
  searchInput,
  setPage,
  setRoot,
  setFilter,
  tick: (nowMs) => sampler.tick(nowMs),
  parsers: {
    parseProcStat,
    computeCpuDelta,
    parseMeminfo,
    parseDiskstats,
    parseNetDev,
    parseLoadavg,
    parseUptime,
    parseCpuinfoModel,
    parsePidStat,
    parsePidStatus,
    parsePidCmdline,
    computeProcCpuPct,
  },
});
