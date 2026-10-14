/**
 * Process parser and async /proc/[pid] sampler.
 *
 * Pure parser functions are exported for direct unit testing in test_parsers.js.
 * Designed for low overhead with 500+ processes:
 *  - Reads /proc/[pid]/stat once per tick per process using async fs.promises.
 *  - Caches /proc/[pid]/cmdline and /proc/[pid]/status per PID so they are
 *    only read when a new PID appears.
 *  - Evicts disappeared PIDs on each tick.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

export const PAGE_SIZE = 4096;

export const STATE_NAMES = {
  R: 'Running',
  S: 'Sleeping',
  D: 'Disk Sleep',
  Z: 'Zombie',
  T: 'Stopped',
  t: 'Tracing',
  X: 'Dead',
  I: 'Idle',
};

/**
 * Parse /proc/[pid]/stat.
 * Handles process names `(comm)` that contain spaces, parentheses, or newlines
 * by locating the first `(` and the last `)`.
 */
export function parsePidStat(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const openIdx = raw.indexOf('(');
  const closeIdx = raw.lastIndexOf(')');
  if (openIdx < 0 || closeIdx < 0 || closeIdx <= openIdx) return null;

  const pid = parseInt(raw.slice(0, openIdx).trim(), 10);
  if (!Number.isFinite(pid)) return null;

  const name = raw.slice(openIdx + 1, closeIdx);
  const tail = raw.slice(closeIdx + 1).trim();
  const rest = tail.includes('  ') ? tail.split(/\s+/) : tail.split(' ');
  if (rest.length < 22) return null;

  const state = rest[0] || 'S';
  const ppid = parseInt(rest[1], 10) || 0;
  const pgrp = parseInt(rest[2], 10) || 0;
  const utime = parseInt(rest[11], 10) || 0;
  const stime = parseInt(rest[12], 10) || 0;
  const priority = parseInt(rest[15], 10) || 0;
  const nice = parseInt(rest[16], 10) || 0;
  const threads = parseInt(rest[17], 10) || 1;
  const starttime = parseInt(rest[19], 10) || 0;
  const vsizeBytes = parseInt(rest[20], 10) || 0;
  const rssPages = parseInt(rest[21], 10) || 0;
  const rssBytes = Math.max(0, rssPages * PAGE_SIZE);
  const ticks = utime + stime;

  return {
    pid,
    name,
    state,
    stateLabel: STATE_NAMES[state] || state,
    ppid,
    pgrp,
    utime,
    stime,
    ticks,
    priority,
    nice,
    threads,
    starttime,
    vsizeBytes,
    rssPages,
    rssBytes,
  };
}

/**
 * Parse /proc/[pid]/status for UID and detailed memory breakdown.
 */
export function parsePidStatus(text) {
  const out = {
    name: '',
    state: '',
    uid: null,
    gid: null,
    threads: 0,
    vmRssBytes: 0,
    vmSizeBytes: 0,
    vmSwapBytes: 0,
    vmDataBytes: 0,
    vmStkBytes: 0,
    vmExeBytes: 0,
  };
  if (!text) return out;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key === 'Name') out.name = val;
    else if (key === 'State') out.state = val;
    else if (key === 'Uid') {
      const u = parseInt(val, 10);
      if (Number.isFinite(u)) out.uid = u;
    } else if (key === 'Gid') {
      const g = parseInt(val, 10);
      if (Number.isFinite(g)) out.gid = g;
    } else if (key === 'Threads') {
      out.threads = parseInt(val, 10) || 0;
    } else if (key === 'VmRSS') {
      out.vmRssBytes = (parseInt(val, 10) || 0) * 1024;
    } else if (key === 'VmSize') {
      out.vmSizeBytes = (parseInt(val, 10) || 0) * 1024;
    } else if (key === 'VmSwap') {
      out.vmSwapBytes = (parseInt(val, 10) || 0) * 1024;
    } else if (key === 'VmData') {
      out.vmDataBytes = (parseInt(val, 10) || 0) * 1024;
    } else if (key === 'VmStk') {
      out.vmStkBytes = (parseInt(val, 10) || 0) * 1024;
    } else if (key === 'VmExe') {
      out.vmExeBytes = (parseInt(val, 10) || 0) * 1024;
    }
  }
  return out;
}

