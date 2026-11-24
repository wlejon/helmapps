// Disk I/O history tests for helm.disks powered by bro.table:
// 1. Multiple drive sample ticks record into DiskIoHistory.
// 2. Incremental ReactiveQuery summaryByDevice() computes accurate avg/max rates.
// 3. Export to compressed .brotable v4 and LZ4 .parquet round-trips cleanly.

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const os = require('os');
const path = require('path');

assert(app.ioHistory && app.ioHistory.supported, 'DiskIoHistory with bro.table is mounted');

const root = fixtureDir({
  'proc/mounts': '/dev/nvme0n1p1 / ext4 rw,relatime 0 0\n',
  'proc/partitions': '259 0 1000000 nvme0n1\n259 1 1000000 nvme0n1p1\n',
  'proc/diskstats': '259 0 nvme0n1 100 0 200 10 50 0 100 10 0 20 20\n259 1 nvme0n1p1 100 0 200 10 50 0 100 10 0 20 20\n',
  'sys/block/nvme0n1/size': '2000000\n',
  'sys/block/nvme0n1/removable': '0\n',
  'sys/block/nvme0n1/queue/rotational': '0\n',
  'sys/block/nvme0n1/device/model': 'TestNVMe\n',
  'sys/block/nvme0n1/nvme0n1p1/partition': '1\n',
  'sys/block/nvme0n1/nvme0n1p1/size': '2000000\n',
});

app.model.setRoot(root);
app.model.setMockVolumes([
  { mountPoint: '/', fsType: 'ext4', totalBytes: 1024000000, availableBytes: 512000000, freeBytes: 512000000 },
]);
// Wait for any initial onLaunch refresh, then clear host-volume entries before deterministic ticks.
waitFor(() => !app.state.loading, 'initial load settled');
app.ioHistory.table.clear();
app.model.prevDiskstats = null;
app.model.prevSampleMs = 0;

let done = false;
app.refresh(1000).then(() => { done = true; });
waitFor(() => done, 'tick 1 finished');

// Advance diskstats by +100 read sectors (51200 B) and +40 write sectors (20480 B) over 1 second.
fs.writeFileSync(
  path.join(root, 'proc/diskstats'),
  '259 0 nvme0n1 110 0 300 10 60 0 140 10 0 20 20\n259 1 nvme0n1p1 110 0 300 10 60 0 140 10 0 20 20\n',
);
done = false;
app.refresh(2000).then(() => { done = true; });
waitFor(() => done, 'tick 2 finished');

// Advance again over 1 second (+200 read sectors = 102400 B/s).
fs.writeFileSync(
  path.join(root, 'proc/diskstats'),
  '259 0 nvme0n1 130 0 500 10 70 0 180 10 0 20 20\n259 1 nvme0n1p1 130 0 500 10 70 0 180 10 0 20 20\n',
);
done = false;
app.refresh(3000).then(() => { done = true; });
waitFor(() => done, 'tick 3 finished');

const summary = app.ioHistory.summaryByDevice();
eq(summary.length, 1, 'summaryByDevice has 1 drive');
eq(summary[0].device, '/dev/nvme0n1', 'device name matches');
eq(summary[0].samples, 3, '3 samples recorded');
eq(summary[0].maxReadBps, 102400, 'maxReadBps = 102400 B/s');
eq(summary[0].avgReadBps, 51200, 'avgReadBps = (0 + 51200 + 102400)/3 = 51200 B/s');

const suffix = `${process.pid}_${Date.now()}`;
const btPath = path.join(os.tmpdir(), `helm_disks_${suffix}.brotable`);
const pqPath = path.join(os.tmpdir(), `helm_disks_${suffix}.parquet`);
try {
  assert(app.ioHistory.exportTable(btPath, { compress: true }) === true, 'exported .brotable');
  assert(app.ioHistory.exportParquet(pqPath, { compress: true }) === true, 'exported .parquet');
  eq(bro.table.load(btPath).rowCount, 3, '.brotable reload rowCount = 3');
  eq(bro.table.fromParquetFile(pqPath).rowCount, 3, '.parquet reload rowCount = 3');
} finally {
  try { fs.unlinkSync(btPath); } catch (_) {}
  try { fs.unlinkSync(pqPath); } catch (_) {}
}

console.log('test_io_history PASSED');
