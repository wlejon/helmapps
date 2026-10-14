/**
 * Log sources discovery, tail-capped async reader, and live file watcher.
 * Reads real log files via fs.promises without spawning child processes.
 * Supports injectable rootDir via setRoot(dir) for deterministic headless testing.
 */

import { api } from '/lib/dom.js';
import { homeDir, isLinux, isWindows } from '/lib/files.js';
import { parseLogText, parseLogTextAsync } from './log-parser.js';

const fs = require('fs');
const path = require('path');

/** Read at most the last 2 MB of any single log file so huge logs never stall the UI. */
export const MAX_BYTES = 2 * 1024 * 1024;

const SYSTEM_LOG_NAMES = [
  'syslog',
  'messages',
  'dmesg',
  'kern.log',
  'Xorg.0.log',
  'pacman.log',
  'auth.log',
  'boot.log',
];

function isLogFilename(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (SYSTEM_LOG_NAMES.some((n) => n.toLowerCase() === lower)) return true;
  return lower.endsWith('.log') || lower.endsWith('.jsonl') || lower.endsWith('.ndjson');
}

function sourceIconFor(section, name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('kern') || lower.includes('dmesg')) return 'cpu';
  if (lower.includes('xorg') || lower.includes('display')) return 'monitor';
  if (lower.includes('auth') || lower.includes('sec')) return 'shield';
  if (lower.includes('pacman') || lower.includes('pkg')) return 'package';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'file-code';
  if (section === 'desktop') return 'layers';
  if (section === 'system') return 'hard-drive';
  return 'file-text';
}

function cleanSourceLabel(filePath, section) {
  const base = path.basename(filePath);
  if (section === 'desktop') {
    const parent = path.basename(path.dirname(filePath));
    if (base.endsWith('.log')) {
      const stem = base.slice(0, -4);
      if (stem.startsWith('helm.')) return stem;
      if (parent.startsWith('helm.') && stem === parent) return parent;
    }
  }
  return base;
}

async function statFileOrNull(p) {
  try {
    const st = await fs.promises.stat(p);
    return st.isFile() ? st : null;
  } catch (_) {
    return null;
  }
}

async function safeReaddir(dir) {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
}

/**
 * Read up to the last `maxBytes` of a file asynchronously as UTF-8 text.
 * If truncated at the front, drops the partial first line.
 */
export async function readLogTail(filePath, maxBytes = MAX_BYTES) {
  let fd = null;
  try {
    const st = await fs.promises.stat(filePath);
    if (!st.isFile()) return { text: '', size: 0, mtimeMs: 0, truncated: false };
    const size = st.size;
    if (size === 0) return { text: '', size: 0, mtimeMs: st.mtimeMs, truncated: false };

    if (size <= maxBytes) {
      const text = await fs.promises.readFile(filePath, 'utf8');
      return { text, size, mtimeMs: st.mtimeMs, truncated: false };
    }

    const offset = size - maxBytes;
    fd = fs.openSync(filePath, 'r');
    const buf = new Uint8Array(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, offset);
    fs.closeSync(fd);
    fd = null;

    let text = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, bytesRead));
    const firstNl = text.indexOf('\n');
    if (firstNl >= 0 && firstNl < 4096) {
      text = text.slice(firstNl + 1);
    }
    return { text, size, mtimeMs: st.mtimeMs, truncated: true };
  } catch (_) {
    if (fd != null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    return { text: '', size: 0, mtimeMs: 0, truncated: false };
  }
}

/**
 * Read only newly appended bytes from `fromOffset` to end of file.
 */
export async function readAppendedBytes(filePath, fromOffset) {
  let fd = null;
  try {
    const st = await fs.promises.stat(filePath);
    if (!st.isFile() || st.size <= fromOffset) {
      return { text: '', size: st ? st.size : 0, mtimeMs: st ? st.mtimeMs : 0, reset: st && st.size < fromOffset };
    }
    const len = Math.min(st.size - fromOffset, MAX_BYTES);
    const start = st.size - len;
    fd = fs.openSync(filePath, 'r');
    const buf = new Uint8Array(len);
    const bytesRead = fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    fd = null;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, bytesRead));
    return { text, size: st.size, mtimeMs: st.mtimeMs, reset: false };
  } catch (_) {
    if (fd != null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    return { text: '', size: fromOffset, mtimeMs: 0, reset: false };
  }
}

