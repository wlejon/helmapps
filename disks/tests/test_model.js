// Unit tests for pure parsers and topology grouping in disks/js/disks-model.js.

import { app, eq } from '/lib/test.js';

const {
  parseProcMounts,
  parseProcPartitions,
  parseProcDiskstats,
  computeDiskIoRates,
  classifyDriveMedia,
  groupVolumesAndBlockDevices,
} = app.parsers;

// 1. parseProcMounts (including octal escape sequences like \040)
const mountsText = [
  'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0',
  '/dev/nvme0n1p1 /boot/efi vfat rw,relatime,fmask=0022,dmask=0022 0 0',
  '/dev/nvme0n1p2 / ext4 rw,relatime,errors=remount-ro 0 0',
  '/dev/sdb1 /run/media/user/USB\\040Stick exfat ro,nosuid,nodev 0 0',
].join('\n');

const mounts = parseProcMounts(mountsText);
eq(mounts.length, 4, 'parsed 4 mount lines');
eq(mounts[1].device, '/dev/nvme0n1p1', 'EFI device');
eq(mounts[1].mountPoint, '/boot/efi', 'EFI mountPoint');
eq(mounts[1].fsType, 'vfat', 'EFI fsType');
eq(mounts[1].isReadOnly, false, 'EFI is rw');
eq(mounts[3].mountPoint, '/run/media/user/USB Stick', 'unescaped \\040 space in mountPoint');
eq(mounts[3].isReadOnly, true, 'ro mount flag detected');

// 2. parseProcPartitions
const partsText = [
  'major minor  #blocks  name',
  '',
  ' 259        0  500107608 nvme0n1',
  ' 259        1     524288 nvme0n1p1',
  ' 259        2  104857600 nvme0n1p2',
  '   8        0   31266816 sda',
  '   8        1   31265792 sda1',
].join('\n');

const parts = parseProcPartitions(partsText);
eq(parts.length, 5, 'parsed 5 partition entries');
eq(parts[0], { major: 259, minor: 0, blocks: 500107608, sizeBytes: 500107608 * 1024, name: 'nvme0n1' }, 'nvme0n1 partition row');
eq(parts[1].sizeBytes, 536870912, 'nvme0n1p1 is 512 MiB');

// 3. parseProcDiskstats & computeDiskIoRates
const statsT0 = [
  ' 259       0 nvme0n1 1000 0 20000 500 500 0 10000 250 0 400 750 0 0 0 0',
  ' 259       2 nvme0n1p2 900 0 18000 450 450 0 9000 220 0 380 670 0 0 0 0',
].join('\n');
const statsT1 = [
  ' 259       0 nvme0n1 1200 0 40000 600 600 0 30000 350 2 500 950 0 0 0 0',
  ' 259       2 nvme0n1p2 1100 0 38000 550 550 0 29000 320 1 480 870 0 0 0 0',
].join('\n');

const parsed0 = parseProcDiskstats(statsT0);
const parsed1 = parseProcDiskstats(statsT1);
eq(parsed0.nvme0n1.readBytes, 20000 * 512, 'nvme0n1 initial readBytes');
eq(parsed0.nvme0n1.writeBytes, 10000 * 512, 'nvme0n1 initial writeBytes');
eq(parsed1.get('nvme0n1').ioInProgress, 2, 'nvme0n1 ioInProgress via .get()');

const rates = computeDiskIoRates(parsed0, parsed1, 2.0);
// delta sectors = 20000 -> 10,240,000 bytes over 2s -> 5,120,000 B/s
eq(rates.nvme0n1.readBps, 5120000, 'nvme0n1 readBps over 2s');
eq(rates.nvme0n1.writeBps, 5120000, 'nvme0n1 writeBps over 2s');
eq(rates.nvme0n1.readIops, 100, 'nvme0n1 readIops');
eq(rates.nvme0n1.writeIops, 50, 'nvme0n1 writeIops');

// 4. classifyDriveMedia & groupVolumesAndBlockDevices (Linux topology + unallocated space)
eq(classifyDriveMedia({ name: 'nvme0n1', removable: 0, rotational: 0 }), 'NVMe', 'nvme classified as NVMe');
eq(classifyDriveMedia({ name: 'sda', removable: 0, rotational: 0 }), 'SSD', 'non-rotational SATA classified as SSD');
eq(classifyDriveMedia({ name: 'sdb', removable: 0, rotational: 1 }), 'HDD', 'rotational SATA classified as HDD');
eq(classifyDriveMedia({ name: 'sdc', removable: 1, rotational: 0 }), 'Removable', 'removable classified as Removable');

