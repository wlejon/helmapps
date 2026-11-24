/**
 * Per-device I/O & usage history store for helm.disks powered by bro.table:
 * - Appends sampled drive throughput/IOPS into an off-heap Table indexed by device.
 * - Uses an incremental ReactiveQuery (groupBy 'device') for avg/max read & write B/s.
 * - Supports export to compressed .brotable v4 and LZ4 .parquet.
 */

function tableApi() {
  return (typeof bro !== 'undefined' && bro && bro.table) ? bro.table : null;
}

const IO_SCHEMA = {
  ts: 'f64',
  device: 'dict',
  readBps: 'i64',
  writeBps: 'i64',
  readIops: 'i32',
  writeIops: 'i32',
  usedPct: 'f32',
};

export class DiskIoHistory {
  constructor() {
    this.table = null;
    this.reactiveSummary = null;
    this._ensureTable();
  }

  get supported() {
    return !!this.table;
  }

  _ensureTable() {
    const q = tableApi();
    if (!q) return;
    if (!this.table) {
      this.table = q.create(IO_SCHEMA);
      this.table.createIndex('device');
      this.reactiveSummary = this.table.query()
        .groupBy('device')
        .agg({
          samples: q.count(),
          avgReadBps: q.avg('readBps'),
          maxReadBps: q.max('readBps'),
          avgWriteBps: q.avg('writeBps'),
          maxWriteBps: q.max('writeBps'),
        })
        .orderBy('device', 'asc')
        .reactive();
    }
  }

  recordDrives(drives, nowMs = Date.now()) {
    this._ensureTable();
    if (!this.table || !Array.isArray(drives) || drives.length === 0) return;

    const batch = [];
    for (const d of drives) {
      if (!d || !d.device) continue;
      let readIops = 0;
      let writeIops = 0;
      for (const p of d.partitions || []) {
        readIops += Number(p.readIops || 0);
        writeIops += Number(p.writeIops || 0);
      }
      batch.push({
        ts: Number(nowMs) || Date.now(),
        device: String(d.device),
        readBps: BigInt(Math.max(0, Math.floor(Number(d.readBps || 0)))),
        writeBps: BigInt(Math.max(0, Math.floor(Number(d.writeBps || 0)))),
        readIops: Math.max(0, Math.floor(readIops)),
        writeIops: Math.max(0, Math.floor(writeIops)),
        usedPct: Number(d.usedPct || 0),
      });
    }
    if (batch.length > 0) {
      this.table.insertMany(batch);
    }
  }

  summaryByDevice() {
    if (!this.table || !this.reactiveSummary || this.table.rowCount === 0) return [];
    if (this.reactiveSummary.dirty()) this.reactiveSummary.refresh();
    const res = this.reactiveSummary.table;
    if (!res) return [];
    return res.toArray().map((r) => ({
      device: r.device,
      samples: Number(r.samples || 0),
      avgReadBps: Number(r.avgReadBps || 0),
      maxReadBps: Number(r.maxReadBps || 0),
      avgWriteBps: Number(r.avgWriteBps || 0),
      maxWriteBps: Number(r.maxWriteBps || 0),
    }));
  }

  exportTable(filePath, { compress = true } = {}) {
    if (!this.table || !filePath) return false;
    return this.table.save(filePath, { compress: !!compress });
  }

  exportParquet(filePath, { compress = true } = {}) {
    if (!this.table || !filePath) return false;
    return this.table.saveParquet(filePath, { compress: !!compress });
  }

  dispose() {
    if (this.reactiveSummary) {
      try { this.reactiveSummary.dispose(); } catch (_) { /* ignore */ }
      this.reactiveSummary = null;
    }
    this.table = null;
  }
}
