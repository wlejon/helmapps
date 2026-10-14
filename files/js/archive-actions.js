/**
 * Archive integration for Files (helm.files):
 *  - "Open in Archive Manager" (openApp('helm.archives', [item.path]))
 *  - "Extract Here" (extracts .zip, .tar, .tar.gz in-process into a subfolder)
 *  - "Compress to .zip…" (packs selected files/folders into a .zip archive)
 */

import { openApp } from '/lib/files.js';
import { promptDialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { formatCount } from '/lib/format.js';

const fs = require('fs');
const path = require('path');

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function runStream(stream, input) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  await Promise.all([
    (async () => {
      if (input && input.byteLength > 0) await writer.write(input);
      await writer.close();
    })(),
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
          chunks.push(u8);
          total += u8.byteLength;
        }
      }
    })(),
  ]);
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export function isArchiveItem(item) {
  if (!item || item.isDirectory) return false;
  const lower = String(item.name || item.path || '').toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.tar') ||
    lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.gz');
}

export function archiveStem(filePath) {
  const base = path.basename(filePath);
  return base.replace(/\.(tar\.gz|tgz|zip|tar|gz)$/i, '') || `${base}-extracted`;
}

function validateSafeTarget(relPath, destDir) {
  if (!relPath || /^[/\\]/.test(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`Unsafe archive entry path rejected: "${relPath}"`);
  }
  const clean = relPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!clean || clean.split('/').includes('..')) {
    throw new Error(`Unsafe archive entry path rejected: "${relPath}"`);
  }
  const resolvedDest = path.resolve(destDir);
  const resolvedTarget = path.resolve(resolvedDest, ...clean.split('/'));
  const prefix = resolvedDest.endsWith(path.sep) ? resolvedDest : resolvedDest + path.sep;
  if (resolvedTarget !== resolvedDest && !resolvedTarget.startsWith(prefix)) {
    throw new Error(`Unsafe archive entry escapes destination: "${relPath}"`);
  }
  return resolvedTarget;
}

async function extractZipBuffer(u8, destDir) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.byteLength - 22; i >= Math.max(0, u8.byteLength - 65557); i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP archive');
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  let pos = cdOffset;
  const end = Math.min(u8.byteLength, cdOffset + cdSize);
  const plan = [];

  while (pos + 46 <= end && view.getUint32(pos, true) === 0x02014b50) {
    const method = view.getUint16(pos + 10, true);
    const packedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const extAttr = view.getUint32(pos + 38, true);
    const localOffset = view.getUint32(pos + 42, true);
    const rawName = decoder.decode(u8.subarray(pos + 46, pos + 46 + nameLen));
    const isDir = rawName.endsWith('/') || ((extAttr & 0x10) !== 0 && size === 0);
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    const outPath = validateSafeTarget(rawName, destDir);
    plan.push({ isDir, method, dataOffset, packedSize, outPath });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  await fs.promises.mkdir(destDir, { recursive: true });
  let count = 0;
  for (const item of plan) {
    if (item.isDir) {
      await fs.promises.mkdir(item.outPath, { recursive: true });
    } else {
      await fs.promises.mkdir(path.dirname(item.outPath), { recursive: true });
      const slice = u8.subarray(item.dataOffset, item.dataOffset + item.packedSize);
      const data = item.method === 8 ? await runStream(new DecompressionStream('deflate-raw'), slice) : slice;
      await fs.promises.writeFile(item.outPath, data);
      count++;
    }
  }
  return count;
}

async function extractTarBuffer(u8, destDir) {
  let pos = 0;
  const plan = [];
  while (pos + 512 <= u8.byteLength) {
    let zero = true;
    for (let i = 0; i < 512; i++) if (u8[pos + i] !== 0) { zero = false; break; }
    if (zero) break;
    const readStr = (off, len) => {
      let e = off;
      while (e < off + len && u8[e] !== 0) e++;
      return decoder.decode(u8.subarray(off, e));
    };
    const name = readStr(pos, 100);
    const size = parseInt(readStr(pos + 124, 12).trim(), 8) || 0;
    const typeFlag = u8[pos + 156] ? String.fromCharCode(u8[pos + 156]) : '0';
    const prefix = readStr(pos + 257, 6).startsWith('ustar') ? readStr(pos + 345, 155) : '';
    const rawName = prefix ? `${prefix}/${name}` : name;
    const isDir = typeFlag === '5' || rawName.endsWith('/');
    const dataOffset = pos + 512;
    if (typeFlag !== 'x' && typeFlag !== 'g' && typeFlag !== 'L' && rawName) {
      const outPath = validateSafeTarget(rawName, destDir);
      plan.push({ isDir, dataOffset, size, outPath });
    }
    pos = dataOffset + Math.ceil(size / 512) * 512;
  }

  await fs.promises.mkdir(destDir, { recursive: true });
  let count = 0;
  for (const item of plan) {
    if (item.isDir) {
      await fs.promises.mkdir(item.outPath, { recursive: true });
    } else {
      await fs.promises.mkdir(path.dirname(item.outPath), { recursive: true });
      await fs.promises.writeFile(item.outPath, u8.subarray(item.dataOffset, item.dataOffset + item.size));
      count++;
    }
  }
  return count;
}

