/**
 * Recordings library manager.
 * Stores `.wav` files alongside `.json` metadata sidecars (`{ title, createdAt,
 * duration, sampleRate, markers, transcript, peaks }`) in the recordings folder.
 * If a `.wav` file has no `.json` sidecar, reads its header asynchronously via
 * `readWavHeader` and synthesizes default metadata without reading the whole file.
 */

import { api, attempt } from '/lib/dom.js';
import { encodeWav, decodeWav, readWavHeader, computePeaks } from './wav.js';

const fs = require('fs');
const path = require('path');

export class RecordingsLibrary {
  constructor({ dir, onChange } = {}) {
    this.dir = dir || defaultRecordingsDir();
    this.onChange = onChange || null;
    this.items = [];
    this.loading = false;
    this.loadVersion = 0;
  }

  /** Set the recordings folder and reload. */
  async setDir(dir) {
    this.dir = path.resolve(String(dir));
    return this.load();
  }

  /** Ensure the recordings directory exists on disk. */
  async ensureDir() {
    try {
      await fs.promises.mkdir(this.dir, { recursive: true });
    } catch (_) {}
  }

  /**
   * Load all `.wav` recordings in `this.dir` asynchronously in frame-friendly batches.
   * @returns {Promise<Array<Object>>}
   */
  async load() {
    const version = ++this.loadVersion;
    this.loading = true;
    await this.ensureDir();

    let names = [];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch (_) {
      names = [];
    }
    if (version !== this.loadVersion) return this.items;

    const wavFiles = names.filter((n) => typeof n === 'string' && n.toLowerCase().endsWith('.wav'));
    const loaded = [];
    const BATCH_SIZE = 20;

    for (let i = 0; i < wavFiles.length; i += BATCH_SIZE) {
      if (version !== this.loadVersion) return this.items;
      const slice = wavFiles.slice(i, i + BATCH_SIZE);
      const batch = await Promise.all(slice.map((name) => this._loadEntry(path.join(this.dir, name))));
      for (const item of batch) {
        if (item) loaded.push(item);
      }
      if (i + BATCH_SIZE < wavFiles.length) {
        await nextFrame();
      }
    }

    if (version !== this.loadVersion) return this.items;
    loaded.sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title));
    this.items = loaded;
    this.loading = false;
    this._notify();
    return this.items;
  }

  /**
   * Save a newly recorded clip to disk as `<slug>-<timestamp>.wav` + `.json`.
   */
  async saveRecording(rec) {
    await this.ensureDir();
    const now = Date.now();
    const indexNum = this.items.length + 1;
    const title = (rec.title && String(rec.title).trim()) || `Recording ${indexNum}`;
    const stem = `${sanitizeSlug(title)}-${now}`;
    const wavPath = path.join(this.dir, `${stem}.wav`);
    const jsonPath = path.join(this.dir, `${stem}.json`);

    const wavBytes = encodeWav(rec.samples, rec.sampleRate, 1);
    const peaksArr = Array.from(rec.peaks || computePeaks(rec.samples, 256, 1)).map((v) => Math.round(v * 1000) / 1000);
    const markers = Array.isArray(rec.markers) ? rec.markers.map((m) => ({
      timeSec: Math.round(Number(m.timeSec || 0) * 100) / 100,
      label: String(m.label || 'Marker'),
    })) : [];
    const duration = rec.duration != null ? Number(rec.duration) : (rec.sampleRate > 0 ? rec.samples.length / rec.sampleRate : 0);
    const transcript = rec.transcript ? String(rec.transcript) : '';

    const meta = {
      title,
      createdAt: now,
      duration: Math.round(duration * 100) / 100,
      sampleRate: rec.sampleRate || 16000,
      markers,
      transcript,
      peaks: peaksArr,
    };

    await fs.promises.writeFile(wavPath, wavBytes);
    await fs.promises.writeFile(jsonPath, JSON.stringify(meta, null, 2));

    const entry = this._makeEntry(wavPath, jsonPath, meta, wavBytes.byteLength);
    this.items = [entry, ...this.items];
    this._notify();
    return entry;
  }

  /** Import an external `.wav` file into the library. */
  async importWavFile(filePath) {
    const resolved = path.resolve(filePath);
    const existing = this.items.find((it) => it.path === resolved);
    if (existing) return existing;
    const entry = await this._loadEntry(resolved);
    if (!entry) return null;
    this.items = [entry, ...this.items];
    this._notify();
    return entry;
  }

  /** Read and decode the full PCM samples of a recording entry. */
  async loadAudio(item) {
    const raw = await fs.promises.readFile(item.path);
    const decoded = decodeWav(raw, 256);
    if (!item.peaks || !item.peaks.length) {
      item.peaks = Array.from(decoded.peaks).map((v) => Math.round(v * 1000) / 1000);
    }
    return decoded;
  }

  /** Update a recording's metadata (title, markers, transcript) and persist `.json`. */
  async updateMetadata(idOrItem, patch) {
    const key = typeof idOrItem === 'string' ? idOrItem : (idOrItem && idOrItem.id);
    const idx = this.items.findIndex((it) => it.id === key);
    if (idx < 0) return null;
    const cur = this.items[idx];

    const updatedMeta = {
      title: patch.title != null ? String(patch.title).trim() || cur.title : cur.title,
      createdAt: cur.createdAt,
      duration: cur.duration,
      sampleRate: cur.sampleRate,
      markers: patch.markers != null ? patch.markers.map((m) => ({
        timeSec: Math.round(Number(m.timeSec || 0) * 100) / 100,
        label: String(m.label || 'Marker'),
      })) : cur.markers,
      transcript: patch.transcript != null ? String(patch.transcript) : cur.transcript,
      peaks: patch.peaks != null ? patch.peaks : cur.peaks,
    };

    await fs.promises.writeFile(cur.jsonPath, JSON.stringify(updatedMeta, null, 2));
    const nextItem = this._makeEntry(cur.path, cur.jsonPath, updatedMeta, cur.size);
    this.items = this.items.slice();
    this.items[idx] = nextItem;
    this._notify();
    return nextItem;
  }

  /** Delete a recording (`.wav` and `.json` sidecar) with an Undo restore handle. */
  async deleteRecording(idOrItem) {
    const key = typeof idOrItem === 'string' ? idOrItem : (idOrItem && idOrItem.id);
    const idx = this.items.findIndex((it) => it.id === key);
    if (idx < 0) return null;
    const item = this.items[idx];

    let wavBackup = null;
    let jsonBackup = null;
    try { wavBackup = await fs.promises.readFile(item.path); } catch (_) {}
    try { jsonBackup = await fs.promises.readFile(item.jsonPath); } catch (_) {}

    const vfs = api('vfs');
    let trashWav = null;
    let trashJson = null;

    if (vfs && typeof vfs.trash === 'function') {
      try { trashWav = await vfs.trash(item.path); } catch (_) {}
      try { trashJson = await vfs.trash(item.jsonPath); } catch (_) {}
    }
    if (!trashWav) {
      try { await fs.promises.unlink(item.path); } catch (_) {}
      try { await fs.promises.unlink(item.jsonPath); } catch (_) {}
    }

    this.items = this.items.filter((it) => it.id !== key);
    this._notify();

    return {
      item,
      restore: async () => {
        if (trashWav && trashWav.id && vfs && typeof vfs.restoreTrash === 'function') {
          try { await vfs.restoreTrash(trashWav.id); } catch (_) {}
          if (trashJson && trashJson.id) {
            try { await vfs.restoreTrash(trashJson.id); } catch (_) {}
          }
        } else {
          if (wavBackup) await fs.promises.writeFile(item.path, wavBackup);
          if (jsonBackup) await fs.promises.writeFile(item.jsonPath, jsonBackup);
        }
        await this.load();
        return this.items.find((it) => it.id === item.id) || item;
      },
    };
  }

  /** Export a recording's `.wav` file to a destination path. */
  async exportWav(item, destPath) {
    if (!item || !destPath) return false;
    const data = await fs.promises.readFile(item.path);
    await fs.promises.writeFile(destPath, data);
    return true;
  }

  /** Filter and sort items for the `VirtualList`. */
  query({ query = '', sortBy = 'date', sortDir = -1 } = {}) {
    const q = String(query || '').trim();
    let list = this.items.slice();

    if (q) {
      const lower = q.toLowerCase();
      const searchText = (it) => {
        const markerStr = (it.markers || []).map((m) => m.label).join(' ');
        return `${it.title} ${markerStr} ${it.transcript || ''}`;
      };

      const searchApi = api('search');
      if (searchApi && typeof searchApi.fuzzy === 'function') {
        const fuzzyHits = attempt('search.fuzzy', () => searchApi.fuzzy(q, list, { key: searchText }), null);
        if (Array.isArray(fuzzyHits)) {
          const hitSet = new Set(fuzzyHits.map((h) => h.item));
          for (const it of list) {
            if (!hitSet.has(it) && searchText(it).toLowerCase().includes(lower)) {
              fuzzyHits.push({ item: it, score: 1 });
            }
          }
          return fuzzyHits.map((h) => h.item);
        }
      }

      list = list.filter((it) => searchText(it).toLowerCase().includes(lower));
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'title' || sortBy === 'name') {
        cmp = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
      } else if (sortBy === 'duration') {
        cmp = a.duration - b.duration;
      } else {
        cmp = a.createdAt - b.createdAt;
      }
      if (cmp !== 0) return cmp * sortDir;
      return a.title.localeCompare(b.title);
    });

    return list;
  }

  async _loadEntry(wavPath) {
    const stem = path.basename(wavPath, path.extname(wavPath));
    const jsonPath = path.join(path.dirname(wavPath), `${stem}.json`);

    let stat = null;
    try {
      stat = await fs.promises.stat(wavPath);
    } catch (_) {
      return null;
    }

    let meta = null;
    try {
      const text = await fs.promises.readFile(jsonPath, 'utf8');
      meta = JSON.parse(text);
    } catch (_) {
      meta = null;
    }

    if (!meta || typeof meta !== 'object') {
      let hdr = { sampleRate: 16000, duration: 0 };
      try {
        hdr = await readWavHeader(wavPath);
      } catch (_) {}
      meta = {
        title: prettifyStem(stem),
        createdAt: Math.round(stat.mtimeMs || Date.now()),
        duration: Math.round((hdr.duration || 0) * 100) / 100,
        sampleRate: hdr.sampleRate || 16000,
        markers: [],
        transcript: '',
        peaks: syntheticEnvelopeFromSeed(stem, 64),
      };
    }

    return this._makeEntry(wavPath, jsonPath, meta, stat.size || 0);
  }

  _makeEntry(wavPath, jsonPath, meta, sizeBytes) {
    const markers = Array.isArray(meta.markers) ? meta.markers : [];
    const transcript = typeof meta.transcript === 'string' ? meta.transcript : '';
    const peaks = Array.isArray(meta.peaks) && meta.peaks.length
      ? meta.peaks
      : syntheticEnvelopeFromSeed(meta.title || path.basename(wavPath), 64);

    return {
      id: wavPath,
      path: wavPath,
      wavPath,
      jsonPath,
      fileName: path.basename(wavPath),
      title: String(meta.title || prettifyStem(path.basename(wavPath, '.wav'))),
      createdAt: Number(meta.createdAt) || Date.now(),
      duration: Number(meta.duration) || 0,
      sampleRate: Number(meta.sampleRate) || 16000,
      size: Number(sizeBytes) || 0,
      markers,
      markerCount: markers.length,
      transcript,
      hasTranscript: transcript.trim().length > 0,
      peaks,
    };
  }

  _notify() {
    if (this.onChange) this.onChange(this.items);
  }
}

export function defaultRecordingsDir() {
  if (typeof bro !== 'undefined' && bro.app && bro.app.dataDir) {
    return path.join(bro.app.dataDir, 'recordings');
  }
  const base = process.env.BRO_APP_HOME || '.';
  return path.join(base, 'recordings');
}

function sanitizeSlug(title) {
  const s = String(title || 'recording')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'recording';
}

function prettifyStem(stem) {
  const cleaned = String(stem).replace(/-\d{10,15}$/, '').replace(/[-_]+/g, ' ').trim();
  if (!cleaned) return stem;
  return cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function syntheticEnvelopeFromSeed(seedStr, bins = 64) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = new Array(bins);
  for (let i = 0; i < bins; i++) {
    h ^= i + 1;
    h = Math.imul(h, 16777619);
    const u = ((h >>> 0) % 1000) / 1000;
    out[i] = Math.round((0.15 + 0.75 * u) * 1000) / 1000;
  }
  return out;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
