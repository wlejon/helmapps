/**
 * System metrics parser and async sampler (/proc/stat, /proc/meminfo,
 * /proc/diskstats, /proc/net/dev, /proc/loadavg, /proc/uptime, /proc/cpuinfo,
 * and amdgpu sysfs files, with os.* / bro.gpu fallback when /proc is absent).
 *
 * Pure parser functions are exported for direct unit testing in test_parsers.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

export const RING_SIZE = 120;

const WHOLE_DISK_RE = /^(sd[a-z]+|vd[a-z]+|hd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;

/**
 * Parse /proc/stat CPU lines (total `cpu` and per-core `cpu0`, `cpu1`, ...).
 * Fields after label: user nice system idle iowait irq softirq steal [guest guest_nice]
 */
export function parseProcStat(text) {
  const lines = String(text || '').split('\n');
  let total = null;
  const cores = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('cpu')) continue;
    const parts = line.split(/\s+/);
    const label = parts[0];
    if (label !== 'cpu' && !/^cpu\d+$/.test(label)) continue;
    const nums = parts.slice(1, 9).map((v) => parseInt(v, 10) || 0);
    while (nums.length < 8) nums.push(0);
    const [user, nice, system, idle, iowait, irq, softirq, steal] = nums;
    const idleAll = idle + iowait;
    const active = user + nice + system + irq + softirq + steal;
    const sum = active + idleAll;
    const entry = {
      id: label,
      user,
      nice,
      system,
      idle: idleAll,
      rawIdle: idle,
      iowait,
      irq,
      softirq,
      steal,
      active,
      total: sum,
    };
    if (label === 'cpu') total = entry;
    else cores.push(entry);
  }
  if (!total && cores.length > 0) {
    const agg = { id: 'cpu', user: 0, nice: 0, system: 0, idle: 0, rawIdle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0, active: 0, total: 0 };
    for (const c of cores) {
      agg.user += c.user; agg.nice += c.nice; agg.system += c.system;
      agg.idle += c.idle; agg.rawIdle += c.rawIdle; agg.iowait += c.iowait;
      agg.irq += c.irq; agg.softirq += c.softirq; agg.steal += c.steal;
      agg.active += c.active; agg.total += c.total;
    }
    total = agg;
  }
  return { total, cores };
}

/**
 * Compute total and per-core CPU percentages (0..100) and totalJiffiesDelta
 * from two parseProcStat snapshots.
 */
export function computeCpuDelta(prev, curr) {
  if (!curr || !curr.total) {
    return { totalPct: 0, corePcts: [], totalJiffiesDelta: 0 };
  }
  if (!prev || !prev.total) {
    return {
      totalPct: 0,
      corePcts: (curr.cores || []).map(() => 0),
      totalJiffiesDelta: 0,
    };
  }
  const dActive = Math.max(0, curr.total.active - prev.total.active);
  const dTotal = Math.max(0, curr.total.total - prev.total.total);
  const totalPct = dTotal > 0 ? Math.min(100, Math.max(0, (dActive / dTotal) * 100)) : 0;

  const corePcts = (curr.cores || []).map((c, idx) => {
    const p = (prev.cores && (prev.cores[idx]?.id === c.id ? prev.cores[idx] : prev.cores.find((x) => x.id === c.id))) || null;
    if (!p) return 0;
    const ca = Math.max(0, c.active - p.active);
    const ct = Math.max(0, c.total - p.total);
    return ct > 0 ? Math.min(100, Math.max(0, (ca / ct) * 100)) : 0;
  });

  return { totalPct, corePcts, totalJiffiesDelta: dTotal };
}

/**
 * Parse /proc/meminfo into byte counts and percentages.
 * Memory used = MemTotal - MemAvailable.
 */
export function parseMeminfo(text) {
  const map = {};
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const m = /^([A-Za-z0-9_()]+):\s*(\d+)/.exec(raw.trim());
    if (m) map[m[1]] = parseInt(m[2], 10) * 1024;
  }
  const totalBytes = map.MemTotal || 0;
  const freeBytes = map.MemFree || 0;
  const buffersBytes = map.Buffers || 0;
  const cachedBytes = map.Cached || 0;
  const availableBytes = 'MemAvailable' in map
    ? map.MemAvailable
    : Math.min(totalBytes, freeBytes + buffersBytes + cachedBytes);
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const usedPct = totalBytes > 0 ? Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100)) : 0;

  const swapTotalBytes = map.SwapTotal || 0;
  const swapFreeBytes = map.SwapFree || 0;
  const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
  const swapPct = swapTotalBytes > 0 ? Math.min(100, Math.max(0, (swapUsedBytes / swapTotalBytes) * 100)) : 0;

  return {
    totalBytes,
    freeBytes,
    availableBytes,
    usedBytes,
    usedPct,
    buffersBytes,
    cachedBytes,
    swapTotalBytes,
    swapFreeBytes,
    swapUsedBytes,
    swapPct,
  };
}

