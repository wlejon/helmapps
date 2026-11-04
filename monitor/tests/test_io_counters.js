// Disk and network throughput from bro.sys.processes.ioCounters(), the
// source on every platform: rates over the counters' own timestamps, loopback
// left out of the network total, and the real machine's counters reaching the
// Performance page (Windows had 0 B/s before brosys had them).

import { app, waitFor, eq } from '/lib/test.js';

function runTick(nowMs) {
  let done = false;
  app.tick(nowMs).then(() => { done = true; });
  waitFor(() => done, 'sampler tick to finish');
}

app.sampler.stop();
app.setPage('performance');

// ---- a stand-in sys API: known counters, two reads 2 s apart ------------------
let reads = 0;
const snapshots = [
  {
    timestamp: 50000,
    disks: [{ name: 'disk0', readBytes: 1000000, writeBytes: 500000, reads: 10, writes: 5 },
            { name: 'disk1', readBytes: 0, writeBytes: 0, reads: 0, writes: 0 }],
    interfaces: [{ name: 'lo', loopback: true, rxBytes: 9e9, txBytes: 9e9, rxPackets: 1, txPackets: 1 },
                 { name: 'eth0', loopback: false, rxBytes: 100000, txBytes: 40000, rxPackets: 10, txPackets: 4 }],
  },
  {
    timestamp: 52000,
    disks: [{ name: 'disk0', readBytes: 1000000 + 4 * 1048576, writeBytes: 500000 + 2 * 1048576, reads: 20, writes: 9 },
            { name: 'disk1', readBytes: 2 * 1048576, writeBytes: 0, reads: 3, writes: 0 }],
    interfaces: [{ name: 'lo', loopback: true, rxBytes: 9.5e9, txBytes: 9.5e9, rxPackets: 2, txPackets: 2 },
                 { name: 'eth0', loopback: false, rxBytes: 100000 + 409600, txBytes: 40000 + 204800, rxPackets: 20, txPackets: 8 }],
  },
];
app.setSysApi({ processes: { ioCounters: () => snapshots[Math.min(reads++, snapshots.length - 1)] } });
runTick(10000);
eq(app.sysSampler.disk.readBps, 0, 'the first read has no rate yet');
runTick(11000);   // a tick 1 s later, counters read 2 s apart: the counters' clock wins
eq(reads, 2, 'ioCounters read once per tick');
const rv = app.resourcesView;
eq(app.sysSampler.disk.readBps, 3 * 1048576, 'disk read: (4 + 2) MiB over 2 s, every disk summed');
eq(app.sysSampler.disk.writeBps, 1048576, 'disk write: 2 MiB over 2 s');
eq(app.sysSampler.net.rxBps, 204800, 'network receive: 400 KiB over 2 s, loopback left out');
eq(app.sysSampler.net.txBps, 102400, 'network send: 200 KiB over 2 s');
eq(rv.diskReadValEl.textContent, '3.0 MB/s', 'the Disk card shows the read rate');
eq(rv.netRxValEl.textContent, '200 KB/s', 'the Network card shows the receive rate');

// A refused or failing call leaves the graphs where they were rather than throwing.
app.setSysApi({ processes: { ioCounters: () => { throw new Error('refused'); } } });
runTick(12000);
eq(app.sysSampler.disk.readBps, 0, 'a refused read leaves disk at 0');

// ---- the real machine ------------------------------------------------------------
app.setSysApi(undefined);
app.setRoot('/');
if (typeof bro.sys?.processes?.ioCounters === 'function') {
  const c = bro.sys.processes.ioCounters();
  runTick(20000);
  runTick(21000);
  assert(app.sysSampler.disk.readBytes > 0 || c.disks.length === 0,
    `the real disks' bytes read reach the sampler (${app.sysSampler.disk.readBytes}, ${c.disks.length} disks)`);
  assert(app.sysSampler.net.rxBytes > 0 || !c.interfaces.some((n) => !n.loopback && n.rxBytes > 0),
    `the real interfaces' bytes received reach the sampler (${app.sysSampler.net.rxBytes})`);
} else {
  console.log('bro.sys.processes.ioCounters is not in this build: the real-machine half is skipped');
}

console.log('test_io_counters PASSED');
