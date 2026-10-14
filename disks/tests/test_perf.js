// Performance test for Disks (`helm.disks`):
// - Verifies fast startup (firstFrameMs - loadedMs < 250 ms)
// - Builds a fixture of 24 physical drives and 96 partitions
// - Measures refreshing, rendering the partition layout map, switching drives
//   and partitions, and filtering under measureFrames(), asserting worst frame < 50 ms.

import { app, waitFor, measureFrames, eq, fixtureDir } from '/lib/test.js';

const FRAME_BUDGET_MS = 50;
const GB_SECTORS = (1024 * 1024 * 1024) / 512;
const GB_BYTES = 1024 * 1024 * 1024;

// 1. Startup timing
const s = bro.app.startup;
assert(s && s.firstFrameMs > 0, 'bro.app.startup reports the first frame');
console.log(`startup: page loaded ${s.loadedMs.toFixed(0)} ms, first frame ${s.firstFrameMs.toFixed(0)} ms after start`);
assert(s.firstFrameMs - s.loadedMs < 250, `first frame follows load quickly (${(s.firstFrameMs - s.loadedMs).toFixed(0)} ms)`);

// 2. Build a 24-drive, 96-partition fixture
const tree = {};
const mounts = [];
const parts = ['major minor  #blocks  name'];
const stats = [];
const mockVolumes = [];

for (let d = 0; d < 24; d++) {
  const dev = `nvme${d}n1`;
  tree[`sys/block/${dev}/size`] = String(1000 * GB_SECTORS);
  tree[`sys/block/${dev}/removable`] = d % 6 === 0 ? '1' : '0';
  tree[`sys/block/${dev}/ro`] = '0';
  tree[`sys/block/${dev}/queue/rotational`] = d % 3 === 0 ? '1' : '0';
  tree[`sys/block/${dev}/device/vendor`] = 'HelmStorage';
  tree[`sys/block/${dev}/device/model`] = `Enterprise Array ${d}`;
  parts.push(` 259 ${d * 16} ${1000 * 1048576} ${dev}`);
  stats.push(` 259 ${d * 16} ${dev} ${1000 * (d + 1)} 0 ${50000 * (d + 1)} 100 500 0 ${25000 * (d + 1)} 50 0 100 150 0 0 0 0`);

  for (let p = 1; p <= 4; p++) {
    const part = `${dev}p${p}`;
    const mnt = `/mnt/d${d}_p${p}`;
    tree[`sys/block/${dev}/${part}/partition`] = String(p);
    tree[`sys/block/${dev}/${part}/start`] = String((p - 1) * 200 * GB_SECTORS + 2048);
    tree[`sys/block/${dev}/${part}/size`] = String(200 * GB_SECTORS);
    tree[`sys/block/${dev}/${part}/ro`] = '0';
    mounts.push(`/dev/${part} ${mnt} ext4 rw,relatime 0 0`);
    parts.push(` 259 ${d * 16 + p} ${200 * 1048576} ${part}`);
    stats.push(` 259 ${d * 16 + p} ${part} 250 0 12500 25 125 0 6250 12 0 25 37 0 0 0 0`);
    mockVolumes.push({
      mountPoint: mnt,
      volumeLabel: `Vol_${d}_${p}`,
      fsType: p === 1 ? 'vfat' : 'ext4',
      totalBytes: 200 * GB_BYTES,
      freeBytes: (50 + p * 20) * GB_BYTES,
      availableBytes: (50 + p * 20) * GB_BYTES,
    });
  }
}

tree['proc/mounts'] = mounts.join('\n');
tree['proc/partitions'] = parts.join('\n');
tree['proc/diskstats'] = stats.join('\n');

const root = fixtureDir(tree);
advanceTime(16);
app.model.setRoot(root);
app.model.setMockVolumes(mockVolumes);
app.refresh(1000);

const loadFrames = measureFrames(
  () => app.state.drives.length === 24 && !app.state.loading,
  'loading 24 drives and 96 partitions',
);
console.log(`load 24 drives (96 partitions): ${loadFrames.frames} frames, worst ${loadFrames.maxMs.toFixed(1)} ms, avg ${loadFrames.avgMs.toFixed(1)} ms`);
assert(loadFrames.maxMs < FRAME_BUDGET_MS, `loading 24 drives stays under ${FRAME_BUDGET_MS} ms (worst ${loadFrames.maxMs.toFixed(1)} ms)`);

// 3. Measure switching across all 24 drives, stepping partitions, and filtering
let step = 0;
const navFrames = measureFrames(() => {
  if (step < 24) {
    const drive = app.state.drives[step];
    app.selectDrive(drive.id);
    if (drive.segments.length > 1) app.selectPartition(drive.segments[step % drive.segments.length].id);
    step++;
    return false;
  }
  if (step === 24) {
    app.setFilter('Array 1');
    step++;
    return false;
  }
  app.setFilter('');
  return app.state.filteredDrives.length === 24;
}, 'navigating 24 drives and filtering');

console.log(`navigate & filter 24 drives: ${navFrames.frames} frames, worst ${navFrames.maxMs.toFixed(1)} ms, avg ${navFrames.avgMs.toFixed(1)} ms`);
assert(navFrames.maxMs < FRAME_BUDGET_MS, `navigation & filtering stays under ${FRAME_BUDGET_MS} ms (worst ${navFrames.maxMs.toFixed(1)} ms)`);
eq(app.state.drives.length, 24, 'all 24 drives present');

console.log('test_perf PASSED');
