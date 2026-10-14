/**
 * Data model and pure parsers for Disks & Volumes (`helm.disks`).
 *
 * Parses Linux `/proc/mounts`, `/proc/partitions`, `/proc/diskstats` and
 * `/sys/block/*` topology when available, correlating partitions with live
 * filesystem usage from `bro.vfs.volumes()`. When `/sys/block` is absent
 * (Windows or restricted containers), falls back cleanly to volume grouping.
 */

import { api, clamp } from '/lib/dom.js';

const fs = require('fs');
const path = require('path');

/** Unescape octal sequences like `\040` (space) in `/proc/mounts` paths. */
export function unescapeMountField(str) {
  if (!str) return '';
  return String(str).replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Parse `/proc/mounts` text (`device mountPoint fsType options dump pass`).
 * Returns array of `{ device, mountPoint, fsType, options, optionsText, isReadOnly }`.
 */
export function parseProcMounts(text) {
  if (!text) return [];
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const device = unescapeMountField(parts[0]);
    const mountPoint = unescapeMountField(parts[1]);
    const fsType = unescapeMountField(parts[2]);
    const optionsText = parts[3];
    const options = optionsText ? optionsText.split(',').filter(Boolean) : [];
    const isReadOnly = options.includes('ro') && !options.includes('rw');
    out.push({ device, mountPoint, fsType, options, optionsText, isReadOnly });
  }
  return out;
}

/**
 * Parse `/proc/partitions` text (`major minor #blocks name`).
 * Returns array of `{ major, minor, blocks, sizeBytes, name }`.
 */
export function parseProcPartitions(text) {
  if (!text) return [];
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    const blocks = Number(parts[2]);
    const name = parts[3];
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(blocks) || !name) continue;
    out.push({ major, minor, blocks, sizeBytes: blocks * 1024, name });
  }
  return out;
}

/**
 * Parse `/proc/diskstats` text into per-device counters.
 * Returns an object keyed by device name (`{ readOps, readBytes, writeOps, writeBytes, ioInProgress, ioTimeMs }`),
 * with a non-enumerable `.get(name)` helper for Map compatibility.
 */
export function parseProcDiskstats(text) {
  const out = {};
  Object.defineProperty(out, 'get', { value: (k) => out[k], enumerable: false });
  if (!text) return out;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const p = line.split(/\s+/);
    if (p.length < 14) continue;
    const major = Number(p[0]);
    const minor = Number(p[1]);
    const name = p[2];
    const readOps = Number(p[3]) || 0;
    const sectorsRead = Number(p[5]) || 0;
    const writeOps = Number(p[7]) || 0;
    const sectorsWritten = Number(p[9]) || 0;
    const ioInProgress = Number(p[11]) || 0;
    const ioTimeMs = Number(p[12]) || 0;
    if (!name || !Number.isFinite(major)) continue;
    out[name] = {
      name,
      major,
      minor,
      readOps,
      readBytes: sectorsRead * 512,
      writeOps,
      writeBytes: sectorsWritten * 512,
      ioInProgress,
      ioTimeMs,
    };
  }
  return out;
}

/**
 * Compute per-device I/O rates between two diskstats snapshots separated by `dtSec`.
 * Returns `{ [name]: { readBps, writeBps, readIops, writeIops } }`.
 */
export function computeDiskIoRates(prevStats, currStats, dtSec) {
  const out = {};
  Object.defineProperty(out, 'get', { value: (k) => out[k], enumerable: false });
  if (!currStats) return out;
  const validDt = Number.isFinite(dtSec) && dtSec > 0;
  for (const [name, curr] of Object.entries(currStats)) {
    const prev = prevStats ? prevStats[name] : null;
    if (!prev || !validDt) {
      out[name] = { readBps: 0, writeBps: 0, readIops: 0, writeIops: 0 };
      continue;
    }
    const dReadBytes = Math.max(0, (curr.readBytes || 0) - (prev.readBytes || 0));
    const dWriteBytes = Math.max(0, (curr.writeBytes || 0) - (prev.writeBytes || 0));
    const dReadOps = Math.max(0, (curr.readOps || 0) - (prev.readOps || 0));
    const dWriteOps = Math.max(0, (curr.writeOps || 0) - (prev.writeOps || 0));
    out[name] = {
      readBps: Math.round(dReadBytes / dtSec),
      writeBps: Math.round(dWriteBytes / dtSec),
      readIops: Math.round(dReadOps / dtSec),
      writeIops: Math.round(dWriteOps / dtSec),
    };
  }
  return out;
}

