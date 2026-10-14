/**
 * Pure in-process archive reader & writer for .zip, .tar, and .tar.gz (.tgz, .gz).
 * Uses web-standard CompressionStream / DecompressionStream ('deflate-raw' & 'gzip'),
 * IEEE 802.3 CRC-32, and POSIX ustar TAR formatting with zero external CLI tools.
 */

const fs = require('fs');
const path = require('path');

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

// ---- CRC-32 -----------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- Stream compression helpers ---------------------------------------------

function concatChunks(chunks, totalLen) {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function runTransformStream(stream, inputBytes) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;

  const writePromise = (async () => {
    if (inputBytes && inputBytes.byteLength > 0) {
      await writer.write(inputBytes);
    }
    await writer.close();
  })();

  const readPromise = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
        chunks.push(u8);
        total += u8.byteLength;
      }
    }
  })();

  await Promise.all([writePromise, readPromise]);
  return concatChunks(chunks, total);
}

export function compressBytes(bytes, format = 'deflate-raw') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  return runTransformStream(new CompressionStream(format), u8);
}

export function decompressBytes(bytes, format = 'deflate-raw') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (u8.byteLength === 0) return Promise.resolve(new Uint8Array(0));
  return runTransformStream(new DecompressionStream(format), u8);
}

// ---- Path normalization & Zip Slip protection -------------------------------

export function detectFormat(filePath = '', bytes = null) {
  if (bytes && bytes.length >= 4) {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
      return 'zip';
    }
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      return 'tar.gz';
    }
    if (bytes.length >= 263 && bytes[257] === 0x75 && bytes[258] === 0x73 && bytes[259] === 0x74 && bytes[260] === 0x61 && bytes[261] === 0x72) {
      return 'tar';
    }
  }
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.gz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  return 'zip';
}

export function isUnsafeArchivePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return true;
  if (/^[/\\]/.test(rawPath)) return true;
  if (/^[a-zA-Z]:/.test(rawPath)) return true;
  const norm = rawPath.replace(/\\/g, '/');
  const parts = norm.split('/');
  for (const part of parts) {
    if (part === '..') return true;
  }
  return false;
}

/**
 * Validates that entryPath stays strictly within destDir.
 * Throws an Error on any Zip Slip attempt (../, leading /, Windows drive letter).
 */
export function validateEntryPath(entryPath, destDir) {
  if (isUnsafeArchivePath(entryPath)) {
    throw new Error(`Unsafe archive entry path rejected (Zip Slip): "${entryPath}"`);
  }
  const cleanRel = entryPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!cleanRel || isUnsafeArchivePath(cleanRel)) {
    throw new Error(`Unsafe archive entry path rejected (Zip Slip): "${entryPath}"`);
  }
  const resolvedDest = path.resolve(destDir);
  const resolvedTarget = path.resolve(resolvedDest, ...cleanRel.split('/'));
  const prefix = resolvedDest.endsWith(path.sep) ? resolvedDest : resolvedDest + path.sep;
  if (resolvedTarget !== resolvedDest && !resolvedTarget.startsWith(prefix)) {
    throw new Error(`Unsafe archive entry path escapes destination: "${entryPath}"`);
  }
  return resolvedTarget;
}

function cleanEntryRelPath(rawPath) {
  const s = String(rawPath || '').replace(/\\/g, '/');
  if (isUnsafeArchivePath(s)) return s.replace(/\/+$/, '');
  return s.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
}

function splitParentAndName(entryPath) {
  const idx = entryPath.lastIndexOf('/');
  if (idx < 0) return { parentPath: '', name: entryPath };
  return { parentPath: entryPath.slice(0, idx), name: entryPath.slice(idx + 1) };
}

// ---- DOS date/time helpers for ZIP ------------------------------------------

function msToDosDateTime(ms) {
  const d = new Date(ms || Date.now());
  const year = Math.max(1980, d.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { dosDate, dosTime };
}

function dosDateTimeToMs(dosDate, dosTime) {
  if (!dosDate && !dosTime) return Date.now();
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = Math.max(1, (dosDate >> 5) & 0x0f) - 1;
  const day = Math.max(1, dosDate & 0x1f);
  const hours = (dosTime >> 11) & 0x1f;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * 2;
  return new Date(year, month, day, hours, minutes, seconds).getTime();
}

// ---- ZIP parser & builder ---------------------------------------------------

function findZipEocd(bytes) {
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      return i;
    }
  }
  return -1;
}