export class LogSourceManager {
  constructor() {
    this.rootDir = null;
    this.discoverGen = 0;
    this.sources = new Map(); // id -> source object
    this.openedPaths = new Set();
    this.activeWatch = null;
  }

  setRoot(rootDir) {
    this.discoverGen++;
    this.rootDir = rootDir && rootDir !== '/' ? path.resolve(rootDir) : null;
  }

  /**
   * Discover all readable log sources across Desktop & Apps, System, and Opened Files.
   */
  async discover() {
    const gen = ++this.discoverGen;
    const desktopPaths = [];
    const systemPaths = [];

    const effectiveRoot = this.rootDir || (process.env.BRO_APP_HOME ? path.resolve(process.env.BRO_APP_HOME) : null);

    if (effectiveRoot) {
      // Root directory structure (test fixture or isolated BRO_APP_HOME)
      const stateDir = path.join(effectiveRoot, 'state');
      const stateEntries = await safeReaddir(stateDir);
      if (gen !== this.discoverGen) return null;
      for (const e of stateEntries) {
        const full = path.join(stateDir, e.name);
        if (e.isDirectory()) {
          const sub = await safeReaddir(full);
          for (const s of sub) {
            if (s.isFile() && isLogFilename(s.name)) desktopPaths.push(path.join(full, s.name));
          }
        } else if (e.isFile() && isLogFilename(e.name)) {
          desktopPaths.push(full);
        }
      }

      for (const folder of ['logs', 'helm']) {
        const d = path.join(effectiveRoot, folder);
        const entries = await safeReaddir(d);
        if (gen !== this.discoverGen) return null;
        for (const e of entries) {
          if (e.isFile() && isLogFilename(e.name)) desktopPaths.push(path.join(d, e.name));
        }
      }

      const varLog = path.join(effectiveRoot, 'var', 'log');
      const varEntries = await safeReaddir(varLog);
      if (gen !== this.discoverGen) return null;
      for (const e of varEntries) {
        if (e.isFile() && isLogFilename(e.name)) {
          systemPaths.push(path.join(varLog, e.name));
        }
      }
    } else {
      // Real system discovery
      const home = homeDir();
      const appLog = typeof bro !== 'undefined' && bro.app && bro.app.logFile ? bro.app.logFile : '';
      if (appLog && (await statFileOrNull(appLog))) {
        desktopPaths.push(path.resolve(appLog));
      }
      if (gen !== this.discoverGen) return null;

      const candidateStateDirs = [];
      if (process.env.XDG_STATE_HOME) candidateStateDirs.push(process.env.XDG_STATE_HOME);
      if (home) {
        candidateStateDirs.push(path.join(home, '.local', 'state'));
        candidateStateDirs.push(path.join(home, '.cache', 'bro'));
        candidateStateDirs.push(path.join(home, '.local', 'share', 'bro', 'logs'));
      }
      if (isWindows) {
        if (process.env.LOCALAPPDATA) candidateStateDirs.push(process.env.LOCALAPPDATA);
        if (process.env.APPDATA) candidateStateDirs.push(path.join(process.env.APPDATA, 'Helm'));
      }
      if (typeof bro !== 'undefined' && bro.app && bro.app.configDir) {
        candidateStateDirs.push(path.dirname(bro.app.configDir));
      }

      const seenDirs = new Set();
      for (const dir of candidateStateDirs) {
        if (!dir) continue;
        const resolved = path.resolve(dir);
        if (seenDirs.has(resolved)) continue;
        seenDirs.add(resolved);

        const entries = await safeReaddir(resolved);
        if (gen !== this.discoverGen) return null;
        for (const e of entries) {
          const full = path.join(resolved, e.name);
          if (e.isDirectory() && (e.name.startsWith('helm.') || e.name === 'bro' || e.name === 'helm')) {
            const sub = await safeReaddir(full);
            for (const s of sub) {
              if (s.isFile() && isLogFilename(s.name)) desktopPaths.push(path.join(full, s.name));
            }
          } else if (e.isFile() && isLogFilename(e.name)) {
            desktopPaths.push(full);
          }
        }
      }

      if (isLinux) {
        for (const name of SYSTEM_LOG_NAMES) {
          const p = `/var/log/${name}`;
          if (await statFileOrNull(p)) systemPaths.push(p);
        }
      }
    }

    if (gen !== this.discoverGen) return null;

    const nextSources = new Map();
    const seenPaths = new Set();

    const registerPath = async (filePath, section) => {
      const norm = path.resolve(filePath);
      if (seenPaths.has(norm)) return null;
      const st = await statFileOrNull(norm);
      if (!st) return null;
      seenPaths.add(norm);

      const prev = this.sources.get(norm);
      const label = cleanSourceLabel(norm, section);
      const srcObj = {
        id: norm,
        path: norm,
        label,
        section,
        icon: sourceIconFor(section, path.basename(norm)),
        size: st.size,
        mtimeMs: st.mtimeMs,
        entries: prev ? prev.entries : [],
        errorCount: prev ? prev.errorCount : 0,
        warnCount: prev ? prev.warnCount : 0,
        loaded: prev ? prev.loaded : false,
        truncated: prev ? prev.truncated : false,
      };
      nextSources.set(norm, srcObj);
      return srcObj;
    };

    for (const p of desktopPaths) await registerPath(p, 'desktop');
    for (const p of systemPaths) await registerPath(p, 'system');
    for (const p of this.openedPaths) await registerPath(p, 'opened');

    if (gen !== this.discoverGen) return null;
    this.sources = nextSources;

    for (const s of this.sources.values()) {
      if (gen !== this.discoverGen) return null;
      await this.loadSource(s.id);
    }

    if (gen !== this.discoverGen) return null;
    return this.getSections();
  }