const GB = 1024 * 1024 * 1024;
const linuxDrives = groupVolumesAndBlockDevices({
  sysBlockDevices: [
    {
      name: 'nvme0n1',
      sizeBytes: 500 * GB,
      removable: 0,
      ro: 0,
      rotational: 0,
      vendor: 'Samsung',
      model: 'SSD 980 PRO',
      partitions: [
        { name: 'nvme0n1p1', partition: 1, sizeBytes: 1 * GB, ro: 0 },
        { name: 'nvme0n1p2', partition: 2, sizeBytes: 400 * GB, ro: 0 },
      ],
    },
    {
      name: 'sda',
      sizeBytes: 2000 * GB,
      removable: 0,
      ro: 0,
      rotational: 1,
      vendor: 'WD',
      model: 'Blue 2TB',
      partitions: [
        { name: 'sda1', partition: 1, sizeBytes: 2000 * GB, ro: 0 },
      ],
    },
    {
      name: 'sdb',
      sizeBytes: 32 * GB,
      removable: 1,
      ro: 0,
      rotational: 0,
      vendor: 'SanDisk',
      model: 'Ultra Fit',
      partitions: [
        { name: 'sdb1', partition: 1, sizeBytes: 32 * GB, ro: 1 },
      ],
    },
  ],
  procMounts: mounts,
  procPartitions: parts,
  diskstats: parsed1,
  prevDiskstats: parsed0,
  dtSec: 2.0,
  volumes: [
    { mountPoint: '/boot/efi', fsType: 'vfat', totalBytes: 1 * GB, freeBytes: 0.9 * GB, availableBytes: 0.9 * GB },
    { mountPoint: '/', volumeLabel: 'HelmRoot', fsType: 'ext4', totalBytes: 400 * GB, freeBytes: 250 * GB, availableBytes: 240 * GB },
    { mountPoint: '/run/media/user/USB Stick', volumeLabel: 'USB Stick', fsType: 'exfat', totalBytes: 32 * GB, freeBytes: 16 * GB, availableBytes: 16 * GB, isRemovable: true, isReadOnly: true },
  ],
});

eq(linuxDrives.length, 3, '3 physical drives grouped');
eq(linuxDrives[0].mediaType, 'NVMe', 'first drive is NVMe');
eq(linuxDrives[0].title, 'Samsung SSD 980 PRO', 'vendor + model joined');
eq(linuxDrives[0].partitions.length, 2, '2 allocated partitions on nvme0n1');
eq(linuxDrives[0].unallocatedBytes, 99 * GB, '99 GB unallocated space computed');
eq(linuxDrives[0].segments.length, 3, '3 segments including unallocated gap');
eq(linuxDrives[0].segments[2].isUnallocated, true, 'last segment is unallocated');
eq(linuxDrives[0].readBps, 5120000, 'drive readBps attached');
eq(linuxDrives[1].mediaType, 'HDD', 'second drive is HDD');
eq(linuxDrives[1].partitions[0].isMounted, false, 'sda1 is unmounted');
eq(linuxDrives[2].mediaType, 'Removable', 'third drive is Removable');
eq(linuxDrives[2].icon, 'usb', 'removable drive uses usb icon');

// 5. Windows fallback mode when sysBlockDevices is empty
const winDrives = groupVolumesAndBlockDevices({
  sysBlockDevices: [],
  volumes: [
    { mountPoint: 'C:\\', volumeLabel: 'System', fsType: 'NTFS', totalBytes: 500 * GB, freeBytes: 200 * GB, availableBytes: 200 * GB, isRemovable: false, isReadOnly: false, isNetwork: false },
    { mountPoint: 'D:\\', volumeLabel: 'Backup', fsType: 'exFAT', totalBytes: 64 * GB, freeBytes: 48 * GB, availableBytes: 48 * GB, isRemovable: true, isReadOnly: false, isNetwork: false },
  ],
});

eq(winDrives.length, 2, '2 Windows volumes grouped as drives');
eq(winDrives[0].title, 'System (C:)', 'C: drive title');
eq(winDrives[0].mediaType, 'Local Drive', 'C: mediaType');
eq(winDrives[0].usedBytes, 300 * GB, 'C: usedBytes');
eq(winDrives[1].mediaType, 'Removable', 'D: removable mediaType');
eq(winDrives[1].icon, 'usb', 'D: usb icon');

console.log('test_model PASSED');