export function parseZip(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = findZipEocd(u8);
  if (eocd < 0) throw new Error('Invalid ZIP archive: End of Central Directory not found');

  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries = [];
  let pos = cdOffset;
  const end = Math.min(u8.byteLength, cdOffset + cdSize);

  while (pos + 46 <= end) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x02014b50) break;
    const methodNum = view.getUint16(pos + 10, true);
    const dosTime = view.getUint16(pos + 12, true);
    const dosDate = view.getUint16(pos + 14, true);
    const crc = view.getUint32(pos + 16, true);
    const packedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const extAttr = view.getUint32(pos + 38, true);
    const localOffset = view.getUint32(pos + 42, true);

    const rawName = decoder.decode(u8.subarray(pos + 46, pos + 46 + nameLen));
    const isDirectory = rawName.endsWith('/') || ((extAttr & 0x10) !== 0 && size === 0);
    const entryPath = cleanEntryRelPath(rawName);
    const { parentPath, name } = splitParentAndName(entryPath);

    let dataOffset = localOffset + 30 + nameLen;
    if (localOffset + 30 <= u8.byteLength && view.getUint32(localOffset, true) === 0x04034b50) {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    }

    if (entryPath) {
      entries.push({
        path: entryPath,
        rawPath: rawName,
        name: name || entryPath,
        nameLower: (name || entryPath).toLowerCase(),
        parentPath,
        isDirectory,
        size: isDirectory ? 0 : size,
        packedSize: isDirectory ? 0 : packedSize,
        ratio: size > 0 ? packedSize / size : 1,
        mtimeMs: dosDateTimeToMs(dosDate, dosTime),
        crc32: crc,
        offset: localOffset,
        dataOffset,
        method: isDirectory ? 'dir' : (methodNum === 8 ? 'deflate' : 'store'),
        methodNum,
        synthetic: false,
      });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

export async function buildZip(rawEntries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const bulkFast = rawEntries.length > 250;

  for (const item of rawEntries) {
    const isDir = !!item.isDirectory;
    let relPath = String(item.path || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (isDir && !relPath.endsWith('/')) relPath += '/';
    if (!isDir) relPath = relPath.replace(/\/+$/, '');
    const nameBytes = encoder.encode(relPath);
    const { dosDate, dosTime } = msToDosDateTime(item.mtimeMs || Date.now());

    let rawData = item.data instanceof Uint8Array
      ? item.data
      : (typeof item.data === 'string' ? encoder.encode(item.data) : new Uint8Array(item.data || 0));
    if (isDir) rawData = new Uint8Array(0);

    let compressedData;
    let methodNum = 0;
    let crc = 0;
    let uncompSize = rawData.byteLength;

    if (item.compressedData instanceof Uint8Array && item.crc32 != null && item.size != null) {
      compressedData = item.compressedData;
      methodNum = item.methodNum != null ? item.methodNum : (item.method === 'deflate' ? 8 : 0);
      crc = item.crc32 >>> 0;
      uncompSize = item.size >>> 0;
    } else if (isDir || uncompSize === 0) {
      compressedData = new Uint8Array(0);
      methodNum = 0;
      crc = 0;
    } else {
      crc = crc32(rawData);
      const shouldTryDeflate = item.compress !== false && (!bulkFast || uncompSize >= 64);
      if (shouldTryDeflate) {
        const deflated = await compressBytes(rawData, 'deflate-raw');
        if (deflated.byteLength < uncompSize || item.forceDeflate) {
          compressedData = deflated;
          methodNum = 8;
        } else {
          compressedData = rawData;
          methodNum = 0;
        }
      } else {
        compressedData = rawData;
        methodNum = 0;
      }
    }

    const compSize = compressedData.byteLength;

    const lfh = new Uint8Array(30 + nameBytes.byteLength);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, methodNum, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compSize, true);
    lv.setUint32(22, uncompSize, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    lv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    const cdh = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, methodNum, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compSize, true);
    cv.setUint32(24, uncompSize, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, isDir ? 0x10 : 0, true);
    cv.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);

    localParts.push(lfh, compressedData);
    centralParts.push(cdh);
    offset += lfh.byteLength + compSize;
  }

  let cdSize = 0;
  for (const c of centralParts) cdSize += c.byteLength;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  const count16 = Math.min(0xffff, centralParts.length);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, count16, true);
  ev.setUint16(10, count16, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return concatChunks([...localParts, ...centralParts, eocd], offset + cdSize + 22);
}

// ---- TAR parser & builder (POSIX ustar) -------------------------------------

