// End-to-end UI tests for Disks (`helm.disks`):
// - Linux /sys/block + /proc fixture with NVMe (EFI + Root + Home + unallocated) & Removable USB
// - Sidebar drive items with capacity meters
// - Visual partition layout map rendering and segment selection via mouse click & keyboard arrows
// - Filtering drives & partitions
// - Action handoff: Open in Files (helm.files), Analyze in Disk Usage (helm.diskusage), Copy Mount Path
// - Windows fallback mode when /sys/block is absent

import { app, waitFor, eq, press, clickEl, fixtureDir } from '/lib/test.js';

const GB_SECTORS = (1024 * 1024 * 1024) / 512; // 2,097,152 sectors per GiB
const GB_BYTES = 1024 * 1024 * 1024;

const root = fixtureDir({
  // NVMe drive: 500 GiB total, with 1 GiB EFI + 150 GiB Root + 300 GiB Home (49 GiB unallocated)
  'sys/block/nvme0n1/size': String(500 * GB_SECTORS),
  'sys/block/nvme0n1/removable': '0',
  'sys/block/nvme0n1/ro': '0',
  'sys/block/nvme0n1/queue/rotational': '0',
  'sys/block/nvme0n1/device/vendor': 'Samsung',
  'sys/block/nvme0n1/device/model': 'SSD 990 PRO 1TB',
  'sys/block/nvme0n1/nvme0n1p1/partition': '1',
  'sys/block/nvme0n1/nvme0n1p1/start': '2048',
  'sys/block/nvme0n1/nvme0n1p1/size': String(1 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p1/ro': '0',
  'sys/block/nvme0n1/nvme0n1p2/partition': '2',
  'sys/block/nvme0n1/nvme0n1p2/start': String(2048 + 1 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p2/size': String(150 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p2/ro': '0',
  'sys/block/nvme0n1/nvme0n1p3/partition': '3',
  'sys/block/nvme0n1/nvme0n1p3/start': String(2048 + 151 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p3/size': String(300 * GB_SECTORS),
  'sys/block/nvme0n1/nvme0n1p3/ro': '0',

  // Removable USB drive: 64 GiB total, single partition sda1
  'sys/block/sda/size': String(64 * GB_SECTORS),
  'sys/block/sda/removable': '1',
  'sys/block/sda/ro': '0',
  'sys/block/sda/queue/rotational': '0',
  'sys/block/sda/device/vendor': 'Kingston',
  'sys/block/sda/device/model': 'DataTraveler',
  'sys/block/sda/sda1/partition': '1',
  'sys/block/sda/sda1/start': '2048',
  'sys/block/sda/sda1/size': String(64 * GB_SECTORS),
  'sys/block/sda/sda1/ro': '0',

  'proc/mounts': [
    '/dev/nvme0n1p1 /boot/efi vfat rw,relatime 0 0',
    '/dev/nvme0n1p2 / ext4 rw,relatime,errors=remount-ro 0 0',
    '/dev/nvme0n1p3 /home btrfs rw,relatime,compress=zstd 0 0',
    '/dev/sda1 /media/USB\\040Drive exfat rw,nosuid,nodev 0 0',
  ].join('\n'),

  'proc/partitions': [
    'major minor  #blocks  name',
    ' 259        0  524288000 nvme0n1',
    ' 259        1    1048576 nvme0n1p1',
    ' 259        2  157286400 nvme0n1p2',
    ' 259        3  314572800 nvme0n1p3',
    '   8        0   67108864 sda',
    '   8        1   67108864 sda1',
  ].join('\n'),

  'proc/diskstats': [
    ' 259       0 nvme0n1 5000 0 102400 400 2000 0 51200 200 0 300 600 0 0 0 0',
    ' 259       1 nvme0n1p1 100 0 2048 10 20 0 512 5 0 10 15 0 0 0 0',
    ' 259       2 nvme0n1p2 3000 0 61440 250 1200 0 30720 120 0 200 370 0 0 0 0',
    ' 259       3 nvme0n1p3 1900 0 38912 140 780 0 19968 75 0 90 215 0 0 0 0',
    '   8       0 sda 400 0 8192 80 100 0 2048 30 0 50 110 0 0 0 0',
    '   8       1 sda1 400 0 8192 80 100 0 2048 30 0 50 110 0 0 0 0',
  ].join('\n'),
});

app.model.setRoot(root);
app.model.setMockVolumes([
  { mountPoint: '/boot/efi', volumeLabel: 'EFI', fsType: 'vfat', totalBytes: 1 * GB_BYTES, freeBytes: 0.8 * GB_BYTES, availableBytes: 0.8 * GB_BYTES },
  { mountPoint: '/', volumeLabel: 'HelmOS', fsType: 'ext4', totalBytes: 150 * GB_BYTES, freeBytes: 90 * GB_BYTES, availableBytes: 90 * GB_BYTES },
  { mountPoint: '/home', volumeLabel: 'Home', fsType: 'btrfs', totalBytes: 300 * GB_BYTES, freeBytes: 120 * GB_BYTES, availableBytes: 120 * GB_BYTES },
  { mountPoint: '/media/USB Drive', volumeLabel: 'USB Drive', fsType: 'exfat', totalBytes: 64 * GB_BYTES, freeBytes: 48 * GB_BYTES, availableBytes: 48 * GB_BYTES, isRemovable: true },
]);
app.refresh(1000);

waitFor(() => app.state.drives.length === 2 && !app.state.loading, 'fixture drives to load');

// 1. Sidebar lists both physical drives with storage meters
const sidebarItems = () => Array.from(document.querySelectorAll('.sidebar-item'));
eq(sidebarItems().length, 2, '2 drives in sidebar');
assert(sidebarItems()[0].querySelector('.meter'), 'sidebar item has storage meter');
assert(sidebarItems()[0].textContent.includes('Samsung SSD 990 PRO 1TB'), 'first drive title in sidebar');
assert(sidebarItems()[1].textContent.includes('Kingston DataTraveler'), 'second drive title in sidebar');

// 2. Drive header card & visual partition layout map
eq(document.querySelector('.disks-drive-title').textContent, 'Samsung SSD 990 PRO 1TB', 'drive header title');
eq(document.querySelector('.disks-media-badge').textContent, 'NVMe', 'NVMe media badge');

const segs = () => Array.from(document.querySelectorAll('.disks-map-seg'));
eq(segs().length, 4, '4 visual map segments (EFI, Root, Home, Unallocated)');
assert(segs()[0].classList.contains('selected'), 'first segment (EFI) is selected initially');
eq(document.querySelector('.disks-prop-device').textContent, '/dev/nvme0n1p1', 'details card shows nvme0n1p1');

// 3. Clicking a segment in the visual partition layout map selects that partition
clickEl(segs()[1]);
waitFor(() => app.state.selectedPartitionId === '/dev/nvme0n1p2', 'clicking Root segment selects nvme0n1p2');
assert(segs()[1].classList.contains('selected'), 'second segment has .selected class');
eq(document.querySelector('.disks-prop-device').textContent, '/dev/nvme0n1p2', 'details card updated to nvme0n1p2');
eq(document.querySelector('.disks-mount-link').textContent, '/', 'mount point button shows /');
assert(document.querySelector('.disks-prop-fs').textContent.includes('ext4'), 'filesystem shows ext4');

// 4. Keyboard navigation across partitions (ArrowRight / ArrowLeft)
press('right');
eq(app.state.selectedPartitionId, '/dev/nvme0n1p3', 'ArrowRight selects nvme0n1p3 (/home)');
eq(document.querySelector('.disks-mount-link').textContent, '/home', 'mount link updated to /home');

press('left');
eq(app.state.selectedPartitionId, '/dev/nvme0n1p2', 'ArrowLeft returns to nvme0n1p2 (/)');

// 5. Action buttons & app handoffs
openedApps({ clear: true });
clickEl(document.querySelector('.disks-btn-open'));
waitFor(() => openedApps().some((a) => a.id === 'helm.files'), 'Open in Files launches helm.files');
eq(openedApps().find((a) => a.id === 'helm.files').args, ['/'], 'helm.files passed mount point /');

openedApps({ clear: true });
clickEl(document.querySelector('.disks-btn-analyze'));
waitFor(() => openedApps().some((a) => a.id === 'helm.diskusage'), 'Analyze in Disk Usage launches helm.diskusage');
eq(openedApps().find((a) => a.id === 'helm.diskusage').args, ['/'], 'helm.diskusage passed mount point /');

clickEl(document.querySelector('.disks-btn-copy'));
waitFor(() => document.querySelector('.toast'), 'Copy Mount Path shows toast');

// 6. Filtering drives & volumes
app.setFilter('Kingston');
eq(app.state.filteredDrives.length, 1, 'filter narrows to Kingston USB drive');
eq(app.state.selectedDriveId, '/dev/sda', 'Kingston USB drive selected');
eq(document.querySelector('.disks-media-badge').textContent, 'Removable', 'Removable badge shown');
eq(document.querySelector('.disks-mount-link').textContent, '/media/USB Drive', 'unescaped USB mount point shown');

press('escape');
eq(app.state.filter, '', 'Escape clears filter');
eq(app.state.filteredDrives.length, 2, 'all drives restored after clearing filter');

// 7. Windows / fallback volume mode when /sys/block is absent
const emptyRoot = fixtureDir({});
app.model.setRoot(emptyRoot);
app.model.setMockVolumes([
  { mountPoint: 'C:\\', volumeLabel: 'Windows', fsType: 'NTFS', totalBytes: 256 * GB_BYTES, freeBytes: 128 * GB_BYTES, availableBytes: 128 * GB_BYTES },
]);
app.refresh(2000);
waitFor(() => app.state.drives.length === 1 && app.state.drives[0].id === 'C:\\', 'Windows fallback volume loaded');
eq(document.querySelector('.disks-media-badge').textContent, 'Local Drive', 'Windows fallback shows Local Drive badge');
eq(document.querySelector('.disks-prop-device').textContent, 'C:\\', 'Windows fallback device is C:\\');

console.log('test_ui PASSED');
