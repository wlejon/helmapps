/**
 * TableSession manages opened .brotable (v1-v4 + bundles), Parquet, and CSV/TSV
 * datasets via bro.table, providing query execution, explain() telemetry,
 * column profiling, paginated VirtualList row slicing, and multi-format export.
 */

const fs = require('fs');
const path = require('path');

export const MAX_DISPLAY_ROWS = 5000;

function tableApi() {
  return (typeof bro !== 'undefined' && bro && bro.table) ? bro.table : null;
}

export function isNumericColType(t) {
  return t === 'i32' || t === 'u32' || t === 'i64' || t === 'f32' || t === 'f64';
}

function parseFilterLiteral(valStr, colType) {
  if (colType === 'bool') {
    const lower = String(valStr).trim().toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'yes';
  }
  if (colType === 'i64') {
    try { return BigInt(String(valStr).trim()); } catch (_) { return 0n; }
  }
  if (isNumericColType(colType)) {
    const n = Number(valStr);
    return Number.isFinite(n) ? n : 0;
  }
  return String(valStr);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export class TableSession {
  constructor() {
    this.filePath = '';
    this.formatLabel = '';
    this.bundleEntries = null;  // Map<string, Table | TableSnapshot>
    this.bundleNames = [];
    this.activeBundleName = '';
    this.source = null;         // opened Table or TableSnapshot
    this.viewTable = null;      // current query output Table (or source if unfiltered)
    this.explain = null;
    this.queryMs = 0;
  }

  get supported() {
    return !!tableApi();
  }

  close() {
    if (this.bundleEntries) {
      for (const item of this.bundleEntries.values()) {
        if (item && typeof item.close === 'function') {
          try { item.close(); } catch (_) { /* ignore */ }
        }
      }
    } else if (this.source && typeof this.source.close === 'function') {
      try { this.source.close(); } catch (_) { /* ignore */ }
    }
    this.bundleEntries = null;
    this.bundleNames = [];
    this.activeBundleName = '';
    this.source = null;
    this.viewTable = null;
    this.explain = null;
    this.filePath = '';
    this.formatLabel = '';
  }

  openFile(filePath) {
    const q = tableApi();
    if (!q || !filePath) throw new Error('bro.table is unavailable');
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).toLowerCase();

    this.close();
    this.filePath = resolved;

    if (ext === '.brotable') {
      let openedBundle = null;
      let fmt = 'brotable';
      try {
        openedBundle = q.mmapBundle(resolved);
        fmt = 'Bundle (mmap)';
      } catch (_) {
        try {
          openedBundle = q.loadBundle(resolved);
          fmt = 'Bundle (LZ4)';
        } catch (__) {
          openedBundle = null;
        }
      }

      if (openedBundle && typeof openedBundle === 'object') {
        const names = Object.keys(openedBundle);
        if (names.length > 0) {
          this.bundleEntries = new Map();
          for (const n of names) this.bundleEntries.set(n, openedBundle[n]);
          this.bundleNames = names;
          this.formatLabel = fmt;
          this.selectBundleTable(names[0]);
          return this.info();
        }
      }

      try {
        this.source = q.mmap(resolved);
        this.formatLabel = 'brotable (mmap)';
      } catch (_) {
        this.source = q.load(resolved);
        this.formatLabel = 'brotable (LZ4)';
      }
      this.viewTable = this.source;
      return this.info();
    }

    if (ext === '.parquet') {
      this.source = q.fromParquetFile(resolved);
      this.formatLabel = 'Parquet';
      this.viewTable = this.source;
      return this.info();
    }

    if (ext === '.csv' || ext === '.tsv') {
      this.source = q.fromCSVFile(resolved, { delimiter: ext === '.tsv' ? '\t' : ',' });
      this.formatLabel = ext === '.tsv' ? 'TSV' : 'CSV';
      this.viewTable = this.source;
      return this.info();
    }

    // Unknown extension fallback: try .brotable load
    this.source = q.load(resolved);
    this.formatLabel = 'brotable';
    this.viewTable = this.source;
    return this.info();
  }

  selectBundleTable(name) {
    if (!this.bundleEntries || !this.bundleEntries.has(name)) return false;
    this.activeBundleName = name;
    this.source = this.bundleEntries.get(name);
    this.viewTable = this.source;
    this.explain = null;
    return true;
  }

  schema() {
    const target = this.viewTable || this.source;
    return target ? target.schema : [];
  }

  sourceSchema() {
    return this.source ? this.source.schema : [];
  }

  info() {
    const src = this.source;
    const view = this.viewTable || src;
    return {
      filePath: this.filePath,
      fileName: this.filePath ? path.basename(this.filePath) : '',
      formatLabel: this.formatLabel,
      bundleNames: this.bundleNames,
      activeBundleName: this.activeBundleName,
      sourceRows: src ? src.rowCount : 0,
      viewRows: view ? view.rowCount : 0,
      columnCount: view ? view.columnCount : 0,
      isMapped: !!(src && src.isMapped),
      explain: this.explain,
      queryMs: this.queryMs,
    };
  }

  applyQuery({
    filterCol = '',
    filterOp = 'contains',
    filterVal = '',
    sortCol = '',
    sortDir = 'asc',
    groupCol = '',
    aggCol = '',
    limit = 0,
  } = {}) {
    const q = tableApi();
    if (!q || !this.source) return this.info();

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const srcSchema = this.source.schema;
    const hasFilter = Boolean(filterCol && filterVal !== '');
    const hasGroup = Boolean(groupCol);
    const hasSort = Boolean(sortCol);
    const hasLimit = Number(limit) > 0;

    if (!hasFilter && !hasGroup && !hasSort && !hasLimit) {
      this.viewTable = this.source;
      this.explain = this.source.query().explain();
      this.queryMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      return this.info();
    }

    let qb = this.source.query();

    if (hasFilter) {
      const colInfo = srcSchema.find((c) => c.name === filterCol);
      const colType = colInfo ? colInfo.type : 'string';
      if (filterOp === 'contains' && (colType === 'string' || colType === 'dict')) {
        qb = qb.where(q.contains(filterCol, String(filterVal)));
      } else {
        const lit = parseFilterLiteral(filterVal, colType);
        if (filterOp === 'eq') qb = qb.where(q.eq(filterCol, lit));
        else if (filterOp === 'ne') qb = qb.where(q.ne(filterCol, lit));
        else if (filterOp === 'gt') qb = qb.where(q.gt(filterCol, lit));
        else if (filterOp === 'ge') qb = qb.where(q.ge(filterCol, lit));
        else if (filterOp === 'lt') qb = qb.where(q.lt(filterCol, lit));
        else if (filterOp === 'le') qb = qb.where(q.le(filterCol, lit));
        else if (colType === 'string' || colType === 'dict') {
          qb = qb.where(q.contains(filterCol, String(filterVal)));
        } else {
          qb = qb.where(q.eq(filterCol, lit));
        }
      }
    }

    if (hasGroup) {
      const aggs = { count: q.count() };
      const aggInfo = aggCol ? srcSchema.find((c) => c.name === aggCol) : null;
      if (aggInfo && isNumericColType(aggInfo.type)) {
        aggs.sum = q.sum(aggCol);
        aggs.avg = q.avg(aggCol);
        aggs.min = q.min(aggCol);
        aggs.max = q.max(aggCol);
      }
      qb = qb.groupBy(groupCol).agg(aggs);
    }

    if (hasSort) {
      const validSort = hasGroup
        ? (sortCol === groupCol || sortCol === 'count' || sortCol === 'sum' || sortCol === 'avg' || sortCol === 'min' || sortCol === 'max')
        : srcSchema.some((c) => c.name === sortCol);
      if (validSort) {
        qb = qb.orderBy(sortCol, sortDir === 'desc' ? 'desc' : 'asc');
      }
    } else if (hasGroup) {
      qb = qb.orderBy('count', 'desc');
    }

    if (hasLimit) {
      qb = qb.limit(Number(limit));
    }

    this.explain = qb.explain();
    this.viewTable = qb.run();
    this.queryMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    return this.info();
  }

  displayRows({ offset = 0, limit = MAX_DISPLAY_ROWS } = {}) {
    const view = this.viewTable || this.source;
    if (!view || view.rowCount === 0) return [];
    const total = view.rowCount;
    const start = Math.max(0, Math.min(total, Number(offset) || 0));
    const end = Math.min(total, start + Math.max(1, Math.min(MAX_DISPLAY_ROWS, Number(limit) || MAX_DISPLAY_ROWS)));
    const cols = view.schema;
    const rows = [];
    for (let i = start; i < end; i++) {
      const obj = { _rowIdx: i };
      for (let c = 0; c < cols.length; c++) {
        obj[cols[c].name] = view.get(i, c);
      }
      rows.push(obj);
    }
    return rows;
  }

  profileColumn(colName) {
    const q = tableApi();
    const target = this.viewTable || this.source;
    if (!q || !target || !colName || target.rowCount === 0) {
      return { column: colName || '', type: '', count: 0, stats: null, buckets: [] };
    }
    const info = target.schema.find((c) => c.name === colName);
    if (!info) {
      return { column: colName, type: '', count: 0, stats: null, buckets: [] };
    }

    let stats = null;
    if (isNumericColType(info.type)) {
      const aggRows = target.query()
        .agg({
          count: q.count(q.col(colName)),
          min: q.min(colName),
          max: q.max(colName),
          avg: q.avg(colName),
          sum: q.sum(colName),
        })
        .toArray();
      if (aggRows.length > 0) {
        stats = {
          count: Number(aggRows[0].count || 0),
          min: Number(aggRows[0].min ?? 0),
          max: Number(aggRows[0].max ?? 0),
          avg: Number(aggRows[0].avg ?? 0),
          sum: Number(aggRows[0].sum ?? 0),
        };
      }
    }

    const freqRows = target.query()
      .groupBy(colName)
      .agg({ n: q.count() })
      .orderBy('n', 'desc')
      .limit(12)
      .toArray();

    const buckets = freqRows.map((r) => ({
      label: r[colName] === null || r[colName] === undefined ? '(null)' : String(r[colName]),
      count: Number(r.n || 0),
    }));

    return {
      column: colName,
      type: info.type,
      count: target.rowCount,
      stats,
      buckets,
    };
  }

  exportAs(filePath, format = 'brotable', { compress = true } = {}) {
    const target = this.viewTable || this.source;
    if (!target || !filePath) return false;
    const resolved = path.resolve(filePath);
    if (format === 'parquet') {
      return target.saveParquet(resolved, { compress: !!compress });
    }
    if (format === 'csv') {
      const cols = target.schema;
      const lines = [cols.map((c) => csvEscape(c.name)).join(',')];
      for (let i = 0; i < target.rowCount; i++) {
        const vals = [];
        for (let c = 0; c < cols.length; c++) {
          vals.push(csvEscape(target.get(i, c)));
        }
        lines.push(vals.join(','));
      }
      fs.writeFileSync(resolved, lines.join('\n') + '\n', 'utf8');
      return true;
    }
    return target.save(resolved, { compress: !!compress });
  }
}