/** Classify drive media type from Linux `/sys/block` attributes. */
export function classifyDriveMedia(dev) {
  const name = String(dev.name || '');
  if (Number(dev.removable) === 1 || dev.removable === true) return 'Removable';
  if (name.startsWith('nvme')) return 'NVMe';
  if (dev.rotational !== undefined && dev.rotational !== null && dev.rotational !== '') {
    return Number(dev.rotational) === 0 || dev.rotational === false ? 'SSD' : 'HDD';
  }
  return 'Local Drive';
}

const MIN_UNALLOCATED_BYTES = 1024 * 1024; // 1 MB threshold for showing unallocated space

function normMount(m) {
  if (!m) return '';
  const s = String(m).replace(/\\/g, '/');
  return s === '/' ? '/' : s.replace(/\/+$/, '');
}

/**
 * Correlate block devices, mounts, partition tables, I/O counters, and `bro.vfs.volumes()`.
 * Handles both Linux `/sys/block` topology and Windows / fallback volume lists.
 */
export function groupVolumesAndBlockDevices({
  volumes = [],
  sysBlockDevices = [],
  procMounts = [],
  procPartitions = [],
  diskstats = {},
  prevDiskstats = null,
  dtSec = 0,
} = {}) {
  const rates = computeDiskIoRates(prevDiskstats, diskstats, dtSec);
  const partSizeByName = new Map();
  for (const p of procPartitions || []) partSizeByName.set(p.name, p.sizeBytes);

  const mountByDev = new Map();
  for (const m of procMounts || []) {
    if (m.device && m.device.startsWith('/dev/')) {
      const shortName = m.device.slice(5);
      // Prefer the shortest real mount point (e.g., '/' over bind mounts)
      if (!mountByDev.has(shortName) || m.mountPoint.length < mountByDev.get(shortName).mountPoint.length) {
        mountByDev.set(shortName, m);
      }
    }
  }

  const volByMount = new Map();
  const volByDev = new Map();
  for (const v of volumes || []) {
    if (v.mountPoint) volByMount.set(normMount(v.mountPoint), v);
    if (v.device && String(v.device).startsWith('/dev/')) volByDev.set(String(v.device).slice(5), v);
  }

  // Linux block topology mode when sysBlockDevices are present
  if (Array.isArray(sysBlockDevices) && sysBlockDevices.length > 0) {
    const drives = [];
    for (const dev of sysBlockDevices) {
      const name = String(dev.name || '');
      if (!name || /^(loop|ram|zram)\d+$/.test(name)) continue;
      const sizeBytes = dev.sizeBytes != null
        ? Number(dev.sizeBytes)
        : dev.sizeSectors != null
          ? Number(dev.sizeSectors) * 512
          : dev.size != null
            ? Number(dev.size) * 512
            : (partSizeByName.get(name) || 0);
      if (sizeBytes <= 0) continue;

      const mediaType = classifyDriveMedia(dev);
      const isRemovable = mediaType === 'Removable';
      const isReadOnly = Number(dev.ro) === 1 || dev.ro === true;
      const devicePath = `/dev/${name}`;
      const rawModel = [dev.vendor, dev.model].map((s) => (s || '').trim()).filter(Boolean).join(' ').trim();
      const title = rawModel || (mediaType === 'NVMe' ? 'NVMe Solid State Drive'
        : mediaType === 'Removable' ? 'Removable Drive' : 'Disk Drive');

      const rawParts = Array.isArray(dev.partitions) ? [...dev.partitions] : [];
      rawParts.sort((a, b) => (Number(a.partition) || Number(a.startSector) || 0) - (Number(b.partition) || Number(b.startSector) || 0) ||
        String(a.name).localeCompare(String(b.name)));

      const partitions = [];
      for (const rp of rawParts) {
        const pName = String(rp.name || '');
        if (!pName) continue;
        const pBytes = rp.sizeBytes != null
          ? Number(rp.sizeBytes)
          : rp.sizeSectors != null
            ? Number(rp.sizeSectors) * 512
            : rp.size != null
              ? Number(rp.size) * 512
              : (partSizeByName.get(pName) || 0);
        const mount = mountByDev.get(pName) || null;
        const mountPoint = mount ? mount.mountPoint : (volByDev.get(pName)?.mountPoint || '');
        const vol = (mountPoint ? volByMount.get(normMount(mountPoint)) : null) || volByDev.get(pName) || null;

        const fsType = (mount && mount.fsType) || (vol && vol.fsType) || rp.fsType || '';
        const totalBytes = pBytes || (vol && vol.totalBytes) || 0;
        const freeBytes = vol && vol.freeBytes != null ? vol.freeBytes : (vol && vol.availableBytes != null ? vol.availableBytes : null);
        const availableBytes = vol && vol.availableBytes != null ? vol.availableBytes : freeBytes;
        const usedBytes = vol && totalBytes > 0 && availableBytes != null
          ? Math.max(0, (vol.totalBytes || totalBytes) - availableBytes)
          : null;
        const usedPct = usedBytes != null && totalBytes > 0 ? clamp(usedBytes / totalBytes, 0, 1) : 0;

        const pStat = diskstats[pName] || { readBytes: 0, writeBytes: 0, readOps: 0, writeOps: 0 };
        const pRate = rates[pName] || { readBps: 0, writeBps: 0, readIops: 0, writeIops: 0 };
        const pLabel = (vol && vol.volumeLabel) || rp.label ||
          (mountPoint === '/' ? 'Root' : mountPoint === '/boot/efi' || mountPoint === '/efi' ? 'EFI'
            : mountPoint === '/home' ? 'Home' : pName);

        partitions.push({
          id: `/dev/${pName}`,
          name: pName,
          label: pLabel,
          volumeLabel: (vol && vol.volumeLabel) || rp.label || '',
          device: `/dev/${pName}`,
          mountPoint,
          fsType,
          options: mount ? mount.options : (vol ? [vol.isReadOnly ? 'ro' : 'rw'] : []),
          optionsText: mount ? mount.optionsText : (vol ? (vol.isReadOnly ? 'ro' : 'rw') : ''),
          sizeBytes: totalBytes,
          totalBytes,
          usedBytes,
          freeBytes,
          availableBytes,
          usedPct,
          isMounted: Boolean(mountPoint),
          isReadOnly: Boolean(rp.ro || (mount && mount.isReadOnly) || (vol && vol.isReadOnly) || isReadOnly),
          isRemovable,
          isUnallocated: false,
          readBytes: pStat.readBytes || 0,
          writeBytes: pStat.writeBytes || 0,
          readOps: pStat.readOps || 0,
          writeOps: pStat.writeOps || 0,
          readBps: pRate.readBps || 0,
          writeBps: pRate.writeBps || 0,
          readIops: pRate.readIops || 0,
          writeIops: pRate.writeIops || 0,
        });
      }

      // Whole-disk filesystem when no child partitions exist
      if (partitions.length === 0) {
        const mount = mountByDev.get(name) || null;
        const mountPoint = mount ? mount.mountPoint : (volByDev.get(name)?.mountPoint || '');
        const vol = (mountPoint ? volByMount.get(normMount(mountPoint)) : null) || volByDev.get(name) || null;
        if (mount || vol) {
          const freeBytes = vol && vol.freeBytes != null ? vol.freeBytes : (vol && vol.availableBytes != null ? vol.availableBytes : null);
          const availableBytes = vol && vol.availableBytes != null ? vol.availableBytes : freeBytes;
          const usedBytes = vol && availableBytes != null ? Math.max(0, (vol.totalBytes || sizeBytes) - availableBytes) : null;
          const dStat = diskstats[name] || { readBytes: 0, writeBytes: 0, readOps: 0, writeOps: 0 };
          const dRate = rates[name] || { readBps: 0, writeBps: 0, readIops: 0, writeIops: 0 };
          partitions.push({
            id: devicePath,
            name,
            label: (vol && vol.volumeLabel) || name,
            volumeLabel: (vol && vol.volumeLabel) || '',
            device: devicePath,
            mountPoint,
            fsType: (mount && mount.fsType) || (vol && vol.fsType) || '',
            options: mount ? mount.options : ['rw'],
            optionsText: mount ? mount.optionsText : 'rw',
            sizeBytes,
            totalBytes: sizeBytes,
            usedBytes,
            freeBytes,
            availableBytes,
            usedPct: usedBytes != null && sizeBytes > 0 ? clamp(usedBytes / sizeBytes, 0, 1) : 0,
            isMounted: Boolean(mountPoint),
            isReadOnly,
            isRemovable,
            isUnallocated: false,
            readBytes: dStat.readBytes || 0,
            writeBytes: dStat.writeBytes || 0,
            readOps: dStat.readOps || 0,
            writeOps: dStat.writeOps || 0,
            readBps: dRate.readBps || 0,
            writeBps: dRate.writeBps || 0,
            readIops: dRate.readIops || 0,
            writeIops: dRate.writeIops || 0,
          });
        }
      }

      const allocatedBytes = partitions.reduce((s, p) => s + p.sizeBytes, 0);
      const unallocatedBytes = Math.max(0, sizeBytes - allocatedBytes);
      const segments = [...partitions];
      if (unallocatedBytes >= MIN_UNALLOCATED_BYTES) {
        segments.push({
          id: `${devicePath}:unallocated`, name: 'Unallocated', label: 'Unallocated Space', volumeLabel: '',
          device: devicePath, mountPoint: '', fsType: 'unallocated', options: [], optionsText: '',
          sizeBytes: unallocatedBytes, totalBytes: unallocatedBytes, usedBytes: 0,
          freeBytes: unallocatedBytes, availableBytes: unallocatedBytes, usedPct: 0,
          isMounted: false, isReadOnly: false, isRemovable, isUnallocated: true,
          readBytes: 0, writeBytes: 0, readOps: 0, writeOps: 0, readBps: 0, writeBps: 0, readIops: 0, writeIops: 0,
        });
      }

      const dStat = diskstats[name] || null;
      const dRate = rates[name] || null;
      const readBytes = dStat ? dStat.readBytes : partitions.reduce((s, p) => s + p.readBytes, 0);
      const writeBytes = dStat ? dStat.writeBytes : partitions.reduce((s, p) => s + p.writeBytes, 0);
      const readBps = dRate ? dRate.readBps : partitions.reduce((s, p) => s + p.readBps, 0);
      const writeBps = dRate ? dRate.writeBps : partitions.reduce((s, p) => s + p.writeBps, 0);

      const mountedParts = partitions.filter((p) => p.usedBytes != null);
      const usedBytes = mountedParts.length ? mountedParts.reduce((s, p) => s + p.usedBytes, 0) : allocatedBytes;
      const availableBytes = mountedParts.length ? mountedParts.reduce((s, p) => s + (p.availableBytes || 0), 0) : unallocatedBytes;
      const freeBytes = mountedParts.length ? mountedParts.reduce((s, p) => s + (p.freeBytes || 0), 0) : unallocatedBytes;

      drives.push({
        id: devicePath, name, title, model: (dev.model || '').trim() || title, vendor: (dev.vendor || '').trim(),
        device: devicePath, mediaType, icon: isRemovable ? 'usb' : 'hard-drive',
        isRemovable, isReadOnly, isNetwork: false,
        sizeBytes, allocatedBytes, unallocatedBytes, usedBytes, freeBytes, availableBytes,
        usedPct: sizeBytes > 0 ? clamp(usedBytes / sizeBytes, 0, 1) : 0,
        readBytes, writeBytes, readBps, writeBps, partitions, segments,
      });
    }
    return drives;
  }

  // Fallback / Windows mode: build drive + volume entries from `volumes`
  const drives = [];
  for (const v of volumes || []) {
    if (!v || !v.mountPoint || !(v.totalBytes > 0)) continue;
    if (/^\/(proc|sys|dev|run|snap)(\/|$)/.test(v.mountPoint)) continue;
    const clean = String(v.mountPoint).replace(/[\\/]+$/, '') || v.mountPoint;
    const label = v.volumeLabel ? `${v.volumeLabel} (${clean})` : clean;
    const totalBytes = Number(v.totalBytes) || 0;
    const freeBytes = v.freeBytes != null ? Number(v.freeBytes) : Number(v.availableBytes) || 0;
    const availableBytes = v.availableBytes != null ? Number(v.availableBytes) : freeBytes;
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    const usedPct = totalBytes > 0 ? clamp(usedBytes / totalBytes, 0, 1) : 0;
    const isRemovable = Boolean(v.isRemovable);
    const isNetwork = Boolean(v.isNetwork);
    const isReadOnly = Boolean(v.isReadOnly);
    const mediaType = isNetwork ? 'Network' : isRemovable ? 'Removable' : 'Local Drive';
    const iconName = isRemovable ? 'usb' : isNetwork ? 'globe' : 'hard-drive';

    const part = {
      id: v.mountPoint,
      name: clean,
      label: v.volumeLabel || clean,
      volumeLabel: v.volumeLabel || '',
      device: v.device || v.mountPoint,
      mountPoint: v.mountPoint,
      fsType: v.fsType || '',
      options: [isReadOnly ? 'ro' : 'rw'],
      optionsText: isReadOnly ? 'ro' : 'rw',
      sizeBytes: totalBytes,
      totalBytes,
      usedBytes,
      freeBytes,
      availableBytes,
      usedPct,
      isMounted: true,
      isReadOnly,
      isRemovable,
      isNetwork,
      isUnallocated: false,
      readBytes: 0,
      writeBytes: 0,
      readOps: 0,
      writeOps: 0,
      readBps: 0,
      writeBps: 0,
      readIops: 0,
      writeIops: 0,
    };

    drives.push({
      id: v.mountPoint,
      name: clean,
      title: label,
      model: v.volumeLabel || (isNetwork ? 'Network Share' : isRemovable ? 'Removable Media' : 'Local Volume'),
      vendor: '',
      device: v.device || v.mountPoint,
      mediaType,
      icon: iconName,
      isRemovable,
      isReadOnly,
      isNetwork,
      sizeBytes: totalBytes,
      allocatedBytes: totalBytes,
      unallocatedBytes: 0,
      usedBytes,
      freeBytes,
      availableBytes,
      usedPct,
      readBytes: 0,
      writeBytes: 0,
      readBps: 0,
      writeBps: 0,
      partitions: [part],
      segments: [part],
    });
  }
  return drives;
}