  /**
   * Load or reload a single source from disk.
   */
  async loadSource(id) {
    if (id === 'all') {
      for (const s of this.sources.values()) {
        await this.loadSource(s.id);
      }
      return this.getAllEntries();
    }
    const src = this.sources.get(id);
    if (!src) return [];
    const { text, size, mtimeMs, truncated } = await readLogTail(src.path);
    const entries = await parseLogTextAsync(text, { sourceName: src.label, startId: 1 });
    let errors = 0;
    let warns = 0;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].severity === 'error') errors++;
      else if (entries[i].severity === 'warn') warns++;
    }
    src.entries = entries;
    src.errorCount = errors;
    src.warnCount = warns;
    src.size = size;
    src.mtimeMs = mtimeMs;
    src.truncated = truncated;
    src.loaded = true;
    return entries;
  }

  /**
   * Add and load an arbitrary log file into Opened Files (or select existing source).
   */
  async addOpenedFile(filePath) {
    if (!filePath) return null;
    const norm = path.resolve(filePath);
    const st = await statFileOrNull(norm);
    if (!st) return null;

    if (!this.sources.has(norm)) {
      this.openedPaths.add(norm);
      const label = path.basename(norm);
      this.sources.set(norm, {
        id: norm,
        path: norm,
        label,
        section: 'opened',
        icon: sourceIconFor('opened', label),
        size: st.size,
        mtimeMs: st.mtimeMs,
        entries: [],
        errorCount: 0,
        warnCount: 0,
        loaded: false,
        truncated: false,
      });
    }
    await this.loadSource(norm);
    return this.sources.get(norm);
  }

  getSource(id) {
    if (id === 'all') {
      const entries = this.getAllEntries();
      let errors = 0;
      let warns = 0;
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].severity === 'error') errors++;
        else if (entries[i].severity === 'warn') warns++;
      }
      return {
        id: 'all',
        path: '',
        label: 'All Sources',
        section: 'desktop',
        icon: 'layers',
        entries,
        errorCount: errors,
        warnCount: warns,
        loaded: true,
      };
    }
    return this.sources.get(id) || null;
  }

  getAllEntries() {
    const combined = [];
    let seq = 1;
    for (const src of this.sources.values()) {
      for (const e of src.entries) {
        combined.push({ ...e, id: seq++ });
      }
    }
    return combined;
  }

  formatSourceSub(entryCount, errorCount) {
    const ePart = `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`;
    if (errorCount > 0) {
      return `${ePart} • ${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`;
    }
    return ePart;
  }

  getSections() {
    const desktopItems = [];
    const systemItems = [];
    const openedItems = [];

    let totalEntries = 0;
    let totalErrors = 0;

    for (const s of this.sources.values()) {
      totalEntries += s.entries.length;
      totalErrors += s.errorCount;
      const item = {
        id: s.id,
        label: s.label,
        icon: s.icon,
        sub: this.formatSourceSub(s.entries.length, s.errorCount),
        title: s.path,
      };
      if (s.section === 'desktop') desktopItems.push(item);
      else if (s.section === 'system') systemItems.push(item);
      else openedItems.push(item);
    }

    if (this.sources.size > 1) {
      desktopItems.unshift({
        id: 'all',
        label: 'All Sources',
        icon: 'layers',
        sub: this.formatSourceSub(totalEntries, totalErrors),
        title: 'Combined view of all discovered log sources',
      });
    }

    return { desktop: desktopItems, system: systemItems, opened: openedItems };
  }

  /**
   * Watch a source (or 'all' sources) for live updates. Calls `onUpdate(newEntries, allEntries)` when new lines arrive.
   */
  watchSource(sourceId, onUpdate) {
    this.stopWatch();
    if (!sourceId) return;
    const targets = sourceId === 'all'
      ? Array.from(this.sources.values()).filter((s) => s && s.path)
      : [this.sources.get(sourceId)].filter((s) => s && s.path);
    if (!targets.length) return;

    let stopped = false;
    let checking = false;

    const checkGrowth = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        let anyChanged = false;
        const newlyAdded = [];
        for (const src of targets) {
          const res = await readAppendedBytes(src.path, src.size);
          if (stopped) return;
          if (res.reset) {
            await this.loadSource(src.id);
            anyChanged = true;
          } else if (res.text) {
            src.size = res.size;
            src.mtimeMs = res.mtimeMs;
            const nextStartId = src.entries.length ? src.entries[src.entries.length - 1].id + 1 : 1;
            const added = parseLogText(res.text, { sourceName: src.label, startId: nextStartId });
            if (added.length > 0) {
              for (const e of added) {
                src.entries.push(e);
                if (e.severity === 'error') src.errorCount++;
                else if (e.severity === 'warn') src.warnCount++;
                newlyAdded.push(e);
              }
              anyChanged = true;
            }
          }
        }
        if (anyChanged && !stopped && onUpdate) {
          const allEntries = sourceId === 'all' ? this.getAllEntries() : targets[0].entries;
          onUpdate(newlyAdded, allEntries);
        }
      } finally {
        checking = false;
      }
    };

    const vfs = api('vfs');
    const vfsWatchers = [];
    const fsWatchers = [];
    const watchedDirs = new Set();

    for (const src of targets) {
      const dir = path.dirname(src.path);
      if (vfs && typeof vfs.watch === 'function' && !watchedDirs.has(dir)) {
        watchedDirs.add(dir);
        try {
          vfsWatchers.push(vfs.watch(dir, () => { checkGrowth(); }, { recursive: false }));
        } catch (_) {}
      } else if (!vfs && typeof fs.watch === 'function') {
        try {
          fsWatchers.push(fs.watch(src.path, () => { checkGrowth(); }));
        } catch (_) {}
      }
    }

    const timer = setInterval(checkGrowth, 120);

    this.activeWatch = {
      stop() {
        stopped = true;
        clearInterval(timer);
        for (const w of vfsWatchers) {
          if (w && typeof w.unwatch === 'function') {
            try { w.unwatch(); } catch (_) {}
          }
        }
        for (const w of fsWatchers) {
          if (w && typeof w.close === 'function') {
            try { w.close(); } catch (_) {}
          }
        }
      },
    };
  }

  stopWatch() {
    if (this.activeWatch) {
      this.activeWatch.stop();
      this.activeWatch = null;
    }
  }
}
