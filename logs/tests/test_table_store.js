// bro.table integration tests for helm.logs:
// - Indexed log entries + incremental ReactiveQuery groupBy severity counts across live tail
// - Indexed filterBySeverity lookup
// - Compressed .brotable v4 and LZ4 .parquet round-trip exports

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const os = require('os');
const path = require('path');

assert(app.logTable && app.logTable.supported, 'LogTableStore is mounted with bro.table');

const dir = fixtureDir({
  'custom/app.log': [
    '2026-10-14T10:00:00Z INFO [srv] Started worker',
    '2026-10-14T10:00:01Z WARN [srv] Slow disk write',
    '2026-10-14T10:00:02Z ERROR [srv] Connection timeout',
    '2026-10-14T10:00:03Z DEBUG [srv] Retrying socket',
  ].join('\n') + '\n',
});

app.setRoot(dir);
waitFor(() => app.state.ready, 'initial source discovery finished');

const logPath = path.join(dir, 'custom', 'app.log');
app.openLogFile(logPath);
waitFor(() => app.state.activeSourceId === path.resolve(logPath) && app.state.entries.length === 4,
  'custom log file loaded into LogTableStore');

let counts = app.logTable.severityCounts();
eq(counts.error, 1, 'initial error count = 1');
eq(counts.warn, 1, 'initial warn count = 1');
eq(counts.info, 1, 'initial info count = 1');
eq(counts.debug, 1, 'initial debug count = 1');
eq(counts.total, 4, 'initial total = 4');

eq(app.logTable.filterBySeverity('error'), [2], 'indexed filterBySeverity(error) returned row index 2');

// Live tail triggers incremental ReactiveQuery update
app.setTail(true);
fs.appendFileSync(logPath, [
  '2026-10-14T10:00:04Z ERROR [srv] Fatal IO fault',
  '2026-10-14T10:00:05Z WARN [srv] Fallback path used',
].join('\n') + '\n', 'utf8');
waitFor(() => app.state.entries.length === 6, 'live tail appended 2 lines');

counts = app.logTable.severityCounts();
eq(counts.error, 2, 'incremental error count = 2');
eq(counts.warn, 2, 'incremental warn count = 2');
eq(counts.total, 6, 'incremental total = 6');
app.setTail(false);

// Export to compressed .brotable & LZ4 .parquet and reload via bro.table
const suffix = `${process.pid}_${Date.now()}`;
const btPath = path.join(os.tmpdir(), `helm_logs_${suffix}.brotable`);
const pqPath = path.join(os.tmpdir(), `helm_logs_${suffix}.parquet`);
let okBt = false;
let okPq = false;
app.exportBrotable(btPath).then((ok) => { okBt = ok; });
app.exportParquet(pqPath).then((ok) => { okPq = ok; });
waitFor(() => okBt && okPq, 'exports finished');

try {
  const rtBt = bro.table.load(btPath);
  eq(rtBt.rowCount, 6, '.brotable export preserved 6 rows');
  const rtPq = bro.table.fromParquetFile(pqPath);
  eq(rtPq.rowCount, 6, '.parquet export preserved 6 rows');
  eq(rtPq.get(4, 'severity'), 'error', 'parquet row 4 severity preserved');
} finally {
  try { fs.unlinkSync(btPath); } catch (_) {}
  try { fs.unlinkSync(pqPath); } catch (_) {}
}

console.log('test_table_store PASSED');
