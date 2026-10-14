// End-to-end tests for the Performance page charts and File Systems page.

import { app, waitFor, settle, eq, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

function runTick(nowMs = Date.now()) {
  let done = false;
  app.tick(nowMs).then(() => { done = true; });
  waitFor(() => done, 'sampler tick to finish');
}

app.sampler.stop();

const fakeRoot = fixtureDir({
  'proc/cpuinfo': 'processor\t: 0\nmodel name\t: AMD Ryzen 9 7950X 16-Core Processor\n',
  'proc/uptime': '7325.00 14000.00\n',
  'proc/loadavg': '1.50 0.75 0.25 2/400 1234\n',
  'proc/stat': [
    'cpu  1000 0 200 8800 0 0 0 0 0 0',
    'cpu0 500 0 100 4400 0 0 0 0 0 0',
    'cpu1 300 0 50 4650 0 0 0 0 0 0',
    'cpu2 100 0 30 4870 0 0 0 0 0 0',
    'cpu3 100 0 20 4880 0 0 0 0 0 0',
  ].join('\n'),
  'proc/meminfo': [
    'MemTotal:       16777216 kB',
    'MemFree:         4194304 kB',
    'MemAvailable:    8388608 kB',
    'SwapTotal:       4194304 kB',
    'SwapFree:        3145728 kB',
  ].join('\n'),
  'proc/diskstats': '   8       0 sda 100 0 2000 10 100 0 1000 10 0 10 20\n',
  'proc/net/dev': [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo:   10000      10    0    0    0     0          0         0    10000      10    0    0    0     0       0          0',
    '  eth0:  100000     100    0    0    0     0          0         0    50000      50    0    0    0     0       0          0',
  ].join('\n'),
  'sys/class/drm/card0/device/gpu_busy_percent': '42\n',
  'sys/class/drm/card0/device/mem_info_vram_used': String(2 * 1024 * 1024 * 1024) + '\n',
  'sys/class/drm/card0/device/mem_info_vram_total': String(8 * 1024 * 1024 * 1024) + '\n',
});

app.setRoot(fakeRoot);
app.setPage('performance');
runTick(10000);

// Second tick 1 second later (nowMs = 11000) with known deltas:
// CPU total: active +400, total +1000 -> 40.0%
// Disk sda: +2048 sectors read (1 MB/s), +1024 sectors written (512 KB/s)
// Net eth0: +204800 rxBytes (200 KB/s), +102400 txBytes (100 KB/s)
// GPU busy: 68%, VRAM: 4 GB / 8 GB (50%)
fs.writeFileSync(path.join(fakeRoot, 'proc/stat'), [
  'cpu  1300 0 300 9400 0 0 0 0 0 0',
  'cpu0 700 0 150 4650 0 0 0 0 0 0',
  'cpu1 400 0 75 4925 0 0 0 0 0 0',
  'cpu2 100 0 50 5100 0 0 0 0 0 0',
  'cpu3 100 0 25 5125 0 0 0 0 0 0',
].join('\n'));
fs.writeFileSync(path.join(fakeRoot, 'proc/diskstats'), '   8       0 sda 120 0 4048 15 110 0 2024 15 0 15 30\n');
fs.writeFileSync(path.join(fakeRoot, 'proc/net/dev'), [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '  eth0:  304800     200    0    0    0     0          0         0   152400     100    0    0    0     0       0          0',
].join('\n'));
fs.writeFileSync(path.join(fakeRoot, 'sys/class/drm/card0/device/gpu_busy_percent'), '68\n');
fs.writeFileSync(path.join(fakeRoot, 'sys/class/drm/card0/device/mem_info_vram_used'), String(4 * 1024 * 1024 * 1024) + '\n');

runTick(11000);

const rv = app.resourcesView;
eq(rv.cpuModelEl.textContent, 'AMD Ryzen 9 7950X 16-Core Processor', 'Performance header displays CPU model');
eq(rv.uptimeValEl.textContent, '2:02:05', 'Performance header displays formatted uptime');
eq(rv.loadValEl.textContent, '1.50, 0.75, 0.25', 'Performance header displays load average');
eq(rv.cpuValEl.textContent, '40.0%', 'CPU total readout shows 40.0%');
eq(rv.memSubEl.textContent, '50.0%', 'Memory percentage readout shows 50.0%');
eq(rv.diskReadValEl.textContent, '1.0 MB/s', 'Disk read throughput shows 1.0 MB/s');
eq(rv.diskWriteValEl.textContent, 'W: 512 KB/s', 'Disk write throughput shows 512 KB/s');
eq(rv.netRxValEl.textContent, '200 KB/s', 'Network receive throughput shows 200 KB/s');
eq(rv.netTxValEl.textContent, 'Up: 100 KB/s', 'Network transmit throughput shows 100 KB/s');
eq(rv.gpuCard.classList.contains('hidden'), false, 'GPU card is visible when amdgpu sysfs files exist');
eq(rv.gpuValEl.textContent, '68%', 'GPU busy readout shows 68%');
assert(rv.gpuVramEl.textContent.includes('4.0 GB / 8.0 GB'), 'GPU VRAM readout shows 4.0 GB / 8.0 GB');

// Verify charts only redraw once per tick (no 60 fps loop)
const drawsBefore = rv.cpuChart.drawCount;
settle(150);
eq(rv.cpuChart.drawCount, drawsBefore, 'charts do not redraw between ticks (60fps-free)');

// Toggle per-core small multiples
rv.setPerCore(true);
eq(app.settings.get('perCore'), true, 'perCore setting persisted');
eq(rv.coreCells.length, 4, 'four per-core small multiple charts created');
assert(rv.coreCells[0].chart.drawCount > 0, 'per-core charts rendered');

// ---- File Systems page -------------------------------------------------------
app.setPage('filesystems');
app.filesystemsView.setVolumes([
  {
    mountPoint: '/',
    volumeLabel: 'Root',
    fsType: 'ext4',
    totalBytes: 100 * 1024 * 1024 * 1024,
    availableBytes: 40 * 1024 * 1024 * 1024,
    freeBytes: 40 * 1024 * 1024 * 1024,
  },
  {
    mountPoint: '/home',
    volumeLabel: 'Home',
    fsType: 'btrfs',
    totalBytes: 500 * 1024 * 1024 * 1024,
    availableBytes: 350 * 1024 * 1024 * 1024,
    freeBytes: 350 * 1024 * 1024 * 1024,
  },
]);

const cards = document.querySelectorAll('.mon-fs-card');
eq(cards.length, 2, 'two volume cards rendered on File Systems page');
assert(cards[0].querySelector('.progress'), 'volume card has a Progress bar');
assert(cards[0].textContent.includes('ext4'), 'volume card shows filesystem type');
assert(cards[0].textContent.includes('40.0 GB free'), 'volume card shows free space');
assert(cards[0].textContent.includes('Open in Disk Usage'), 'volume card offers Open in Disk Usage');

console.log('test_charts PASSED');