function readTarString(u8, offset, length) {
  let end = offset;
  const max = offset + length;
  while (end < max && u8[end] !== 0) end++;
  return decoder.decode(u8.subarray(offset, end));
}

function readTarOctal(u8, offset, length) {
  const s = readTarString(u8, offset, length).trim();
  return s ? parseInt(s, 8) || 0 : 0;
}

function writeTarString(u8, offset, length, str) {
  const bytes = encoder.encode(str);
  u8.set(bytes.subarray(0, Math.min(length, bytes.byteLength)), offset);
}

function writeTarOctal(u8, offset, length, val) {
  const digits = length - 1;
  const oct = Math.max(0, Math.floor(val || 0)).toString(8).padStart(digits, '0');
  writeTarString(u8, offset, digits, oct.slice(-digits));
  u8[offset + digits] = 0;
}

function isZeroBlock(u8, offset) {
  for (let i = 0; i < 512; i++) {
    if (u8[offset + i] !== 0) return false;
  }
  return true;
}

export function parseTar(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = [];
  let pos = 0;
  let nextLongName = null;

  while (pos + 512 <= u8.byteLength) {
    if (isZeroBlock(u8, pos)) break;

    const name = readTarString(u8, pos, 100);
    const size = readTarOctal(u8, pos + 124, 12);
    const mtimeSec = readTarOctal(u8, pos + 136, 12);
    const typeFlagCode = u8[pos + 156];
    const typeFlag = typeFlagCode ? String.fromCharCode(typeFlagCode) : '0';
    const magic = readTarString(u8, pos + 257, 6);
    const prefix = magic.startsWith('ustar') ? readTarString(u8, pos + 345, 155) : '';

    const dataOffset = pos + 512;
    const paddedSize = Math.ceil(size / 512) * 512;

    if (typeFlag === 'L') {
      nextLongName = readTarString(u8, dataOffset, size);
      pos = dataOffset + paddedSize;
      continue;
    }
    if (typeFlag === 'x' || typeFlag === 'g') {
      pos = dataOffset + paddedSize;
      continue;
    }

    const rawName = nextLongName || (prefix ? `${prefix}/${name}` : name);
    nextLongName = null;
    const isDirectory = typeFlag === '5' || rawName.endsWith('/');
    const entryPath = cleanEntryRelPath(rawName);
    const { parentPath, name: baseName } = splitParentAndName(entryPath);

    if (entryPath) {
      const dataSlice = isDirectory ? new Uint8Array(0) : u8.subarray(dataOffset, Math.min(u8.byteLength, dataOffset + size));
      entries.push({
        path: entryPath,
        rawPath: rawName,
        name: baseName || entryPath,
        nameLower: (baseName || entryPath).toLowerCase(),
        parentPath,
        isDirectory,
        size: isDirectory ? 0 : size,
        packedSize: isDirectory ? 0 : size,
        ratio: 1,
        mtimeMs: mtimeSec ? mtimeSec * 1000 : Date.now(),
        crc32: isDirectory ? 0 : crc32(dataSlice),
        offset: pos,
        dataOffset,
        method: isDirectory ? 'dir' : 'ustar',
        synthetic: false,
      });
    }

    pos = dataOffset + paddedSize;
  }

  return entries;
}

export function buildTar(rawEntries) {
  const chunks = [];
  let totalLen = 0;

  for (const item of rawEntries) {
    const isDir = !!item.isDirectory;
    let relPath = String(item.path || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '');
    if (isDir && !relPath.endsWith('/')) relPath += '/';
    if (!isDir) relPath = relPath.replace(/\/+$/, '');

    const rawData = isDir
      ? new Uint8Array(0)
      : (item.data instanceof Uint8Array
        ? item.data
        : (typeof item.data === 'string' ? encoder.encode(item.data) : new Uint8Array(item.data || 0)));

    const header = new Uint8Array(512);
    let namePart = relPath;
    let prefixPart = '';
    if (encoder.encode(relPath).byteLength > 100) {
      const slash = relPath.lastIndexOf('/', 154);
      if (slash > 0) {
        prefixPart = relPath.slice(0, slash);
        namePart = relPath.slice(slash + 1);
      }
    }

    writeTarString(header, 0, 100, namePart);
    writeTarOctal(header, 100, 8, isDir ? 0o755 : 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, rawData.byteLength);
    writeTarOctal(header, 136, 12, Math.floor((item.mtimeMs || Date.now()) / 1000));
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    header[156] = isDir ? 0x35 : 0x30; // '5' or '0'
    writeTarString(header, 257, 6, 'ustar');
    header[263] = 0x30;
    header[264] = 0x30;
    if (prefixPart) writeTarString(header, 345, 155, prefixPart);

    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    const chkOct = sum.toString(8).padStart(6, '0');
    writeTarString(header, 148, 6, chkOct);
    header[154] = 0;
    header[155] = 0x20;

    chunks.push(header);
    totalLen += 512;

    if (rawData.byteLength > 0) {
      chunks.push(rawData);
      totalLen += rawData.byteLength;
      const rem = rawData.byteLength % 512;
      if (rem !== 0) {
        const pad = new Uint8Array(512 - rem);
        chunks.push(pad);
        totalLen += pad.byteLength;
      }
    }
  }

  const eof = new Uint8Array(1024);
  chunks.push(eof);
  totalLen += 1024;
  return concatChunks(chunks, totalLen);
}