async function buildZipFromPaths(outputPath, inputPaths) {
  const entries = [];
  async function walk(diskPath, relPath) {
    const st = await fs.promises.stat(diskPath);
    if (st.isDirectory()) {
      entries.push({ path: `${relPath}/`, isDir: true, data: new Uint8Array(0) });
      const children = await fs.promises.readdir(diskPath, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const ch of children) await walk(path.join(diskPath, ch.name), `${relPath}/${ch.name}`);
    } else {
      const buf = await fs.promises.readFile(diskPath);
      entries.push({ path: relPath, isDir: false, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) });
    }
  }
  for (const p of inputPaths) await walk(path.resolve(p), path.basename(p));

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = encoder.encode(e.path);
    const crc = e.isDir ? 0 : crc32(e.data);
    let comp = e.data;
    let method = 0;
    if (!e.isDir && e.data.byteLength > 0) {
      const deflated = await runStream(new CompressionStream('deflate-raw'), e.data);
      if (deflated.byteLength < e.data.byteLength) { comp = deflated; method = 8; }
    }
    const lfh = new Uint8Array(30 + nameBytes.byteLength);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.byteLength, true);
    lv.setUint32(22, e.data.byteLength, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    lfh.set(nameBytes, 30);

    const cdh = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.byteLength, true);
    cv.setUint32(24, e.data.byteLength, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint32(38, e.isDir ? 0x10 : 0, true);
    cv.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);

    localParts.push(lfh, comp);
    centralParts.push(cdh);
    offset += lfh.byteLength + comp.byteLength;
  }

  let cdSize = 0;
  for (const c of centralParts) cdSize += c.byteLength;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centralParts.length, true);
  ev.setUint16(10, centralParts.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, eocd]) { out.set(p, pos); pos += p.byteLength; }
  await fs.promises.writeFile(outputPath, out);
  return entries.length;
}

export class ArchiveActions {
  constructor({ state, model }) {
    this.state = state;
    this.model = model;
    this.lastOpenedInArchives = null;
  }

  async openInArchives(item) {
    if (!item || !item.path) return false;
    this.lastOpenedInArchives = item.path;
    const ok = await openApp('helm.archives', [item.path]);
    if (!ok) toast('Archive Manager (helm.archives) could not be launched', { error: true });
    return ok;
  }

  async extractHere(item) {
    if (!item || !item.path) return null;
    const parentDir = path.dirname(item.path);
    const destDir = path.join(parentDir, archiveStem(item.path));
    try {
      const buf = await fs.promises.readFile(item.path);
      const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const lower = item.name.toLowerCase();
      if (lower.endsWith('.zip') || (u8[0] === 0x50 && u8[1] === 0x4b)) {
        await extractZipBuffer(u8, destDir);
      } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.gz') || (u8[0] === 0x1f && u8[1] === 0x8b)) {
        const tarBytes = await runStream(new DecompressionStream('gzip'), u8);
        await extractTarBuffer(tarBytes, destDir);
      } else {
        await extractTarBuffer(u8, destDir);
      }
      await this.model.reload({ select: destDir });
      toast(`Extracted to ${path.basename(destDir)}`);
      return destDir;
    } catch (err) {
      toast(`Extract failed: ${err.message}`, { error: true });
      throw err;
    }
  }

  async compressToZip(items, { archiveName = null } = {}) {
    if (!items || !items.length || !this.state.currentPath) return null;
    let name = archiveName;
    if (!name) {
      const defaultStem = items.length === 1
        ? items[0].name.replace(/\.[^.]+$/, '') || items[0].name
        : path.basename(this.state.currentPath) || 'Archive';
      const defaultName = `${defaultStem}.zip`;
      name = await promptDialog({
        title: 'Compress to .zip',
        value: defaultName,
        ok: 'Compress',
        selectStem: true,
        validate: (v) => (v.includes('/') || v.includes('\\') ? 'Name cannot contain slashes' : ''),
      });
      if (!name) return null;
    }
    if (!name.toLowerCase().endsWith('.zip')) name += '.zip';
    const outPath = path.join(this.state.currentPath, name);
    try {
      const count = await buildZipFromPaths(outPath, items.map((it) => it.path));
      await this.model.reload({ select: outPath });
      toast(`Compressed ${formatCount(count, 'item')} into ${name}`);
      return outPath;
    } catch (err) {
      toast(`Compression failed: ${err.message}`, { error: true });
      throw err;
    }
  }
}