/**
 * Parse /proc/diskstats, summing sectors read/written (* 512) for whole disk devices.
 */
export function parseDiskstats(text) {
  let readBytes = 0;
  let writeBytes = 0;
  const devices = {};
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 10) continue;
    const name = parts[2];
    if (!WHOLE_DISK_RE.test(name)) continue;
    const sectorsRead = parseInt(parts[5], 10) || 0;
    const sectorsWritten = parseInt(parts[9], 10) || 0;
    const rb = sectorsRead * 512;
    const wb = sectorsWritten * 512;
    devices[name] = { readBytes: rb, writeBytes: wb };
    readBytes += rb;
    writeBytes += wb;
  }
  return { readBytes, writeBytes, devices };
}

/**
 * Parse /proc/net/dev, summing rxBytes and txBytes across non-loopback interfaces.
 */
export function parseNetDev(text) {
  let rxBytes = 0;
  let txBytes = 0;
  const interfaces = {};
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const idx = raw.indexOf(':');
    if (idx < 0) continue;
    const iface = raw.slice(0, idx).trim();
    if (!iface || iface === 'lo') continue;
    const fields = raw.slice(idx + 1).trim().split(/\s+/);
    if (fields.length < 9) continue;
    const rx = parseInt(fields[0], 10) || 0;
    const tx = parseInt(fields[8], 10) || 0;
    interfaces[iface] = { rxBytes: rx, txBytes: tx };
    rxBytes += rx;
    txBytes += tx;
  }
  return { rxBytes, txBytes, interfaces };
}

/**
 * Parse /proc/loadavg (`0.42 0.35 0.28 2/512 9999`).
 */
export function parseLoadavg(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const load1 = parseFloat(parts[0]) || 0;
  const load5 = parseFloat(parts[1]) || 0;
  const load15 = parseFloat(parts[2]) || 0;
  let runningThreads = 0;
  let totalThreads = 0;
  if (parts[3] && parts[3].includes('/')) {
    const [r, t] = parts[3].split('/');
    runningThreads = parseInt(r, 10) || 0;
    totalThreads = parseInt(t, 10) || 0;
  }
  return { load1, load5, load15, runningThreads, totalThreads };
}

/**
 * Parse /proc/uptime (`12345.67 98765.43`).
 */
export function parseUptime(text) {
  const parts = String(text || '').trim().split(/\s+/);
  return parseFloat(parts[0]) || 0;
}

/**
 * Parse CPU model name from /proc/cpuinfo.
 */
export function parseCpuinfoModel(text) {
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const m = /^(?:model name|Model|Processor|Hardware)\s*:\s*(.+)$/i.exec(line.trim());
    if (m && m[1] && !/^\d+$/.test(m[1].trim())) return m[1].trim();
  }
  return '';
}

async function readTextOrNull(filePath) {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (_) {
    return null;
  }
}

function pushRing(arr, val, max = RING_SIZE) {
  arr.push(val);
  while (arr.length > max) arr.shift();
}

export class SysSampler {
  constructor(root = '/') {
    this.root = root;
    this.gen = 0;
    this.reset();
  }

  setRoot(root) {
    this.gen++;
    this.root = root || '/';
    this.reset();
  }

  reset() {
    this.hasProc = false;
    this.prevStat = null;
    this.prevDisk = null;
    this.prevNet = null;
    this.prevSampleMs = 0;
    this.lastJiffiesDelta = 0;
    this.cpuModel = '';
    this.uptimeSec = 0;
    this.loadavg = { load1: 0, load5: 0, load15: 0, runningThreads: 0, totalThreads: 0 };
    this.cpu = { totalPct: 0, corePcts: [] };
    this.mem = {
      totalBytes: 0, freeBytes: 0, availableBytes: 0, usedBytes: 0, usedPct: 0,
      buffersBytes: 0, cachedBytes: 0, swapTotalBytes: 0, swapFreeBytes: 0, swapUsedBytes: 0, swapPct: 0,
    };
    this.disk = { readBps: 0, writeBps: 0, readBytes: 0, writeBytes: 0 };
    this.net = { rxBps: 0, txBps: 0, rxBytes: 0, txBytes: 0 };
    this.gpu = { available: false, name: '', busyPct: null, vramUsedBytes: 0, vramTotalBytes: 0, vramPct: 0 };
    this.history = {
      cpuTotal: [],
      cpuCores: [],
      memPct: [],
      swapPct: [],
      diskReadBps: [],
      diskWriteBps: [],
      netRxBps: [],
      netTxBps: [],
      gpuBusyPct: [],
      gpuVramPct: [],
    };
  }

