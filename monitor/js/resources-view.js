/**
 * Performance page: live Canvas 2D graphs for CPU (total + per-core small
 * multiples), Memory & Swap, Disk Read/Write, Network Rx/Tx, and GPU Busy/VRAM,
 * plus header showing CPU model, Uptime, and Load Average.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Switch } from '/lib/controls.js';
import { formatBytes, formatDuration } from '/lib/format.js';
import { LineChart, readChartTheme } from './charts.js';

export class ResourcesView {
  constructor({ settings }) {
    this.settings = settings;
    this.perCore = !!settings.get('perCore');

    // Header elements
    this.cpuModelEl = h('span.title.ellipsis', 'Processor');
    this.uptimeValEl = h('span.mon-perf-stat-val.num', '0:00');
    this.loadValEl = h('span.mon-perf-stat-val.num', '0.00, 0.00, 0.00');

    this.perCoreSwitch = new Switch({
      on: this.perCore,
      label: 'Show per-core graphs',
      onChange: (on) => this.setPerCore(on),
    });

    const header = h('div.mon-perf-header',
      h('div.mon-perf-cpu-model',
        icon('cpu', 'lg'),
        this.cpuModelEl
      ),
      h('div.mon-perf-meta',
        h('div.mon-perf-stat',
          h('span.mon-perf-stat-label', 'UPTIME'),
          this.uptimeValEl
        ),
        h('div.mon-perf-stat',
          h('span.mon-perf-stat-label', 'LOAD AVERAGE'),
          this.loadValEl
        ),
        h('div.mon-toolbar-group',
          h('span.dim', { style: { fontSize: 'var(--fs-cap)' } }, 'Per-core'),
          this.perCoreSwitch.el
        )
      )
    );

    // 1. CPU card (wide)
    this.cpuValEl = h('span.mon-chart-val.num', '0.0%');
    this.cpuSubEl = h('span.mon-chart-sub.num', '');
    this.cpuCanvas = h('canvas');
    this.cpuChart = new LineChart(this.cpuCanvas, { max: 100 });
    this.coresGridEl = h('div.mon-cores-grid');
    this.coresGridEl.classList.toggle('hidden', !this.perCore);
    this.coreCells = []; // [{ valEl, canvas, chart }]

    this.cpuCard = h('div.mon-chart-card.wide',
      h('div.mon-chart-head',
        h('div.mon-chart-title-wrap',
          icon('cpu'),
          h('span.mon-chart-title', 'CPU'),
          this.cpuSubEl
        ),
        h('div.mon-chart-readout', this.cpuValEl)
      ),
      h('div.mon-canvas-wrap', this.cpuCanvas),
      this.coresGridEl
    );

    // 2. Memory & Swap card
    this.memValEl = h('span.mon-chart-val.num', '0 B');
    this.memSubEl = h('span.mon-chart-val-sec.num', '0%');
    this.swapSubEl = h('span.mon-chart-sub.num', 'Swap: 0 B');
    this.memCanvas = h('canvas');
    this.memChart = new LineChart(this.memCanvas, { max: 100 });

    this.memCard = h('div.mon-chart-card',
      h('div.mon-chart-head',
        h('div.mon-chart-title-wrap',
          icon('memory'),
          h('span.mon-chart-title', 'Memory & Swap'),
          this.swapSubEl
        ),
        h('div.mon-chart-readout', this.memValEl, this.memSubEl)
      ),
      h('div.mon-canvas-wrap', this.memCanvas),
      h('div.mon-legend',
        h('span.mon-legend-item', h('span.mon-dot'), 'Memory'),
        h('span.mon-legend-item', h('span.mon-dot.warn'), 'Swap')
      )
    );

    // 3. Disk I/O card
    this.diskReadValEl = h('span.mon-chart-val.num', '0 B/s');
    this.diskWriteValEl = h('span.mon-chart-val-sec.num', 'W: 0 B/s');
    this.diskCanvas = h('canvas');
    this.diskChart = new LineChart(this.diskCanvas, { max: 0, minMax: 64 * 1024 });

    this.diskCard = h('div.mon-chart-card',
      h('div.mon-chart-head',
        h('div.mon-chart-title-wrap',
          icon('hard-drive'),
          h('span.mon-chart-title', 'Disk I/O')
        ),
        h('div.mon-chart-readout', this.diskReadValEl, this.diskWriteValEl)
      ),
      h('div.mon-canvas-wrap', this.diskCanvas),
      h('div.mon-legend',
        h('span.mon-legend-item', h('span.mon-dot'), 'Read'),
        h('span.mon-legend-item', h('span.mon-dot.secondary'), 'Write')
      )
    );

    // 4. Network card
    this.netRxValEl = h('span.mon-chart-val.num', '0 B/s');
    this.netTxValEl = h('span.mon-chart-val-sec.num', 'Up: 0 B/s');
    this.netCanvas = h('canvas');
    this.netChart = new LineChart(this.netCanvas, { max: 0, minMax: 32 * 1024 });

    this.netCard = h('div.mon-chart-card',
      h('div.mon-chart-head',
        h('div.mon-chart-title-wrap',
          icon('network'),
          h('span.mon-chart-title', 'Network')
        ),
        h('div.mon-chart-readout', this.netRxValEl, this.netTxValEl)
      ),
      h('div.mon-canvas-wrap', this.netCanvas),
      h('div.mon-legend',
        h('span.mon-legend-item', h('span.mon-dot'), 'Receive'),
        h('span.mon-legend-item', h('span.mon-dot.secondary'), 'Send')
      )
    );

    // 5. GPU card (shown when GPU sysfs or bro.gpu memoryInfo is present)
    this.gpuTitleEl = h('span.mon-chart-title', 'GPU');
    this.gpuValEl = h('span.mon-chart-val.num', '0%');
    this.gpuVramEl = h('span.mon-chart-val-sec.num', 'VRAM: 0 B');
    this.gpuCanvas = h('canvas');
    this.gpuChart = new LineChart(this.gpuCanvas, { max: 100 });

    this.gpuCard = h('div.mon-chart-card.hidden',
      h('div.mon-chart-head',
        h('div.mon-chart-title-wrap',
          icon('monitor'),
          this.gpuTitleEl
        ),
        h('div.mon-chart-readout', this.gpuValEl, this.gpuVramEl)
      ),
      h('div.mon-canvas-wrap', this.gpuCanvas),
      h('div.mon-legend',
        h('span.mon-legend-item', h('span.mon-dot'), 'GPU Busy %'),
        h('span.mon-legend-item', h('span.mon-dot.secondary'), 'VRAM %')
      )
    );

    this.gridEl = h('div.mon-perf-grid',
      this.cpuCard,
      this.memCard,
      this.diskCard,
      this.netCard,
      this.gpuCard
    );

    this.el = h('div.mon-page-perf', header, this.gridEl);
    this.lastSys = null;
    this.dpr = window.devicePixelRatio || 1;
    window.addEventListener('resize', () => {
      this.dpr = window.devicePixelRatio || 1;
    });
  }

  setPerCore(on) {
    this.perCore = !!on;
    this.settings.set('perCore', this.perCore);
    this.perCoreSwitch.set(this.perCore);
    this.coresGridEl.classList.toggle('hidden', !this.perCore);
    if (this.lastSys) this.update(this.lastSys);
  }

  _ensureCoreCells(count) {
    if (this.coreCells.length === count) return;
    this.coreCells = [];
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const valEl = h('span.mon-core-val.num', '0%');
      const canvas = h('canvas');
      const chart = new LineChart(canvas, { max: 100 });
      const cell = h('div.mon-core-cell',
        h('div.mon-core-top',
          h('span', `CPU ${i}`),
          valEl
        ),
        h('div.mon-core-canvas-wrap', canvas)
      );
      this.coreCells.push({ valEl, canvas, chart });
      nodes.push(cell);
    }
    this.coresGridEl.replaceChildren(...nodes);
  }

  update(sys) {
    this.lastSys = sys;
    if (!sys || this.el.classList.contains('hidden')) return;

    // 1. Update text readouts
    this.cpuModelEl.textContent = sys.cpuModel || 'Processor';
    this.uptimeValEl.textContent = formatDuration(sys.uptimeSec || 0);
    const l = sys.loadavg || { load1: 0, load5: 0, load15: 0 };
    this.loadValEl.textContent = `${l.load1.toFixed(2)}, ${l.load5.toFixed(2)}, ${l.load15.toFixed(2)}`;

    const coreCount = sys.cpu.corePcts.length;
    this.cpuValEl.textContent = `${sys.cpu.totalPct.toFixed(1)}%`;
    this.cpuSubEl.textContent = coreCount > 0 ? `${coreCount} cores` : '';

    this._ensureCoreCells(coreCount);
    for (let i = 0; i < coreCount; i++) {
      this.coreCells[i].valEl.textContent = `${Math.round(sys.cpu.corePcts[i] || 0)}%`;
    }

    const m = sys.mem;
    this.memValEl.textContent = `${formatBytes(m.usedBytes)} / ${formatBytes(m.totalBytes)}`;
    this.memSubEl.textContent = `${m.usedPct.toFixed(1)}%`;
    this.swapSubEl.textContent = m.swapTotalBytes > 0
      ? `Swap: ${formatBytes(m.swapUsedBytes)} / ${formatBytes(m.swapTotalBytes)} (${m.swapPct.toFixed(0)}%)`
      : 'Swap: none';

    this.diskReadValEl.textContent = `${formatBytes(sys.disk.readBps)}/s`;
    this.diskWriteValEl.textContent = `W: ${formatBytes(sys.disk.writeBps)}/s`;

    this.netRxValEl.textContent = `${formatBytes(sys.net.rxBps)}/s`;
    this.netTxValEl.textContent = `Up: ${formatBytes(sys.net.txBps)}/s`;

    const g = sys.gpu;
    this.gpuCard.classList.toggle('hidden', !g.available);
    if (g.available) {
      this.gpuTitleEl.textContent = g.name || 'GPU';
      this.gpuValEl.textContent = g.busyPct != null ? `${g.busyPct.toFixed(0)}%` : `${g.vramPct.toFixed(0)}%`;
      this.gpuVramEl.textContent = g.vramTotalBytes > 0
        ? `VRAM: ${formatBytes(g.vramUsedBytes)} / ${formatBytes(g.vramTotalBytes)}`
        : '';
    }

    // 2. Batch-read all canvas dimensions and theme tokens before writing to canvases
    const theme = readChartTheme();
    const dpr = this.dpr;
    const cpuBox = this.cpuChart.measure();
    const memBox = this.memChart.measure();
    const diskBox = this.diskChart.measure();
    const netBox = this.netChart.measure();
    const gpuBox = g.available ? this.gpuChart.measure() : null;
    const coreBoxes = this.perCore ? this.coreCells.map((c) => c.chart.measure()) : [];

    // 3. Draw canvases once per tick
    this.cpuChart.draw([
      { data: sys.history.cpuTotal, stroke: theme.accent, fill: theme.accentSoft },
    ], { ...cpuBox, dpr, theme });

    if (this.perCore) {
      for (let i = 0; i < this.coreCells.length; i++) {
        this.coreCells[i].chart.draw([
          { data: sys.history.cpuCores[i] || [], stroke: theme.accent, fill: theme.accentSoft },
        ], { ...coreBoxes[i], dpr, theme });
      }
    }

    this.memChart.draw([
      { data: sys.history.memPct, stroke: theme.accent, fill: theme.accentSoft },
      { data: sys.history.swapPct, stroke: theme.warn },
    ], { ...memBox, dpr, theme });

    this.diskChart.draw([
      { data: sys.history.diskReadBps, stroke: theme.accent, fill: theme.accentSoft },
      { data: sys.history.diskWriteBps, stroke: theme.ok },
    ], { ...diskBox, dpr, theme });

    this.netChart.draw([
      { data: sys.history.netRxBps, stroke: theme.accent, fill: theme.accentSoft },
      { data: sys.history.netTxBps, stroke: theme.ok },
    ], { ...netBox, dpr, theme });

    if (g.available && gpuBox) {
      this.gpuChart.draw([
        { data: sys.history.gpuBusyPct, stroke: theme.accent, fill: theme.accentSoft },
        { data: sys.history.gpuVramPct, stroke: theme.ok },
      ], { ...gpuBox, dpr, theme });
    }
  }
}