async function readTextOrEmpty(p) {
  try {
    return (await fs.promises.readFile(p, 'utf8')).trim();
  } catch (_) {
    return '';
  }
}

async function readSysBlockOne(sysBlock, devName) {
  if (/^(loop|ram|zram)\d+$/.test(devName)) return null;
  const devDir = path.join(sysBlock, devName);
  const [sizeTxt, remTxt, roTxt, rotTxt, modelTxt, vendorTxt, children] = await Promise.all([
    readTextOrEmpty(path.join(devDir, 'size')),
    readTextOrEmpty(path.join(devDir, 'removable')),
    readTextOrEmpty(path.join(devDir, 'ro')),
    readTextOrEmpty(path.join(devDir, 'queue', 'rotational')),
    readTextOrEmpty(path.join(devDir, 'device', 'model')),
    readTextOrEmpty(path.join(devDir, 'device', 'vendor')),
    fs.promises.readdir(devDir).catch(() => []),
  ]);
  const sizeSectors = Number(sizeTxt) || 0;
  if (sizeSectors <= 0) return null;

  const partCandidates = children.filter((c) => c.startsWith(devName) && c !== devName).sort();
  const parts = (await Promise.all(partCandidates.map(async (partName) => {
    const partDir = path.join(devDir, partName);
    const [pSizeTxt, pStartTxt, pNumTxt, pRoTxt] = await Promise.all([
      readTextOrEmpty(path.join(partDir, 'size')),
      readTextOrEmpty(path.join(partDir, 'start')),
      readTextOrEmpty(path.join(partDir, 'partition')),
      readTextOrEmpty(path.join(partDir, 'ro')),
    ]);
    const pSectors = Number(pSizeTxt) || 0;
    if (pSectors <= 0 && !pNumTxt) return null;
    return {
      name: partName,
      partition: Number(pNumTxt) || 0,
      startSector: Number(pStartTxt) || 0,
      sizeSectors: pSectors,
      sizeBytes: pSectors * 512,
      ro: Number(pRoTxt) === 1,
    };
  }))).filter(Boolean);

  return {
    name: devName,
    sizeSectors,
    sizeBytes: sizeSectors * 512,
    removable: Number(remTxt) === 1,
    ro: Number(roTxt) === 1,
    rotational: rotTxt === '' ? null : Number(rotTxt),
    model: modelTxt,
    vendor: vendorTxt,
    partitions: parts,
  };
}

