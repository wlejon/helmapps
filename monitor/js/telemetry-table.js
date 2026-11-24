/**
 * Columnar telemetry store for helm.monitor powered by bro.table:
 * - sysTable tracks time-series system metrics with a RangeIndex on `ts`.
 * - procTable mirrors sampled processes with HashIndexes on `user` and `state`.
 * - Supports range-indexed time windows, native groupBy('user') aggregation,
 *   multi-table .brotable bundles, and Apache Parquet export.
 */

function tableApi() {
  return (typeof bro !== 'undefined' && bro && bro.table) ? bro.table : null;
}

const SYS_SCHEMA = {
  ts: 'f64',
  cpuPct: 'f32',
  memUsedBytes: 'i64',
  memPct: 'f32',
  diskReadBps: 'i64',
  diskWriteBps: 'i64',
  netRxBps: 'i64',
  netTxBps: 'i64',
  load1: 'f32',
};

const PROC_SCHEMA = {
  pid: 'i32',
  ppid: 'i32',
  name: 'string',
  user: 'dict',
  state: 'dict',
  cpu: 'f32',
  memory: 'i64',
  threads: 'i32',
};

export class TelemetryStore {
  constructor() {
    this.sysTable = null;
    this.procTable = null;
    this._ensureTables();
  }

  get supported() {
    return !!(this.sysTable && this.procTable);
  }

  _ensureTables() {
    const q = tableApi();
    if (!q) return;
    if (!this.sysTable) {
      this.sysTable = q.create(SYS_SCHEMA);
      this.sysTable.createRangeIndex('ts');
    }
    if (!this.procTable) {
      this.procTable = q.create(PROC_SCHEMA);
      this.procTable.createIndex('user');
      this.procTable.createIndex('state');
    }
  }

  recordTick(sysSampler, procSampler, nowMs = Date.now()) {
    this._ensureTables();
    if (!this.sysTable || !this.procTable) return;

    if (sysSampler) {
      this.sysTable.insert({
        ts: Number(nowMs) || Date.now(),
        cpuPct: Number(sysSampler.cpu?.totalPct || 0),
        memUsedBytes: BigInt(Math.max(0, Math.floor(Number(sysSampler.mem?.usedBytes || 0)))),
        memPct: Number(sysSampler.mem?.usedPct || 0),
        diskReadBps: BigInt(Math.max(0, Math.floor(Number(sysSampler.disk?.readBps || 0)))),
        diskWriteBps: BigInt(Math.max(0, Math.floor(Number(sysSampler.disk?.writeBps || 0)))),
        netRxBps: BigInt(Math.max(0, Math.floor(Number(sysSampler.net?.rxBps || 0)))),
        netTxBps: BigInt(Math.max(0, Math.floor(Number(sysSampler.net?.txBps || 0)))),
        load1: Number(sysSampler.loadavg?.load1 || 0),
      });
    }

    if (procSampler && Array.isArray(procSampler.processes)) {
      this.procTable.clear();
      if (procSampler.processes.length > 0) {
        const batch = procSampler.processes.map((p) => ({
          pid: Number(p.pid) || 0,
          ppid: Number(p.ppid) || 0,
          name: String(p.name || ''),
          user: String(p.user || 'unknown'),
          state: String(p.state || 'S'),
          cpu: Number(p.cpu || 0),
          memory: BigInt(Math.max(0, Math.floor(Number(p.memory || 0)))),
          threads: Number(p.threads || 1),
        }));
        this.procTable.insertMany(batch);
      }
    }
  }

  userSummary() {
    const q = tableApi();
    if (!this.procTable || !q || this.procTable.rowCount === 0) return [];
    const rows = this.procTable.query()
      .groupBy('user')
      .agg({
        procs: q.count(),
        cpu: q.sum('cpu'),
        memory: q.sum('memory'),
      })
      .orderBy('memory', 'desc')
      .toArray();
    return rows.map((r) => ({
      user: r.user,
      procs: Number(r.procs || 0),
      cpu: Number(r.cpu || 0),
      memory: Number(r.memory || 0),
    }));
  }

  sysWindow(sinceMs, untilMs) {
    const q = tableApi();
    if (!this.sysTable || !q || this.sysTable.rowCount === 0) return [];
    let qb = this.sysTable.query();
    if (sinceMs != null && Number.isFinite(Number(sinceMs))) {
      qb = qb.where(q.ge('ts', Number(sinceMs)));
    }
    if (untilMs != null && Number.isFinite(Number(untilMs))) {
      qb = qb.where(q.le('ts', Number(untilMs)));
    }
    return qb.orderBy('ts', 'asc').toArray();
  }

  exportBundle(filePath, { compress = true } = {}) {
    const q = tableApi();
    if (!this.supported || !q || !filePath) return false;
    return q.saveBundle(filePath, {
      system: this.sysTable,
      processes: this.procTable,
    }, { compress: !!compress });
  }

  exportParquet(sysPath, procPath, { compress = true } = {}) {
    if (!this.supported) return false;
    let ok = true;
    if (sysPath) ok = ok && this.sysTable.saveParquet(sysPath, { compress: !!compress });
    if (procPath) ok = ok && this.procTable.saveParquet(procPath, { compress: !!compress });
    return ok;
  }
}
