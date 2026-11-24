/**
 * Columnar bro.table store for helm.logs:
 * - Indexes log entries off-heap by severity and source (HashIndex).
 * - Maintains an incremental ReactiveQuery (groupBy 'severity') for O(dirty chunks) counts.
 * - Exports filtered or full logs directly to compressed .brotable v4 or .parquet.
 */

function tableApi() {
  return (typeof bro !== 'undefined' && bro && bro.table) ? bro.table : null;
}

const LOG_SCHEMA = {
  id: 'i32',
  entryIdx: 'i32',
  severity: 'dict',
  source: 'dict',
  timestamp: 'string',
  message: 'string',
};

export class LogTableStore {
  constructor() {
    this.table = null;
    this.reactiveSev = null;
    this.entryCount = 0;
    this._ensureTable();
  }

  get supported() {
    return !!this.table;
  }

  _ensureTable() {
    const q = tableApi();
    if (!q) return;
    if (!this.table) {
      this.table = q.create(LOG_SCHEMA);
      this.table.createIndex('severity');
      this.table.createIndex('source');
      this.reactiveSev = this.table.query()
        .groupBy('severity')
        .agg({ n: q.count() })
        .reactive();
    }
  }

  replaceAll(entries) {
    this._ensureTable();
    if (!this.table) return;
    this.table.clear();
    this.entryCount = 0;
    this.appendEntries(entries, 0);
  }

  appendEntries(entries, startIdx = 0) {
    this._ensureTable();
    if (!this.table || !Array.isArray(entries)) return;
    const from = Math.max(0, Number(startIdx) || 0);
    if (from < this.entryCount) {
      // Prefix changed; rebuild cleanly.
      this.table.clear();
      this.entryCount = 0;
    }
    const begin = this.entryCount;
    if (begin >= entries.length) {
      if (this.reactiveSev) this.reactiveSev.refresh();
      return;
    }

    const batch = [];
    for (let i = begin; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      batch.push({
        id: Number(e.id) || (i + 1),
        entryIdx: i,
        severity: String(e.severity || 'info'),
        source: String(e.source || 'log'),
        timestamp: String(e.timestamp || ''),
        message: String(e.message || ''),
      });
    }
    if (batch.length > 0) {
      this.table.insertMany(batch);
    }
    this.entryCount = entries.length;
    if (this.reactiveSev) {
      this.reactiveSev.refresh();
    }
  }

  severityCounts() {
    const out = { error: 0, warn: 0, info: 0, debug: 0, total: 0 };
    if (!this.table || !this.reactiveSev) return out;
    if (this.table.rowCount === 0) return out;
    if (this.reactiveSev.dirty()) this.reactiveSev.refresh();
    const res = this.reactiveSev.table;
    if (!res) return out;
    const rows = res.toArray();
    for (const r of rows) {
      const k = r.severity;
      const n = Number(r.n || 0);
      if (k === 'error' || k === 'warn' || k === 'info' || k === 'debug') {
        out[k] = n;
      }
      out.total += n;
    }
    return out;
  }

  filterBySeverity(sev) {
    const q = tableApi();
    if (!this.table || !q || !sev || sev === 'all') return null;
    const rows = this.table.query()
      .where(q.eq('severity', String(sev)))
      .select({ entryIdx: 'entryIdx' })
      .toArray();
    return rows.map((r) => r.entryIdx);
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
    if (this.reactiveSev) {
      try { this.reactiveSev.dispose(); } catch (_) { /* ignore */ }
      this.reactiveSev = null;
    }
    this.table = null;
    this.entryCount = 0;
  }
}