  async sample(nowMs = Date.now()) {
    const myGen = this.gen;
    const procDir = path.join(this.root, 'proc');
    const statText = await readTextOrNull(path.join(procDir, 'stat'));
    if (this.gen !== myGen) return this;

    const dtSec = this.prevSampleMs > 0 ? Math.max(0.05, (nowMs - this.prevSampleMs) / 1000) : 1;
    this.prevSampleMs = nowMs;

    if (statText != null) {
      this.hasProc = true;
      await this._sampleProc(procDir, statText, dtSec, myGen);
    } else {
      this.hasProc = false;
      this._sampleOsFallback();
    }
    if (this.gen !== myGen) return this;

    await this._sampleGpu(myGen);
    if (this.gen !== myGen) return this;
    this._recordHistory();
    return this;
  }

  async _sampleProc(procDir, statText, dtSec, myGen) {
    const currStat = parseProcStat(statText);
    const delta = computeCpuDelta(this.prevStat, currStat);
    const [memText, diskText, netText, loadText, upText, cpuinfoText] = await Promise.all([
      readTextOrNull(path.join(procDir, 'meminfo')),
      readTextOrNull(path.join(procDir, 'diskstats')),
      readTextOrNull(path.join(procDir, 'net', 'dev')),
      readTextOrNull(path.join(procDir, 'loadavg')),
      readTextOrNull(path.join(procDir, 'uptime')),
      this.cpuModel ? Promise.resolve(null) : readTextOrNull(path.join(procDir, 'cpuinfo')),
    ]);
    if (this.gen !== myGen) return;

    this.prevStat = currStat;
    this.cpu = { totalPct: delta.totalPct, corePcts: delta.corePcts };
    this.lastJiffiesDelta = delta.totalJiffiesDelta;

    if (memText != null) this.mem = parseMeminfo(memText);

    if (diskText != null) {
      const currDisk = parseDiskstats(diskText);
      if (this.prevDisk) {
        const dRead = Math.max(0, currDisk.readBytes - this.prevDisk.readBytes);
        const dWrite = Math.max(0, currDisk.writeBytes - this.prevDisk.writeBytes);
        this.disk = {
          readBps: dRead / dtSec,
          writeBps: dWrite / dtSec,
          readBytes: currDisk.readBytes,
          writeBytes: currDisk.writeBytes,
        };
      } else {
        this.disk = { readBps: 0, writeBps: 0, readBytes: currDisk.readBytes, writeBytes: currDisk.writeBytes };
      }
      this.prevDisk = currDisk;
    }

    if (netText != null) {
      const currNet = parseNetDev(netText);
      if (this.prevNet) {
        const dRx = Math.max(0, currNet.rxBytes - this.prevNet.rxBytes);
        const dTx = Math.max(0, currNet.txBytes - this.prevNet.txBytes);
        this.net = {
          rxBps: dRx / dtSec,
          txBps: dTx / dtSec,
          rxBytes: currNet.rxBytes,
          txBytes: currNet.txBytes,
        };
      } else {
        this.net = { rxBps: 0, txBps: 0, rxBytes: currNet.rxBytes, txBytes: currNet.txBytes };
      }
      this.prevNet = currNet;
    }

    if (loadText != null) this.loadavg = parseLoadavg(loadText);
    if (upText != null) this.uptimeSec = parseUptime(upText);
    if (cpuinfoText != null) {
      this.cpuModel = parseCpuinfoModel(cpuinfoText) || this.cpuModel;
    }
    if (!this.cpuModel && typeof os.cpus === 'function') {
      const cpus = os.cpus();
      if (cpus && cpus[0] && cpus[0].model) this.cpuModel = cpus[0].model.trim();
    }
  }

