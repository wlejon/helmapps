// Columnar TelemetryStore tests for helm.monitor:
// 1. Multi-tick recording populates sysTable (RangeIndex on ts) & procTable (HashIndex on user/state).
// 2. Native sysWindow range query & groupBy('user') userSummary() return accurate aggregates.
// 3. saveBundle -> loadBundle round-trips both system and process tables cleanly.

import { app, waitFor, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const os = require('os');
const path = require('path');

function runTick(nowMs) {
  let done = false;
  app.tick(nowMs).then(() => { done = true; });
  waitFor(() => done, `tick ${nowMs} finished`);
}

app.sampler.stop();
assert(app.telemetry && app.telemetry.supported, 'TelemetryStore with bro.table is mounted');

const root = fixtureDir({
  'etc/passwd': 'root:x:0:0:root:/root:/bin/bash\njonny:x:1000:1000:Jonny:/home/jonny:/bin/bash\n',
  'proc/stat': 'cpu  1000 0 500 8500 0 0 0 0 0 0\n',
  'proc/meminfo': 'MemTotal: 8000000 kB\nMemAvailable: 5000000 kB\n',
  'proc/loadavg': '0.42 0.35 0.28 1/200 500\n',
  'proc/uptime': '1200.00 2000.00\n',
  'proc/101/stat': '101 (svc-a) R 1 101 101 0 -1 4194304 10 0 0 0 100 50 0 0 20 0 2 0 1000 104857600 2000 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n',
  'proc/101/status': 'Name:\tsvc-a\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t8000 kB\nThreads:\t2\n',
  'proc/202/stat': '202 (svc-b) S 1 202 202 0 -1 4194304 10 0 0 0 50 50 0 0 20 0 4 0 1000 104857600 8000 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n',
  'proc/202/status': 'Name:\tsvc-b\nUid:\t0\t0\t0\t0\nVmRSS:\t32000 kB\nThreads:\t4\n',
});

app.setRoot(root);
runTick(1000);
runTick(2000);
runTick(3000);

eq(app.telemetry.sysTable.rowCount, 3, 'sysTable recorded 3 ticks');
const win = app.telemetry.sysWindow(1500, 2500);
eq(win.length, 1, 'RangeIndex ts window [1500, 2500] returned middle tick');
eq(win[0].ts, 2000, 'RangeIndex window matched ts=2000');

const byUser = app.telemetry.userSummary();
eq(byUser.length, 2, 'groupBy(user) returned 2 users');
eq(byUser[0].user, 'root', 'highest-memory user is root');
eq(byUser[0].procs, 1, 'root has 1 process');

const bundlePath = path.join(os.tmpdir(), `helm_mon_${process.pid}_${Date.now()}.brotable`);
let exported = false;
app.exportTelemetry(bundlePath).then((ok) => { exported = ok; });
waitFor(() => exported, 'bundle export finished');

try {
  const bnd = bro.table.loadBundle(bundlePath);
  assert(bnd && bnd.system && bnd.processes, 'loadBundle restored both tables');
  eq(bnd.system.rowCount, 3, 'bundle system table has 3 rows');
  eq(bnd.processes.rowCount, 2, 'bundle processes table has 2 rows');
} finally {
  try { fs.unlinkSync(bundlePath); } catch (_) {}
}

console.log('test_telemetry_table PASSED');