async function readSysBlockDir(root, isCancelled) {
  const sysBlock = path.join(root, 'sys', 'block');
  let entries = [];
  try {
    entries = await fs.promises.readdir(sysBlock);
  } catch (_) {
    return [];
  }
  entries.sort();
  const devices = [];
  const BATCH = 4;
  for (let i = 0; i < entries.length; i += BATCH) {
    if (isCancelled && isCancelled()) return [];
    if (i > 0 && typeof requestAnimationFrame === 'function') {
      await new Promise((r) => requestAnimationFrame(r));
      if (isCancelled && isCancelled()) return [];
    }
    const slice = entries.slice(i, i + BATCH);
    const batchDevs = await Promise.all(slice.map((devName) => readSysBlockOne(sysBlock, devName)));
    for (const d of batchDevs) if (d) devices.push(d);
  }
  return devices;
}

/**
 * Stateful model managing block device discovery, volume usage, and I/O rate sampling.
 */
export class DisksModel {
  constructor() {
    this.root = '/';
    this.mockVolumes = null;
    this.drives = [];
    this.volumes = [];
    this.prevDiskstats = null;
    this.lastSampleMs = 0;
    this._seq = 0;
  }

  setRoot(rootDir) {
    this.root = rootDir || '/';
    this.prevDiskstats = null;
    this.lastSampleMs = 0;
    this._seq++;
  }