  _sampleOsFallback() {
    if (typeof os.cpus === 'function') {
      const cpus = os.cpus() || [];
      if (!this.cpuModel && cpus[0] && cpus[0].model) this.cpuModel = cpus[0].model.trim();
      const cores = cpus.map((c, i) => {
        const t = c.times || {};
        const active = (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.irq || 0);
        const idle = t.idle || 0;
        return { id: `cpu${i}`, active, idle, total: active + idle };
      });
      const total = cores.reduce((acc, c) => ({
        id: 'cpu',
        active: acc.active + c.active,
        idle: acc.idle + c.idle,
        total: acc.total + c.total,
      }), { id: 'cpu', active: 0, idle: 0, total: 0 });
      const currStat = { total, cores };
      const delta = computeCpuDelta(this.prevStat, currStat);
      this.prevStat = currStat;
      this.cpu = { totalPct: delta.totalPct, corePcts: delta.corePcts };
      this.lastJiffiesDelta = delta.totalJiffiesDelta;
    }

    if (typeof os.totalmem === 'function' && typeof os.freemem === 'function') {
      const totalBytes = os.totalmem() || 0;
      const availableBytes = os.freemem() || 0;
      const usedBytes = Math.max(0, totalBytes - availableBytes);
      const usedPct = totalBytes > 0 ? Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100)) : 0;
      this.mem = {
        totalBytes,
        freeBytes: availableBytes,
        availableBytes,
        usedBytes,
        usedPct,
        buffersBytes: 0,
        cachedBytes: 0,
        swapTotalBytes: 0,
        swapFreeBytes: 0,
        swapUsedBytes: 0,
        swapPct: 0,
      };
    }

    if (typeof os.uptime === 'function') {
      this.uptimeSec = os.uptime() || 0;
    }
    if (typeof os.loadavg === 'function') {
      const [l1 = 0, l5 = 0, l15 = 0] = os.loadavg() || [];
      this.loadavg = { load1: l1, load5: l5, load15: l15, runningThreads: 0, totalThreads: 0 };
    }
  }

  async _sampleGpu(myGen) {
    // Check sysfs amdgpu files under root (/sys/class/drm/card0/device/...)
    const drmBase = path.join(this.root, 'sys', 'class', 'drm');
    let cardDeviceDir = path.join(drmBase, 'card0', 'device');
    let busyText = await readTextOrNull(path.join(cardDeviceDir, 'gpu_busy_percent'));
    if (this.gen !== myGen) return;
    if (busyText == null) {
      const altDir = path.join(drmBase, 'card1', 'device');
      const altBusy = await readTextOrNull(path.join(altDir, 'gpu_busy_percent'));
      if (this.gen !== myGen) return;
      if (altBusy != null) {
        cardDeviceDir = altDir;
        busyText = altBusy;
      }
    }
    if (busyText == null) {
      this.gpu = { available: false, name: '', busyPct: null, vramUsedBytes: 0, vramTotalBytes: 0, vramPct: 0 };
      return;
    }

    const [vramUsedText, vramTotalText] = await Promise.all([
      readTextOrNull(path.join(cardDeviceDir, 'mem_info_vram_used')),
      readTextOrNull(path.join(cardDeviceDir, 'mem_info_vram_total')),
    ]);
    if (this.gen !== myGen) return;

    const busyPct = Math.min(100, Math.max(0, parseFloat(busyText.trim()) || 0));
    const vramUsedBytes = vramUsedText != null ? parseInt(vramUsedText.trim(), 10) || 0 : 0;
    const vramTotalBytes = vramTotalText != null ? parseInt(vramTotalText.trim(), 10) || 0 : 0;
    const vramPct = vramTotalBytes > 0 ? Math.min(100, Math.max(0, (vramUsedBytes / vramTotalBytes) * 100)) : 0;
    this.gpu = {
      available: true,
      name: 'GPU',
      busyPct,
      vramUsedBytes,
      vramTotalBytes,
      vramPct,
    };
  }

  _recordHistory() {
    pushRing(this.history.cpuTotal, this.cpu.totalPct);
    const coreCount = this.cpu.corePcts.length;
    while (this.history.cpuCores.length < coreCount) this.history.cpuCores.push([]);
    for (let i = 0; i < coreCount; i++) {
      pushRing(this.history.cpuCores[i], this.cpu.corePcts[i]);
    }
    pushRing(this.history.memPct, this.mem.usedPct);
    pushRing(this.history.swapPct, this.mem.swapPct);
    pushRing(this.history.diskReadBps, this.disk.readBps);
    pushRing(this.history.diskWriteBps, this.disk.writeBps);
    pushRing(this.history.netRxBps, this.net.rxBps);
    pushRing(this.history.netTxBps, this.net.txBps);
    if (this.gpu.available) {
      pushRing(this.history.gpuBusyPct, this.gpu.busyPct ?? 0);
      pushRing(this.history.gpuVramPct, this.gpu.vramPct);
    }
  }
}