// ---- Synthesizing implicit parent folders & rollup --------------------------

function finalizeEntries(parsedEntries, format, gzPackedSize = null) {
  const byPath = new Map();
  const ordered = [];

  const ensureParentDirs = (parentPath, mtimeMs) => {
    if (!parentPath || isUnsafeArchivePath(parentPath)) return;
    const parts = parentPath.split('/');
    let cur = '';
    for (const part of parts) {
      if (!part) continue;
      const prev = cur;
      cur = cur ? `${cur}/${part}` : part;
      if (!byPath.has(cur)) {
        const syn = {
          path: cur,
          rawPath: `${cur}/`,
          name: part,
          nameLower: part.toLowerCase(),
          parentPath: prev,
          isDirectory: true,
          size: 0,
          packedSize: 0,
          ratio: 1,
          mtimeMs: mtimeMs || Date.now(),
          crc32: 0,
          offset: 0,
          dataOffset: 0,
          method: 'dir',
          synthetic: true,
        };
        byPath.set(cur, syn);
        ordered.push(syn);
      }
    }
  };

  for (const e of parsedEntries) {
    ensureParentDirs(e.parentPath, e.mtimeMs);
    byPath.set(e.path, e);
    ordered.push(e);
  }

  // Deduplicate if an explicit directory appeared after a synthetic one
  const finalEntries = [];
  const seen = new Set();
  for (const e of ordered) {
    const latest = byPath.get(e.path);
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    finalEntries.push(latest);
  }

  let totalSize = 0;
  let totalPackedSize = 0;
  let fileCount = 0;
  let dirCount = 0;

  for (const e of finalEntries) {
    if (e.isDirectory) {
      dirCount++;
    } else {
      fileCount++;
      totalSize += e.size || 0;
      totalPackedSize += e.packedSize || 0;
    }
  }

  if (format === 'tar.gz' && gzPackedSize != null && totalSize > 0) {
    const overallRatio = gzPackedSize / totalSize;
    totalPackedSize = gzPackedSize;
    for (const e of finalEntries) {
      if (!e.isDirectory) {
        e.packedSize = Math.round(e.size * overallRatio);
        e.ratio = overallRatio;
        e.method = 'gzip';
      }
    }
  }

  return { entries: finalEntries, totalSize, totalPackedSize, fileCount, dirCount };
}

// ---- Public high-level codec API --------------------------------------------

export async function readArchive(archivePathOrBytes, opts = {}) {
  let rawBytes;
  let filePath = opts.filePath || '';
  if (typeof archivePathOrBytes === 'string') {
    filePath = archivePathOrBytes;
    const buf = await fs.promises.readFile(archivePathOrBytes);
    rawBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } else if (archivePathOrBytes instanceof Uint8Array) {
    rawBytes = archivePathOrBytes;
  } else if (archivePathOrBytes && archivePathOrBytes.rawBytes instanceof Uint8Array) {
    return archivePathOrBytes;
  } else {
    throw new Error('readArchive requires a file path or Uint8Array');
  }

  const format = opts.format || detectFormat(filePath, rawBytes);
  let parsed = [];
  let containerBytes = rawBytes;

  if (format === 'zip') {
    parsed = parseZip(rawBytes);
  } else if (format === 'tar') {
    parsed = parseTar(rawBytes);
  } else if (format === 'tar.gz') {
    const decompressed = await decompressBytes(rawBytes, 'gzip');
    containerBytes = decompressed;
    parsed = parseTar(decompressed);
    if (parsed.length === 0 && decompressed.byteLength > 0) {
      const base = path.basename(filePath || 'file.gz').replace(/\.(tar\.gz|tgz|gz)$/i, '') || 'data';
      parsed = [{
        path: base,
        rawPath: base,
        name: base,
        parentPath: '',
        isDirectory: false,
        size: decompressed.byteLength,
        packedSize: rawBytes.byteLength,
        ratio: rawBytes.byteLength / decompressed.byteLength,
        mtimeMs: Date.now(),
        crc32: crc32(decompressed),
        offset: 0,
        dataOffset: 0,
        method: 'gzip',
        synthetic: false,
      }];
    }
  } else {
    throw new Error(`Unsupported archive format: ${format}`);
  }

  if (parsed.length > 300 && typeof requestAnimationFrame === 'function') {
    await new Promise((r) => requestAnimationFrame(r));
  }

  const summary = finalizeEntries(parsed, format, format === 'tar.gz' ? rawBytes.byteLength : null);
  return {
    format,
    filePath,
    ...summary,
    rawBytes,
    containerBytes,
  };
}