  setMockVolumes(volumesArrayOrNull) {
    this.mockVolumes = Array.isArray(volumesArrayOrNull) ? volumesArrayOrNull : null;
    this._seq++;
  }

  async refresh(nowMs = Date.now()) {
    const seq = ++this._seq;
    const isCancelled = () => seq !== this._seq;
    const root = this.root;
    const mockVols = this.mockVolumes;
    const vfs = api('vfs');
    const volumesPromise = mockVols !== null
      ? Promise.resolve(mockVols)
      : (vfs && typeof vfs.volumes === 'function' ? vfs.volumes().catch(() => []) : Promise.resolve([]));

    const [volumes, sysBlockDevices, mountsTxt, partsTxt, statsTxt] = await Promise.all([
      volumesPromise,
      readSysBlockDir(root, isCancelled),
      readTextOrEmpty(path.join(root, 'proc', 'mounts')),
      readTextOrEmpty(path.join(root, 'proc', 'partitions')),
      readTextOrEmpty(path.join(root, 'proc', 'diskstats')),
    ]);

    if (isCancelled()) return this.drives;

    const procMounts = parseProcMounts(mountsTxt);
    const procPartitions = parseProcPartitions(partsTxt);
    const diskstats = parseProcDiskstats(statsTxt);
    const dtSec = this.lastSampleMs > 0 && nowMs > this.lastSampleMs ? (nowMs - this.lastSampleMs) / 1000 : 0;

    this.volumes = volumes || [];
    this.drives = groupVolumesAndBlockDevices({
      volumes: this.volumes,
      sysBlockDevices,
      procMounts,
      procPartitions,
      diskstats,
      prevDiskstats: this.prevDiskstats,
      dtSec,
    });
    this.prevDiskstats = diskstats;
    this.lastSampleMs = nowMs;
    return this.drives;
  }
}
