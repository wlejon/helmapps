/**
 * Processes page: VirtualList of running processes with sorting, filtering,
 * parent-PID tree mode, context menu, and Process Properties dialog.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { VirtualList } from '/lib/list.js';
import { Dialog, confirmDialog } from '/lib/dialog.js';
import { formatBytes, formatCount, formatNumber, formatDuration } from '/lib/format.js';

const TERM_ICON = icon('terminal');

export class ProcessesView {
  constructor({ settings, commands, onContextMenu, onSelectionChange }) {
    this.settings = settings;
    this.commands = commands;
    this.onContextMenu = onContextMenu;
    this.onSelectionChange = onSelectionChange;

    this.filterText = '';
    this.rawProcesses = [];
    this.supported = true;
    this.sort = settings.get('sort') || { id: 'cpu', dir: -1 };
    this.treeMode = !!settings.get('treeMode');

    this.list = new VirtualList({
      layout: 'list',
      rowHeight: 32,
      key: (p) => p.pid,
      label: (p) => p.name,
      sort: this.sort,
      columnWidths: settings.get('columns'),
      onColumnResize: (w) => settings.set('columns', w),
      columns: [
        {
          id: 'name',
          label: 'Name',
          sortable: true,
          minWidth: 160,
          cell: (p) => {
            const children = [];
            if (p.depth > 0) {
              children.push(
                h('span.mon-tree-indent', { style: { width: `${Math.min(p.depth, 10) * 14}px` } }),
                h('span.mon-tree-branch', '└')
              );
            }
            children.push(TERM_ICON.cloneNode(true), h('span.ellipsis', p.name));
            return h('div.mon-proc-name', ...children);
          },
        },
        {
          id: 'pid',
          label: 'PID',
          width: 76,
          align: 'right',
          sortable: true,
          cell: (p) => h('span.num.dim', String(p.pid)),
        },
        {
          id: 'user',
          label: 'User',
          width: 100,
          sortable: true,
          cell: (p) => h('span.ellipsis.dim', p.user || '—'),
        },
        {
          id: 'cpu',
          label: 'CPU %',
          width: 86,
          align: 'right',
          sortable: true,
          cell: (p) => h(
            `span.num${p.cpu >= 25 ? '.mon-high-cpu' : ''}`,
            `${(p.cpu || 0).toFixed(1)}%`
          ),
        },
        {
          id: 'memory',
          label: 'Memory',
          width: 104,
          align: 'right',
          sortable: true,
          cell: (p) => h('span.num', formatBytes(p.memory || 0)),
        },
        {
          id: 'threads',
          label: 'Threads',
          width: 78,
          align: 'right',
          sortable: true,
          cell: (p) => h('span.num.dim', formatNumber(p.threads || 1)),
        },
        {
          id: 'state',
          label: 'State',
          width: 96,
          sortable: true,
          cell: (p) => {
            const cls = p.state === 'R' ? '.running' : (p.state === 'Z' || p.state === 'T') ? '.zombie' : '';
            return h(`span.mon-proc-badge${cls}`, p.stateLabel || p.state || 'S');
          },
        },
      ],
      onSort: (id, dir) => {
        this.sort = { id, dir };
        this.settings.set('sort', this.sort);
        this.render();
      },
      onActivate: () => {
        if (this.commands) this.commands.run('proc-properties');
      },
      onContextMenu: (e, items) => {
        if (this.onContextMenu) this.onContextMenu(e, items);
      },
      onSelectionChange: (items) => {
        if (this.onSelectionChange) this.onSelectionChange(items);
      },
      empty: emptyState({
        icon: 'search',
        title: 'No matching processes',
        hint: 'Try clearing the filter in the toolbar.',
      }),
    });

    this.unsupportedEl = emptyState({
      icon: 'activity',
      title: 'Process and performance data on this platform needs bro support',
      hint: 'Process inspection reads /proc on Linux or bro.sys.processes when available.',
    });
    this.unsupportedEl.classList.add('hidden');

    this.el = h('div.mon-page-processes', this.list.el, this.unsupportedEl);
  }

  setFilter(text) {
    const next = String(text || '').trim();
    if (this.filterText === next) return;
    this.filterText = next;
    this.render();
  }

  setTreeMode(on) {
    this.treeMode = !!on;
    this.settings.set('treeMode', this.treeMode);
    this.render();
  }

  setSort(sort) {
    if (!sort || !sort.id) return;
    this.sort = { id: sort.id, dir: sort.dir || -1 };
    this.settings.set('sort', this.sort);
    this.list.setSort(this.sort);
    this.render();
  }

  selectedItems() {
    return this.list.selectedItems();
  }

  update(procSampler) {
    this.supported = !!procSampler.supported;
    this.rawProcesses = procSampler.processes || [];
    if (!this.el.classList.contains('hidden')) {
      this.render();
    }
  }

  _makeComparator() {
    const { id, dir } = this.sort;
    if (id === 'name') {
      return (a, b) => {
        const va = (a.name || '').toLowerCase();
        const vb = (b.name || '').toLowerCase();
        return va < vb ? -dir : va > vb ? dir : a.pid - b.pid;
      };
    }
    if (id === 'user') {
      return (a, b) => {
        const va = (a.user || '').toLowerCase();
        const vb = (b.user || '').toLowerCase();
        return va < vb ? -dir : va > vb ? dir : a.pid - b.pid;
      };
    }
    if (id === 'state') {
      return (a, b) => {
        const va = a.stateLabel || a.state || '';
        const vb = b.stateLabel || b.state || '';
        return va < vb ? -dir : va > vb ? dir : a.pid - b.pid;
      };
    }
    if (id === 'pid') return (a, b) => (a.pid - b.pid) * dir;
    if (id === 'memory') return (a, b) => (a.memory - b.memory) * dir || (a.pid - b.pid);
    if (id === 'threads') return (a, b) => (a.threads - b.threads) * dir || (a.pid - b.pid);
    return (a, b) => (a.cpu - b.cpu) * dir || (a.pid - b.pid);
  }

  _buildTree(items) {
    const byPid = new Map();
    const childrenMap = new Map();
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      byPid.set(p.pid, p);
      childrenMap.set(p.pid, []);
    }
    const roots = [];
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (p.ppid && p.ppid !== p.pid && byPid.has(p.ppid)) {
        childrenMap.get(p.ppid).push(p);
      } else {
        roots.push(p);
      }
    }
    const cmp = this._makeComparator();
    roots.sort(cmp);
    const out = [];
    const visited = new Set();
    const walk = (node, depth) => {
      if (visited.has(node.pid)) return;
      visited.add(node.pid);
      out.push(node.depth === depth ? node : { ...node, depth });
      const kids = childrenMap.get(node.pid) || [];
      if (kids.length > 1) kids.sort(cmp);
      for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
    };
    for (let i = 0; i < roots.length; i++) walk(roots[i], 0);
    for (let i = 0; i < items.length; i++) {
      if (!visited.has(items[i].pid)) walk(items[i], 0);
    }
    return out;
  }

  render() {
    if (!this.supported) {
      this.list.el.classList.add('hidden');
      this.unsupportedEl.classList.remove('hidden');
      return;
    }
    this.unsupportedEl.classList.add('hidden');
    this.list.el.classList.remove('hidden');

    const q = this.filterText.toLowerCase();
    let filtered = this.rawProcesses;
    if (q) {
      filtered = this.rawProcesses.filter((p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.cmdline && p.cmdline.toLowerCase().includes(q)) ||
        String(p.pid).includes(q)
      );
    }

    let ordered;
    if (this.treeMode) {
      ordered = this._buildTree(filtered);
    } else {
      ordered = filtered.map((p) => (p.depth === 0 ? p : { ...p, depth: 0 }));
      ordered.sort(this._makeComparator());
    }

    if (this.list.sort !== this.sort) {
      this.list.setSort(this.sort);
    }
    this.list.setItems(ordered);
  }

  async confirmKillDialog(procs) {
    if (!procs || !procs.length) return false;
    const targetLabel = procs.length === 1
      ? `“${procs[0].name}” (PID ${procs[0].pid})`
      : formatCount(procs.length, 'process', 'processes');
    return confirmDialog({
      title: `Force kill ${targetLabel}?`,
      body: 'Killing a process (SIGKILL) terminates it immediately without saving open data.',
      ok: 'Kill Process',
      danger: true,
    });
  }

  async showPropertiesDialog(proc, procSampler, sysSampler) {
    if (!proc) return null;
    const details = await procSampler.getProcessDetails(proc.pid);
    const st = details.status || {};
    const clkTck = 100;
    const startSec = (details.starttime || 0) / clkTck;
    const elapsedSec = sysSampler && startSec > 0 && sysSampler.uptimeSec > startSec
      ? Math.max(0, sysSampler.uptimeSec - startSec)
      : 0;
    const cpuTimeSec = details.cpuTimeMs != null
      ? details.cpuTimeMs / 1000
      : proc.cpuTimeMs != null
        ? proc.cpuTimeMs / 1000
        : ((details.utime || 0) + (details.stime || 0)) / clkTck;

    const rows = [
      ['Name', details.name || proc.name],
      ['PID', String(details.pid ?? proc.pid)],
      ['Parent PID', String(details.ppid ?? proc.ppid)],
      ['User', `${details.user || proc.user || '—'}${details.uid != null ? ` (UID ${details.uid})` : ''}`],
      ['State', details.stateLabel || proc.stateLabel || details.state || '—'],
      ['Command Line', details.cmdline || proc.cmdline || '—'],
      ['Working Folder', details.cwd || '—'],
      ['CPU Time', formatDuration(cpuTimeSec)],
      ['Running For', elapsedSec > 0 ? formatDuration(elapsedSec) : '—'],
      ['Threads', formatNumber(details.threads || proc.threads || 1)],
      ['Nice / Priority', `${details.nice ?? 0} / ${details.priority ?? 0}`],
      ['Resident Memory', formatBytes(details.memory || proc.memory || 0)],
      ['Virtual Memory', formatBytes(st.vmSizeBytes || details.vsize || proc.vsize || 0)],
      ['Swap Memory', formatBytes(st.vmSwapBytes || details.swap || proc.swap || 0)],
      ['Data / Stack', `${formatBytes(st.vmDataBytes || 0)} / ${formatBytes(st.vmStkBytes || 0)}`],
    ];

    const grid = h('div.mon-props-grid',
      ...rows.flatMap(([k, v]) => [
        h('div.mon-props-label', k),
        h('div.mon-props-val.selectable.num', String(v)),
      ])
    );

    const dlg = new Dialog({
      title: `${details.name || proc.name} (PID ${proc.pid})`,
      icon: 'terminal',
      wide: true,
      body: grid,
    });
    dlg.addButton('Close', { primary: true, value: true });
    return dlg.open();
  }
}
