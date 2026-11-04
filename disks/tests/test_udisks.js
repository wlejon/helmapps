// Disks over UDisks2 (`bro.sys.disks`):
// - a scripted bro.sys.disks over a /sys/block + /proc fixture: drives and
//   partitions matched by device path, the health card from SMART (NVMe good,
//   then a warning), Mount / Unmount on partitions (not on /), Eject and
//   Power Off (after a confirm) on the removable drive, a refusal shown as a
//   toast, and a UDisks change event refreshing the view
// - the real bro.sys.disks where this machine has one: drives annotated and
//   SMART read without error, nothing mounted or ejected

import { app, waitFor, eq, clickEl, currentDialog, dialogButton, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const GB_SECTORS = (1024 * 1024 * 1024) / 512;
const GB_BYTES = 1024 * 1024 * 1024;

const root = fixtureDir({
  'sys/block/nvme0n1/size': String(500 * GB_SECTORS),
  'sys/block/nvme0n1/removable': '0',
  'sys/block/nvme0n1/ro': '0',
  'sys/block/nvme0n1/queue/rotational': '0',
  'sys/block/nvme0n1/device/model': 'Lexar SSD NQ790',
  'sys/block/nvme0n1/nvme0n1p1/partition': '1',
  'sys/block/nvme0n1/nvme0n1p1/start': '2048',
  'sys/block/nvme0n1/nvme0n1p1/size': String(1 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p2/partition': '2',
  'sys/block/nvme0n1/nvme0n1p2/start': String(2048 + 1 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p2/size': String(150 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p3/partition': '3',
  'sys/block/nvme0n1/nvme0n1p3/start': String(2048 + 151 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p3/size': String(349 * GB_SECTORS),

  'sys/block/sda/size': String(64 * GB_SECTORS),
  'sys/block/sda/removable': '1',
  'sys/block/sda/ro': '0',
  'sys/block/sda/device/vendor': 'Kingston',
  'sys/block/sda/device/model': 'DataTraveler',
  'sys/block/sda/sda1/partition': '1',
  'sys/block/sda/sda1/start': '2048',
  'sys/block/sda/sda1/size': String(64 * GB_SECTORS),

  'proc/mounts': '',
  'proc/partitions': '',
  'proc/diskstats': '',
});

// The kernel's mount table, which the fake rewrites as UDisks would change it.
const mounts = new Map([
  ['/dev/nvme0n1p1', '/boot/efi vfat rw,relatime'],
  ['/dev/nvme0n1p2', '/ ext4 rw,relatime'],
  ['/dev/nvme0n1p3', '/home btrfs rw,relatime'],
  ['/dev/sda1', '/run/media/j/STICK exfat rw,nosuid,nodev'],
]);
function writeMounts() {
  const text = [...mounts].map(([dev, rest]) => `${dev} ${rest} 0 0`).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'proc/mounts'), text);
}
writeMounts();

const NVME = '/org/freedesktop/UDisks2/drives/Lexar_SSD_NQ790_1';
const STICK = '/org/freedesktop/UDisks2/drives/Kingston_DataTraveler_2';
const B = (name) => '/org/freedesktop/UDisks2/block_devices/' + name;

function block(name, drive, extra = {}) {
  const device = '/dev/' + name;
  const mp = mounts.has(device) ? [mounts.get(device).split(' ')[0]] : [];
  return {
    id: B(name), device, preferredDevice: device, drive, size: 0, readOnly: false,
    usage: extra.isFilesystem ? 'filesystem' : '', type: extra.type || '', label: extra.label || '',
    uuid: '', hintSystem: drive === NVME, hintIgnore: false, hintAuto: drive !== NVME, hintName: '', hintIcon: '',
    partition: extra.partition || null, partitionTable: extra.partitionTable || '',
    isFilesystem: Boolean(extra.isFilesystem), mountPoints: mp, mounted: mp.length > 0,
    loopBackingFile: '', cryptoBackingDevice: '',
  };
}

const goodSmart = {
  drive: NVME, kind: 'nvme', supported: true, enabled: true, updated: Date.UTC(2026, 10, 4, 12), failing: false,
  assessment: 'good', temperatureC: 35.85, powerOnHours: 28, percentUsed: 1, availableSpare: 100, spareThreshold: 10,
  badSectors: null, powerCycles: 41, unsafeShutdowns: 3, mediaErrors: 0, bytesRead: 1e12, bytesWritten: 2.5e12,
  criticalWarnings: [], selftestStatus: '', attributes: [{ id: 0, name: 'avail_spare', value: null, worst: null, threshold: null, raw: 100, unit: '%', failing: false }],
};

const calls = [];
const listeners = new Map();
let smartResult = goodSmart;
let refuseNextUnmount = false;
let getStateCount = 0;

const fake = {
  available: true,
  getState() {
    getStateCount++;
    return {
      available: true, reason: '',
      drives: [
        { id: NVME, vendor: '', model: 'Lexar SSD NQ790', serial: 'QHM541', size: 500 * GB_BYTES, connectionBus: '',
          removable: false, mediaRemovable: false, mediaAvailable: true, ejectable: false, canPowerOff: false,
          smartKind: 'nvme', smartSupported: true },
        { id: STICK, vendor: 'Kingston', model: 'DataTraveler', serial: 'K1', size: 64 * GB_BYTES, connectionBus: 'usb',
          removable: true, mediaRemovable: true, mediaAvailable: true, ejectable: true, canPowerOff: true,
          smartKind: null, smartSupported: false },
      ],
      blocks: [
        block('nvme0n1', NVME, { partitionTable: 'gpt' }),
        block('nvme0n1p1', NVME, { isFilesystem: true, type: 'vfat', label: 'EFI', partition: { number: 1 } }),
        block('nvme0n1p2', NVME, { isFilesystem: true, type: 'ext4', label: 'root', partition: { number: 2 } }),
        block('nvme0n1p3', NVME, { isFilesystem: true, type: 'btrfs', label: 'home', partition: { number: 3 } }),
        block('sda', STICK, { partitionTable: 'dos' }),
        block('sda1', STICK, { isFilesystem: true, type: 'exfat', label: 'STICK', partition: { number: 1 } }),
      ],
    };
  },
  async mount(id, opts) {
    calls.push(['mount', id]);
    const dev = '/dev/' + id.split('/').pop();
    mounts.set(dev, '/run/media/j/STICK exfat rw,nosuid,nodev');
    writeMounts();
    return '/run/media/j/STICK';
  },
  async unmount(id) {
    calls.push(['unmount', id]);
    if (refuseNextUnmount) {
      refuseNextUnmount = false;
      throw new Error('Not authorized to perform operation');
    }
    mounts.delete('/dev/' + id.split('/').pop());
    writeMounts();
  },
  async eject(id) { calls.push(['eject', id]); },
  async powerOff(id) { calls.push(['powerOff', id]); },
  async smart(id) {
    calls.push(['smart', id]);
    return { ...smartResult, drive: id };
  },
  on(type, fn) { listeners.set(fn, type); },
  off(type, fn) { listeners.delete(fn); },
  emit(ev) { for (const [fn, type] of listeners) if (type === 'change') fn(ev); },
};

const q = (sel) => document.querySelector(sel);
const visible = (sel) => q(sel) && !q(sel).classList.contains('hidden');
const toastText = () => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent).join(' | ');

app.model.setRoot(root);
app.model.setMockVolumes([
  { mountPoint: '/', volumeLabel: '', fsType: 'ext4', totalBytes: 150 * GB_BYTES, freeBytes: 90 * GB_BYTES, availableBytes: 90 * GB_BYTES },
]);
app.setDisks(fake);
waitFor(() => app.state.drives.length === 2 && app.state.drives.every((d) => d.udisks), 'drives annotated from UDisks');

const nvme = app.state.drives.find((d) => d.device === '/dev/nvme0n1');
eq(nvme.udisks.id, NVME, 'the NVMe drive matched by its whole-disk block');
eq(nvme.segments.find((s) => s.device === '/dev/nvme0n1p3').block.id, B('nvme0n1p3'), 'partitions matched by device path');

// 1. The NVMe drive: a health card from SMART, no eject / power off.
app.selectDrive('/dev/nvme0n1');
waitFor(() => calls.some((c) => c[0] === 'smart' && c[1] === NVME), 'SMART read for the NVMe drive');
waitFor(() => q('.disks-health-badge').textContent === 'Healthy', 'health badge');
assert(visible('.disks-health-card'), 'the health card is shown');
eq(q('.disks-health-temp').textContent, '36 °C', 'temperature');
eq(q('.disks-health-hours').textContent, '28 h', 'power-on hours');
eq(q('.disks-health-wear').textContent, '1% used', 'NVMe wear');
eq(q('.disks-health-spare').textContent, '100% (min 10%)', 'available spare');
eq(q('.disks-health-shutdowns').textContent, '3', 'unsafe shutdowns');
assert(!visible('.disks-health-warn'), 'no warnings');
assert(!visible('.disks-btn-eject') && !visible('.disks-btn-poweroff'), 'an internal NVMe has no eject or power off');

// Root cannot be unmounted from here; /home can.
app.selectPartition('/dev/nvme0n1p2');
assert(!visible('.disks-btn-unmount') && !visible('.disks-btn-mount'), 'no unmount on /');
app.selectPartition('/dev/nvme0n1p3');
assert(visible('.disks-btn-unmount'), 'unmount offered on /home');

// A warning: SMART read again.
smartResult = { ...goodSmart, assessment: 'warning', criticalWarnings: ['temperature'], temperatureC: 81 };
clickEl(q('.disks-health-refresh'));
waitFor(() => q('.disks-health-badge').textContent === 'Warning', 'warning badge after reading again');
assert(q('.disks-health-warn').textContent.includes('temperature over its limit'), 'the warning is spelled out');
eq(q('.disks-health-badge').className.includes('warn'), true, 'warning styling');

// 2. The USB stick: eject and power off, no health card.
app.selectDrive('/dev/sda');
assert(!visible('.disks-health-card'), 'no SMART, no health card');
assert(visible('.disks-btn-eject') && visible('.disks-btn-poweroff'), 'eject and power off offered');
eq(app.state.selectedPartitionId, '/dev/sda1', 'sda1 selected');
assert(visible('.disks-btn-unmount') && !visible('.disks-btn-mount'), 'a mounted stick offers unmount');

// A refused unmount is a toast with UDisks' message; nothing changes.
refuseNextUnmount = true;
clickEl(q('.disks-btn-unmount'));
waitFor(() => toastText().includes('Not authorized to perform operation'), 'the refusal is shown');
assert(toastText().includes('Could not unmount /dev/sda1'), 'naming the device');
waitFor(() => !app.state.busy, 'the action finished');
assert(visible('.disks-btn-unmount'), 'still mounted');

// Unmount, then mount again.
clickEl(q('.disks-btn-unmount'));
waitFor(() => calls.filter((c) => c[0] === 'unmount').length === 2, 'unmount called');
eq(calls.filter((c) => c[0] === 'unmount')[1][1], B('sda1'), 'unmount of the sda1 block');
waitFor(() => visible('.disks-btn-mount') && !app.state.busy, 'unmounted: mount offered');
eq(q('.disks-mount-none').classList.contains('hidden'), false, 'shows Not mounted');

clickEl(q('.disks-btn-mount'));
waitFor(() => calls.some((c) => c[0] === 'mount' && c[1] === B('sda1')), 'mount called with the sda1 block');
waitFor(() => q('.disks-mount-link').textContent === '/run/media/j/STICK' && !app.state.busy, 'mounted where UDisks put it');
assert(toastText().includes('Mounted STICK at /run/media/j/STICK'), 'mount toast: ' + toastText());

// Eject.
clickEl(q('.disks-btn-eject'));
waitFor(() => calls.some((c) => c[0] === 'eject' && c[1] === STICK), 'eject of the stick');
waitFor(() => !app.state.busy, 'eject finished');

// Power off asks first; Cancel does nothing, Power Off does it.
clickEl(q('.disks-btn-poweroff'));
waitFor(() => currentDialog(), 'power off asks first');
dialogButton('Cancel');
waitFor(() => !currentDialog(), 'dialog closed');
assert(!calls.some((c) => c[0] === 'powerOff'), 'cancel powers nothing off');
clickEl(q('.disks-btn-poweroff'));
waitFor(() => currentDialog(), 'asked again');
dialogButton('Power Off');
waitFor(() => calls.some((c) => c[0] === 'powerOff' && c[1] === STICK), 'power off of the stick');
waitFor(() => !app.state.busy, 'power off finished');

// 3. A change from UDisks refreshes the view.
mounts.delete('/dev/sda1');
writeMounts();
const before = getStateCount;
fake.emit({ type: 'unmounted', block: {} });
waitFor(() => getStateCount > before && visible('.disks-btn-mount'), 'a change event refreshes the view');

// 4. The real bro.sys.disks, where there is one.
const real = typeof bro !== 'undefined' && bro.sys && bro.sys.disks;
if (real && real.available !== false && process.platform === 'linux' && real.getState().available) {
  app.model.setRoot('/');
  app.model.setMockVolumes(null);
  let realLoaded = false;
  app.setDisks(undefined).then(() => { realLoaded = true; });
  waitFor(() => realLoaded, 'the real drives', 20000);
  const st = real.getState();
  if (st.drives.length) {
    assert(app.state.drives.some((d) => d.udisks), 'a real drive annotated from UDisks');
    const smartable = app.state.drives.find((d) => d.udisks && d.udisks.smartSupported);
    if (smartable) {
      app.selectDrive(smartable.id);
      waitFor(() => {
        const e = app.state.smart.get(smartable.udisks.id);
        return e && !e.loading;
      }, 'the real SMART read', 20000);
      const e = app.state.smart.get(smartable.udisks.id);
      assert(!e.error, 'SMART reads: ' + e.error);
      assert(visible('.disks-health-card') && q('.disks-health-badge').textContent !== 'Reading…', 'the real health card');
      console.log(`real SMART ${smartable.title}: ${e.data.assessment}, ${q('.disks-health-temp').textContent}`);
    }
  }
} else {
  console.log('no bro.sys.disks here: the real daemon was not read');
}

console.log('test_udisks PASSED');