export const listArchive = readArchive;

export async function readEntry(archiveOrPath, entryOrPath) {
  const archive = (archiveOrPath && archiveOrPath.entries && archiveOrPath.containerBytes)
    ? archiveOrPath
    : await readArchive(archiveOrPath);

  const entry = typeof entryOrPath === 'string'
    ? archive.entries.find((e) => e.path === cleanEntryRelPath(entryOrPath) || e.rawPath === entryOrPath)
    : entryOrPath;

  if (!entry) throw new Error(`Entry not found in archive: ${typeof entryOrPath === 'string' ? entryOrPath : (entryOrPath && entryOrPath.path)}`);
  if (entry.isDirectory) return new Uint8Array(0);

  if (archive.format === 'zip') {
    const start = entry.dataOffset;
    const slice = archive.rawBytes.subarray(start, start + entry.packedSize);
    if (entry.method === 'deflate' || entry.methodNum === 8) {
      return decompressBytes(slice, 'deflate-raw');
    }
    return new Uint8Array(slice);
  }

  // tar or tar.gz (containerBytes is already decompressed tar bytes)
  const start = entry.dataOffset;
  return new Uint8Array(archive.containerBytes.subarray(start, start + entry.size));
}

export async function extractEntries(archiveOrPath, destDir, opts = {}) {
  const archive = await readArchive(archiveOrPath);
  let targetEntries = archive.entries;

  if (opts.entries && opts.entries.length > 0) {
    const wantedSet = new Set();
    const wantedPrefixes = [];
    for (const item of opts.entries) {
      const p = typeof item === 'string' ? item : item.path;
      const clean = cleanEntryRelPath(p);
      wantedSet.add(clean);
      wantedSet.add(p);
      wantedPrefixes.push(`${clean}/`);
    }
    targetEntries = archive.entries.filter((e) =>
      wantedSet.has(e.path) ||
      wantedSet.has(e.rawPath) ||
      wantedPrefixes.some((pref) => e.path.startsWith(pref))
    );
  }

  // Strict pass 1: validate EVERY entry path against Zip Slip before writing any byte
  const plan = [];
  for (const entry of targetEntries) {
    const checkPath = entry.rawPath || entry.path;
    let relPath = checkPath;
    if (opts.stripPrefix && !isUnsafeArchivePath(relPath) && relPath.startsWith(opts.stripPrefix)) {
      relPath = relPath.slice(opts.stripPrefix.length).replace(/^\/+/, '');
    }
    if (!relPath) continue;
    const outPath = validateEntryPath(relPath, destDir);
    plan.push({ entry, outPath });
  }

  await fs.promises.mkdir(destDir, { recursive: true });
  const extractedPaths = [];

  for (let i = 0; i < plan.length; i++) {
    const { entry, outPath } = plan[i];
    if (entry.isDirectory) {
      await fs.promises.mkdir(outPath, { recursive: true });
    } else {
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      const data = await readEntry(archive, entry);
      await fs.promises.writeFile(outPath, data);
      extractedPaths.push(outPath);
    }
    if (opts.onProgress) opts.onProgress(i + 1, plan.length, entry);
  }

  return { extractedCount: extractedPaths.length, extractedPaths, destDir };
}

