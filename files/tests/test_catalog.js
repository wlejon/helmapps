// Persistent bro.table file catalog tests for helm.files:
// 1. Async directory indexing populates FileCatalog with typed columns + indexes.
// 2. Native groupBy kindBreakdown() returns accurate counts and byte totals.
// 3. Indexed queries (ext + minSize RangeIndex) and recursive SearchController hit catalog.
// 4. Compressed (.brotable v4) and uncompressed mmap (.brotable v3) round-trips succeed.

import { app, waitFor, eq, press, type, fixtureDir, mod } from '/lib/test.js';

const fs = require('fs');
const os = require('os');
const path = require('path');

const bigPayload = 'x'.repeat(2048);
const dir = fixtureDir({
  'alpha_report.pdf': 'pdf-small',
  'nested/data_set.parquet': 'PAR1-stub',
  'nested/deep/big_log.log': bigPayload,
  'nested/deep/second_big.parquet': bigPayload + bigPayload,
});

assert(app.catalog && app.catalog.supported, 'FileCatalog with bro.table is mounted');

app.views.setViewMode('list');
app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.done, 'fixture dir opened');

let indexedCount = -1;
app.catalog.indexDirectory(dir).then((n) => { indexedCount = n; });
waitFor(() => indexedCount > 0 && !app.catalog.indexing, 'catalog indexing finished');
assert(indexedCount >= 6, `indexed entries >= 6 (got ${indexedCount})`);
eq(app.catalog.rowCount(), indexedCount, 'catalog rowCount matches indexed count');

// Native groupBy kindBreakdown()
const kinds = app.catalog.kindBreakdown();
const dataKind = kinds.find((k) => k.kind === 'data');
assert(dataKind && dataKind.count === 2, `data kind count === 2 (got ${JSON.stringify(dataKind)})`);
assert(dataKind.totalBytes >= 4100, 'data kind summed totalBytes >= 4100');

// Indexed ext + RangeIndex size query
const bigParquets = app.catalog.query({ ext: 'parquet', minSize: 1000 });
eq(bigParquets.length, 1, 'RangeIndex minSize + Dict ext filter returned 1 large parquet');
eq(bigParquets[0].name, 'second_big.parquet', 'matched expected parquet file');

// SearchController uses indexed catalog for recursive search
press(`${mod}+f`);
type('parquet');
press('enter');
waitFor(() => app.state.searchRecursive && !app.state.searching && app.list.items.length === 2,
  'SearchController answered recursive search from FileCatalog');
press('escape');

// Persistence: compressed v4 + uncompressed mmap v3
const suffix = `${process.pid}_${Date.now()}`;
const cmpPath = path.join(os.tmpdir(), `helm_files_cat_v4_${suffix}.brotable`);
const rawPath = path.join(os.tmpdir(), `helm_files_cat_v3_${suffix}.brotable`);
try {
  assert(app.catalog.save(cmpPath, { compress: true }) === true, 'catalog saved compressed v4');
  assert(app.catalog.save(rawPath, { compress: false }) === true, 'catalog saved uncompressed v3');

  assert(app.catalog.load(cmpPath, { mmap: true, rootDir: dir }) === true, 'v4 loaded via fallback');
  eq(app.catalog.rowCount(), indexedCount, 'v4 rowCount preserved');

  assert(app.catalog.load(rawPath, { mmap: true, rootDir: dir }) === true, 'v3 loaded via OS mmap');
  assert(app.catalog.snapshot && app.catalog.snapshot.isMapped === true, 'snapshot isMapped === true');
  eq(app.catalog.query({ ext: 'pdf' }).length, 1, 'mmap query with index succeeded');
} finally {
  app.catalog.close();
  try { fs.unlinkSync(cmpPath); } catch (_) {}
  try { fs.unlinkSync(rawPath); } catch (_) {}
}

console.log('test_catalog PASSED');
