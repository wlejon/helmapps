/**
 * Persistent off-heap file catalog backed by bro.table.
 * Indexes a directory tree asynchronously into a columnar Table with
 * HashIndexes (kind, ext) and RangeIndexes (size, mtime), supporting
 * LZ4 v4 save and zero-copy mmap reload.
 */

import { kindOf, extname, isHidden } from '/lib/files.js';
import { kindLabelOf } from './model.js';

const fs = require('fs');
const path = require('path');

function tableApi() {
  return (typeof bro !== 'undefined' && bro && bro.table) ? bro.table : null;
}

const CATALOG_SCHEMA = {
  path: 'string',
  dir: 'string',
  name: 'string',
  nameLower: 'string',
  ext: 'dict',
  kind: 'dict',
  isDir: 'bool',
  isHidden: 'bool',
  size: 'i64',
  mtime: 'f64',
};

export class FileCatalog {
  constructor() {
    this.rootDir = '';
    this.table = null;
    this.snapshot = null;
    this.indexing = false;
    this.scanSeq = 0;
  }

  get supported() {
    return !!tableApi();
  }

  activeSource() {
    return this.snapshot || this.table || null;
  }

  rowCount() {
    const src = this.activeSource();
    return src ? src.rowCount : 0;
  }

  close() {
    if (this.snapshot && typeof this.snapshot.close === 'function') {
      try { this.snapshot.close(); } catch (_) { /* ignore */ }
    }
    this.snapshot = null;
    this.table = null;
    this.rootDir = '';
  }

  _buildIndexes(tbl) {
    if (!tbl) return;
    tbl.createIndex('kind');
    tbl.createIndex('ext');
    tbl.createRangeIndex('size');
    tbl.createRangeIndex('mtime');
  }

  async indexDirectory(rootDir, { maxEntries = 200000, onProgress = null } = {}) {
    const q = tableApi();
    if (!q || !rootDir) return 0;

    const mySeq = ++this.scanSeq;
    this.indexing = true;

    const tbl = q.create(CATALOG_SCHEMA);
    const queue = [{ dir: path.resolve(rootDir), hiddenAncestor: false }];
    const resolvedRoot = path.resolve(rootDir);
    let batch = [];
    let total = 0;

    try {
      while (queue.length > 0 && mySeq === this.scanSeq && total < maxEntries) {
        const cur = queue.shift();
        let dirents = [];
        try {
          dirents = await fs.promises.readdir(cur.dir, { withFileTypes: true });
        } catch (_) {
          continue;
        }
        if (mySeq !== this.scanSeq) return 0;

        const relDir = path.relative(resolvedRoot, cur.dir).replace(/\\/g, '/');
        for (const d of dirents) {
          if (!d || !d.name || d.name.startsWith('.brovfs-')) continue;
          if (total >= maxEntries) break;

          const hidden = cur.hiddenAncestor || isHidden(d.name);
          const fullPath = path.join(cur.dir, d.name);
          const isDir = d.isDirectory();
          if (isDir) queue.push({ dir: fullPath, hiddenAncestor: hidden });

          let size = 0;
          let mtime = 0;
          try {
            const st = await fs.promises.stat(fullPath);
            size = isDir ? 0 : (st.size || 0);
            mtime = st.mtimeMs || 0;
          } catch (_) { /* ignore broken links */ }
          if (mySeq !== this.scanSeq) return 0;

          const ext = isDir ? '' : extname(d.name);
          const kind = kindOf(d.name, isDir);
          batch.push({
            path: fullPath,
            dir: relDir,
            name: d.name,
            nameLower: d.name.toLowerCase(),
            ext: ext || '(none)',
            kind,
            isDir,
            isHidden: hidden,
            size: BigInt(Math.max(0, Math.floor(size))),
            mtime,
          });
          total++;

          if (batch.length >= 2048) {
            tbl.insertMany(batch);
            batch = [];
            if (onProgress) onProgress(total);
          }
        }
      }

      if (mySeq !== this.scanSeq) return 0;
      if (batch.length > 0) tbl.insertMany(batch);
      this._buildIndexes(tbl);

      if (this.snapshot && typeof this.snapshot.close === 'function') {
        try { this.snapshot.close(); } catch (_) { /* ignore */ }
      }
      this.snapshot = null;
      this.table = tbl;
      this.rootDir = resolvedRoot;
      if (onProgress) onProgress(total);
      return total;
    } finally {
      if (mySeq === this.scanSeq) this.indexing = false;
    }
  }