async function collectDiskInputs(inputPaths, { baseDir = '', targetDir = '' } = {}) {
  const collected = [];
  const prefix = targetDir ? String(targetDir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';

  async function walk(diskPath, relArchivePath) {
    const st = await fs.promises.stat(diskPath);
    const mtimeMs = st.mtimeMs || Date.now();
    if (st.isDirectory()) {
      collected.push({ path: relArchivePath, isDirectory: true, data: new Uint8Array(0), mtimeMs });
      const children = await fs.promises.readdir(diskPath, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const ch of children) {
        await walk(path.join(diskPath, ch.name), `${relArchivePath}/${ch.name}`);
      }
    } else {
      const buf = await fs.promises.readFile(diskPath);
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      collected.push({ path: relArchivePath, isDirectory: false, data, mtimeMs });
    }
  }

  for (const p of inputPaths) {
    const resolved = path.resolve(p);
    let rel = baseDir ? path.relative(path.resolve(baseDir), resolved).replace(/\\/g, '/') : path.basename(resolved);
    if (prefix) rel = `${prefix}/${rel}`;
    await walk(resolved, rel);
  }
  return collected;
}

export async function encodeArchiveEntries(rawEntries, format = 'zip') {
  if (format === 'zip') return buildZip(rawEntries);
  if (format === 'tar') return buildTar(rawEntries);
  if (format === 'tar.gz') {
    const tarBytes = buildTar(rawEntries);
    return compressBytes(tarBytes, 'gzip');
  }
  throw new Error(`Unsupported archive format: ${format}`);
}

export async function writeArchiveEntries(outputPath, rawEntries, opts = {}) {
  const format = opts.format || detectFormat(outputPath);
  const bytes = await encodeArchiveEntries(rawEntries, format);
  await fs.promises.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await fs.promises.writeFile(tmpPath, bytes);
  await fs.promises.rename(tmpPath, outputPath);
  return { format, outputPath, entryCount: rawEntries.length, byteLength: bytes.byteLength };
}

export async function createArchive(outputPath, inputPaths, opts = {}) {
  const format = opts.format || detectFormat(outputPath);
  const rawEntries = await collectDiskInputs(inputPaths, opts);
  return writeArchiveEntries(outputPath, rawEntries, { format });
}

export async function addEntriesToArchive(archivePath, inputPaths, opts = {}) {
  const archive = await readArchive(archivePath);
  const newItems = await collectDiskInputs(inputPaths, opts);
  const newPaths = new Set(newItems.map((it) => cleanEntryRelPath(it.path)));

  const kept = [];
  for (const e of archive.entries) {
    if (e.synthetic || newPaths.has(e.path)) continue;
    if (archive.format === 'zip' && !e.isDirectory) {
      const compSlice = archive.rawBytes.subarray(e.dataOffset, e.dataOffset + e.packedSize);
      kept.push({
        path: e.path,
        isDirectory: false,
        compressedData: new Uint8Array(compSlice),
        crc32: e.crc32,
        size: e.size,
        methodNum: e.methodNum,
        mtimeMs: e.mtimeMs,
      });
    } else {
      const data = e.isDirectory ? new Uint8Array(0) : await readEntry(archive, e);
      kept.push({ path: e.path, isDirectory: e.isDirectory, data, mtimeMs: e.mtimeMs });
    }
  }

  return writeArchiveEntries(archivePath, [...kept, ...newItems], { format: archive.format });
}

export async function deleteEntriesFromArchive(archivePath, entryPaths) {
  const archive = await readArchive(archivePath);
  const removeExact = new Set();
  const removePrefixes = [];

  for (const item of entryPaths || []) {
    const p = cleanEntryRelPath(typeof item === 'string' ? item : item.path);
    if (!p) continue;
    removeExact.add(p);
    removePrefixes.push(`${p}/`);
  }

  const kept = [];
  for (const e of archive.entries) {
    if (e.synthetic) continue;
    if (removeExact.has(e.path) || removePrefixes.some((pref) => e.path.startsWith(pref))) continue;
    if (archive.format === 'zip' && !e.isDirectory) {
      const compSlice = archive.rawBytes.subarray(e.dataOffset, e.dataOffset + e.packedSize);
      kept.push({
        path: e.path,
        isDirectory: false,
        compressedData: new Uint8Array(compSlice),
        crc32: e.crc32,
        size: e.size,
        methodNum: e.methodNum,
        mtimeMs: e.mtimeMs,
      });
    } else {
      const data = e.isDirectory ? new Uint8Array(0) : await readEntry(archive, e);
      kept.push({ path: e.path, isDirectory: e.isDirectory, data, mtimeMs: e.mtimeMs });
    }
  }

  return writeArchiveEntries(archivePath, kept, { format: archive.format });
}