/**
 * Parse /proc/[pid]/cmdline (null-separated arguments -> space-separated string).
 */
export function parsePidCmdline(text) {
  if (!text) return '';
  return String(text).split('\x00').filter(Boolean).join(' ').trim();
}

/**
 * Compute per-process CPU % from utime+stime deltas against total jiffies delta.
 * Accepts either numeric tick counts (utime + stime) or parsePidStat objects.
 */
export function computeProcCpuPct(prev, curr, totalJiffiesDelta) {
  if (!totalJiffiesDelta || totalJiffiesDelta <= 0 || prev == null || curr == null) return 0;
  const t0 = typeof prev === 'object' ? (prev.ticks ?? ((prev.utime || 0) + (prev.stime || 0))) : Number(prev);
  const t1 = typeof curr === 'object' ? (curr.ticks ?? ((curr.utime || 0) + (curr.stime || 0))) : Number(curr);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  const dTicks = Math.max(0, t1 - t0);
  return Math.min(100, Math.max(0, (dTicks / totalJiffiesDelta) * 100));
}

async function readTextOrNull(filePath) {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (_) {
    return null;
  }
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class ProcSampler {
  constructor(root = '/') {
    this.root = root;
    this.gen = 0;
    this.uidMap = new Map();
    this.passwdLoaded = false;
    this.reset();
  }

  setRoot(root) {
    this.gen++;
    this.root = root || '/';
    this.passwdLoaded = false;
    this.reset();
  }

  reset() {
    this.supported = false;
    this.processes = [];
    this.prevTicks = new Map();     // pid -> { ticks, starttime }
    this.staticCache = new Map();   // pid -> { starttime, cmdline, user, uid, status }
  }

  async _ensureUidMap(myGen) {
    if (this.passwdLoaded) return;
    this.passwdLoaded = true;
    this.uidMap.clear();
    this.uidMap.set(0, 'root');
    try {
      if (typeof os.userInfo === 'function') {
        const info = os.userInfo();
        if (info && info.uid != null && info.username) {
          this.uidMap.set(info.uid, info.username);
        }
      }
    } catch (_) {}

    const passwdText = await readTextOrNull(path.join(this.root, 'etc', 'passwd'));
    if (this.gen !== myGen) return;
    if (passwdText) {
      for (const line of passwdText.split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(':');
        if (parts.length >= 3) {
          const uid = parseInt(parts[2], 10);
          if (Number.isFinite(uid) && parts[0]) this.uidMap.set(uid, parts[0]);
        }
      }
    }
  }

  userForUid(uid) {
    if (uid == null || !Number.isFinite(uid)) return '—';
    if (this.uidMap.has(uid)) return this.uidMap.get(uid);
    return String(uid);
  }

  /**
   * Sample all numeric PIDs under `${this.root}/proc`.
   * @param {number} totalJiffiesDelta  delta of total CPU jiffies from SysSampler
   */
  async sample(totalJiffiesDelta = 0) {
    const myGen = this.gen;
    const procDir = path.join(this.root, 'proc');
    let names;
    try {
      names = await fs.promises.readdir(procDir);
    } catch (_) {
      if (this.gen === myGen) {
        this.supported = false;
        this.processes = [];
        this.prevTicks.clear();
        this.staticCache.clear();
      }
      return this.processes;
    }
    if (this.gen !== myGen) return this.processes;

    this.supported = true;
    await this._ensureUidMap(myGen);
    if (this.gen !== myGen) return this.processes;

    const pids = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const c0 = name.charCodeAt(0);
      if (c0 >= 48 && c0 <= 57) {
        const pid = Number(name);
        if (Number.isInteger(pid) && pid > 0) pids.push(pid);
      }
    }

    const seen = new Set();
    const nextProcesses = [];
    const BATCH = 12;

    for (let offset = 0; offset < pids.length; offset += BATCH) {
      if (offset > 0) {
        await nextTurn();
        if (this.gen !== myGen) return this.processes;
      }
      const slice = pids.slice(offset, offset + BATCH);
      const batchResults = await Promise.all(slice.map((pid) => this._readPid(procDir, pid, totalJiffiesDelta, myGen)));
      if (this.gen !== myGen) return this.processes;
      for (let j = 0; j < batchResults.length; j++) {
        const proc = batchResults[j];
        if (proc) {
          seen.add(proc.pid);
          nextProcesses.push(proc);
        }
      }
    }

    if (pids.length > BATCH) {
      await nextTurn();
      if (this.gen !== myGen) return this.processes;
    }

    // Evict disappeared PIDs from caches
    for (const k of Array.from(this.prevTicks.keys())) {
      if (!seen.has(k)) this.prevTicks.delete(k);
    }
    for (const k of Array.from(this.staticCache.keys())) {
      if (!seen.has(k)) this.staticCache.delete(k);
    }

    this.processes = nextProcesses;
    return this.processes;
  }

  async _readPid(procDir, pid, totalJiffiesDelta, myGen) {
    const pidDir = path.join(procDir, String(pid));
    const statText = await readTextOrNull(path.join(pidDir, 'stat'));
    if (!statText || this.gen !== myGen) return null;
    const st = parsePidStat(statText);
    if (!st) return null;

    // Compute CPU % against previous tick for the same PID & starttime
    const prev = this.prevTicks.get(pid);
    let cpuPct = 0;
    if (prev && prev.starttime === st.starttime && totalJiffiesDelta > 0) {
      const dTicks = Math.max(0, st.ticks - prev.ticks);
      cpuPct = Math.min(100, (dTicks / totalJiffiesDelta) * 100);
    }
    this.prevTicks.set(pid, { ticks: st.ticks, starttime: st.starttime });

    // Read cmdline and status only for new PIDs (or if PID was reused with different starttime)
    let cached = this.staticCache.get(pid);
    if (!cached || cached.starttime !== st.starttime) {
      const [cmdText, statusText] = await Promise.all([
        readTextOrNull(path.join(pidDir, 'cmdline')),
        readTextOrNull(path.join(pidDir, 'status')),
      ]);
      const cmdline = parsePidCmdline(cmdText);
      const status = parsePidStatus(statusText);
      const uid = status.uid;
      const user = uid != null ? this.userForUid(uid) : (this.uidMap.get(0) || 'user');
      cached = {
        starttime: st.starttime,
        cmdline: cmdline || st.name,
        user,
        uid,
        status,
      };
      this.staticCache.set(pid, cached);
    }

    const memoryBytes = st.rssBytes > 0 ? st.rssBytes : (cached.status.vmRssBytes || 0);
    // Round cpuPct to 0.1% so VirtualList.setItems() only updates DOM rows whose visible CPU% changed
    const cpuRounded = Math.round(cpuPct * 10) / 10;

    return {
      pid: st.pid,
      ppid: st.ppid,
      name: st.name,
      cmdline: cached.cmdline || st.name,
      user: cached.user,
      uid: cached.uid,
      cpu: cpuRounded,
      memory: memoryBytes,
      vsize: st.vsizeBytes || cached.status.vmSizeBytes || 0,
      swap: cached.status.vmSwapBytes || 0,
      threads: st.threads || cached.status.threads || 1,
      state: st.state,
      stateLabel: st.stateLabel,
      nice: st.nice,
      starttime: st.starttime,
      depth: 0,
    };
  }

  /**
   * Read fresh detailed status and cwd for the Process Properties dialog.
   */
  async getProcessDetails(pid) {
    const pidDir = path.join(this.root, 'proc', String(pid));
    const [statText, statusText, cmdText] = await Promise.all([
      readTextOrNull(path.join(pidDir, 'stat')),
      readTextOrNull(path.join(pidDir, 'status')),
      readTextOrNull(path.join(pidDir, 'cmdline')),
    ]);
    let cwd = '—';
    try {
      if (fs.promises.readlink) {
        cwd = await fs.promises.readlink(path.join(pidDir, 'cwd'));
      }
    } catch (_) {
      cwd = '—';
    }
    const st = parsePidStat(statText);
    const status = parsePidStatus(statusText);
    const cmdline = parsePidCmdline(cmdText);
    const existing = this.processes.find((p) => p.pid === pid) || {};
    return {
      ...existing,
      ...(st || {}),
      cmdline: cmdline || existing.cmdline || st?.name || '',
      cwd,
      status,
    };
  }
}
