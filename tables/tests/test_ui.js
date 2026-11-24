// End-to-end UI tests for helm.tables Workbench:
// 1. Opens .csv fixture -> renders VirtualList rows -> filters, sorts, and profiles a column.
// 2. GroupBy aggregation produces grouped count/sum/avg/min/max rows.
// 3. Opens .parquet and compressed .brotable v4 files via mmap/load.
// 4. Opens multi-table .brotable bundle and switches active bundle tables.
// 5. Exports filtered result to .parquet and .brotable and verifies round-trip.

import { app, waitFor, eq } from '/lib/test.js';

const fs = require('fs');
const os = require('os');
const path = require('path');

assert(app.session && app.session.supported, 'TableSession with bro.table is mounted');

const suffix = `${process.pid}_${Date.now()}`;
const tmpDir = os.tmpdir();
const csvPath = path.join(tmpDir, `helm_tables_${suffix}.csv`);
const pqPath = path.join(tmpDir, `helm_tables_${suffix}.parquet`);
const btPath = path.join(tmpDir, `helm_tables_v4_${suffix}.brotable`);
const bndPath = path.join(tmpDir, `helm_tables_bnd_${suffix}.brotable`);
const expPqPath = path.join(tmpDir, `helm_tables_exp_${suffix}.parquet`);
const expBtPath = path.join(tmpDir, `helm_tables_exp_${suffix}.brotable`);

try {
  // 1. Build CSV, Parquet, v4 .brotable, and bundle fixtures
  fs.writeFileSync(csvPath, [
    'id,dept,score',
    '1,eng,95.5',
    '2,ops,81.0',
    '3,eng,88.5',
    '4,sci,92.0',
    '5,ops,76.5',
  ].join('\n') + '\n', 'utf8');

  const srcTbl = bro.table.create({ id: 'i32', dept: 'dict', score: 'f64' });
  srcTbl.insertMany([
    { id: 1, dept: 'eng', score: 95.5 },
    { id: 2, dept: 'ops', score: 81.0 },
    { id: 3, dept: 'eng', score: 88.5 },
    { id: 4, dept: 'sci', score: 92.0 },
    { id: 5, dept: 'ops', score: 76.5 },
  ]);
  const auxTbl = bro.table.create({ code: 'i32', label: 'string' });
  auxTbl.insertMany([{ code: 10, label: 'alpha' }, { code: 20, label: 'beta' }]);

  srcTbl.saveParquet(pqPath, { compress: true });
  srcTbl.save(btPath, { compress: true });
  bro.table.saveBundle(bndPath, { metrics: srcTbl, lookup: auxTbl }, { compress: false });

  // Open CSV in Workbench
  const csvInfo = app.openFile(csvPath);
  assert(csvInfo && csvInfo.viewRows === 5 && csvInfo.columnCount === 3, 'opened 5x3 CSV');
  waitFor(() => document.querySelectorAll('.vlist-row').length === 5, '5 VirtualList rows rendered');

  // Column profiling
  app.selectColumn('dept');
  const prof = app.profileColumn('dept');
  eq(prof.buckets.length, 3, 'dept profile has 3 frequency buckets');
  assert(!document.querySelector('.tbl-profiler').classList.contains('hidden'), 'profiler drawer visible');

  // Filter + Sort
  app.setFilter('score', 'ge', '88');
  eq(app.session.info().viewRows, 3, 'filter score >= 88 matched 3 rows');
  app.setSort('score', 'desc');
  eq(app.list.items[0].id, 1, 'sorted descending first row id=1');

  // Export filtered subset to Parquet + .brotable
  let okPq = false;
  let okBt = false;
  app.exportFile(expPqPath, 'parquet').then((ok) => { okPq = ok; });
  app.exportFile(expBtPath, 'brotable').then((ok) => { okBt = ok; });
  waitFor(() => okPq && okBt, 'exports finished');
  eq(bro.table.fromParquetFile(expPqPath).rowCount, 3, 'exported Parquet has 3 filtered rows');
  eq(bro.table.load(expBtPath).rowCount, 3, 'exported .brotable has 3 filtered rows');

  // Clear + GroupBy
  app.clearFilter();
  app.setGroupBy('dept', 'score');
  eq(app.session.info().viewRows, 3, 'groupBy dept produced 3 grouped rows');
  const engRow = app.list.items.find((r) => r.dept === 'eng');
  assert(engRow && Number(engRow.count) === 2 && Math.abs(Number(engRow.avg) - 92.0) < 1e-6,
    'eng group avg=92.0');

  // Open Parquet + compressed v4 .brotable
  const pqInfo = app.openFile(pqPath);
  eq(pqInfo.viewRows, 5, 'opened Parquet 5 rows');
  const btInfo = app.openFile(btPath);
  eq(btInfo.viewRows, 5, 'opened v4 .brotable 5 rows');

  // Open multi-table bundle and switch tables
  const bndInfo = app.openFile(bndPath);
  assert(bndInfo.isMapped === true && bndInfo.bundleNames.length === 2, 'opened mmap bundle with 2 tables');
  assert(app.selectBundleTable('lookup') === true, 'switched bundle table to lookup');
  eq(app.session.info().viewRows, 2, 'lookup table has 2 rows');
} finally {
  app.session.close();
  for (const p of [csvPath, pqPath, btPath, bndPath, expPqPath, expBtPath]) {
    try { fs.unlinkSync(p); } catch (_) {}
  }
}

console.log('test_ui PASSED');