  save(filePath, { compress = true } = {}) {
    const src = this.activeSource();
    if (!src || !filePath) return false;
    return src.save(filePath, { compress: !!compress });
  }

  load(filePath, { mmap = true, rootDir = '' } = {}) {
    const q = tableApi();
    if (!q || !filePath) return false;
    if (this.snapshot && typeof this.snapshot.close === 'function') {
      try { this.snapshot.close(); } catch (_) { /* ignore */ }
    }
    this.snapshot = null;
    this.table = null;

    if (mmap) {
      try {
        this.snapshot = q.mmap(filePath);
        if (rootDir) this.rootDir = path.resolve(rootDir);
        return true;
      } catch (_) {
        // Compressed .brotable v4 files fall back cleanly to load().
      }
    }
    this.table = q.load(filePath);
    if (rootDir) this.rootDir = path.resolve(rootDir);
    return !!this.table;
  }

  query({
    query = '',
    ext = '',
    kind = '',
    minSize = null,
    maxSize = null,
    showHidden = true,
    sortId = 'name',
    sortDir = 1,
    limit = 500,
  } = {}) {
    const q = tableApi();
    const src = this.activeSource();
    if (!q || !src) return [];

    let qb = src.query();
    if (!showHidden) qb = qb.where(q.eq('isHidden', false));
    if (kind) qb = qb.where(q.eq('kind', String(kind)));
    if (ext) qb = qb.where(q.eq('ext', String(ext).toLowerCase()));
    if (minSize != null && Number.isFinite(Number(minSize))) {
      qb = qb.where(q.ge('size', BigInt(Math.max(0, Math.floor(Number(minSize))))));
    }
    if (maxSize != null && Number.isFinite(Number(maxSize))) {
      qb = qb.where(q.le('size', BigInt(Math.max(0, Math.floor(Number(maxSize))))));
    }
    const qLower = String(query || '').trim().toLowerCase();
    if (qLower) {
      qb = qb.where(q.contains('nameLower', qLower));
    }

    const orderCol = sortId === 'size' ? 'size' : (sortId === 'mtime' ? 'mtime' : 'nameLower');
    const dirStr = sortDir === -1 ? 'desc' : 'asc';
    const rows = qb.orderBy(orderCol, dirStr).limit(Math.max(1, Number(limit) || 500)).toArray();

    return rows.map((r) => ({
      path: r.path,
      name: r.name,
      nameLower: r.nameLower,
      relDir: r.dir || '',
      isDirectory: !!r.isDir,
      isHidden: !!r.isHidden,
      size: Number(r.size || 0),
      mtime: Number(r.mtime || 0),
      kind: r.kind || kindOf(r.name, !!r.isDir),
      kindLabel: kindLabelOf(r.name, !!r.isDir),
      score: 1,
    }));
  }

  kindBreakdown() {
    const q = tableApi();
    const src = this.activeSource();
    if (!q || !src || src.rowCount === 0) return [];
    const rows = src.query()
      .groupBy('kind')
      .agg({
        count: q.count(),
        totalBytes: q.sum('size'),
      })
      .orderBy('totalBytes', 'desc')
      .toArray();
    return rows.map((r) => ({
      kind: r.kind,
      count: Number(r.count || 0),
      totalBytes: Number(r.totalBytes || 0),
    }));
  }
}
