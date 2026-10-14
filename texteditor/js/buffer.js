/**
 * Document buffer model and safe disk I/O for Text Editor.
 *
 * Handles:
 *  - UTF-8 and UTF-8 with BOM detection and preservation
 *  - Line ending (LF / CRLF) detection, normalization for <textarea>, and restoration on save
 *  - Binary / non-UTF-8 detection (NUL byte in first 64 KB or fatal UTF-8 decode error)
 *  - Atomic file saving via temporary file + rename in the target directory
 */

const fs = require('fs');
const path = require('path');

export const LARGE_FILE_BYTES = 20 * 1024 * 1024;
const BINARY_CHECK_BYTES = 65536;

let nextDocId = 1;

export class DocBuffer {
  constructor({
    id = nextDocId++,
    filePath = '',
    title = '',
    text = '',
    savedText = '',
    eol = 'LF',
    bom = false,
    readOnly = false,
    binary = false,
    dirty = false,
  } = {}) {
    this.id = id;
    if (id >= nextDocId) nextDocId = id + 1;
    this.path = filePath ? path.resolve(filePath) : '';
    this.title = title || (this.path ? path.basename(this.path) : 'Untitled');
    this.text = text;
    this.savedText = savedText;
    this.eol = eol === 'CRLF' ? 'CRLF' : 'LF';
    this.bom = !!bom;
    this.readOnly = !!readOnly;
    this.binary = !!binary;
    this.dirty = !!dirty;
    this.deletedOnDisk = false;
    this.externalChanged = false;
    this.caret = { start: 0, end: 0, line: 1, col: 1 };
    this.lineCount = countLines(this.text);
    this.selfWriteUntil = 0;
  }

  get encoding() {
    return this.bom ? 'UTF-8 with BOM' : 'UTF-8';
  }

  get encodingLabel() {
    return this.bom ? 'UTF-8 BOM' : 'UTF-8';
  }

  setText(newText, { markDirty = true } = {}) {
    const normalized = newText.indexOf('\r') >= 0 ? newText.replace(/\r\n?/g, '\n') : newText;
    this.text = normalized;
    this.lineCount = countLines(normalized);
    if (markDirty) {
      this.dirty = normalized !== this.savedText;
    } else {
      this.savedText = normalized;
      this.dirty = false;
    }
  }
}

/** Fast line count using native C++ split. */
export function countLines(text) {
  if (!text) return 1;
  return text.split('\n').length;
}

/** Compute 1-based { line, col } for a character offset in `text`. */
export function lineColAt(text, offset) {
  const limit = Math.max(0, Math.min(offset, text.length));
  if (limit === 0) return { line: 1, col: 1 };
  const parts = text.slice(0, limit).split('\n');
  return {
    line: parts.length,
    col: parts[parts.length - 1].length + 1,
  };
}

/** Compute character offset of the start of 1-based `targetLine`. */
export function offsetOfLine(text, targetLine) {
  const line = Math.max(1, Math.floor(Number(targetLine) || 1));
  if (line <= 1) return 0;
  const parts = text.split('\n');
  const maxIdx = Math.min(line - 1, parts.length);
  let offset = 0;
  for (let i = 0; i < maxIdx; i++) {
    offset += parts[i].length + 1;
  }
  return Math.min(offset, text.length);
}

/**
 * Inspect raw file bytes for UTF-8 BOM, CRLF vs LF line endings, and binary/invalid UTF-8.
 */
export function decodeBufferBytes(rawBytes) {
  const bytes = rawBytes instanceof Uint8Array
    ? rawBytes
    : new Uint8Array(rawBytes || new ArrayBuffer(0));

  let bom = false;
  let body = bytes;
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    bom = true;
    body = bytes.subarray(3);
  }

  const checkSlice = body.subarray(0, Math.min(body.length, BINARY_CHECK_BYTES));
  let binary = typeof checkSlice.includes === 'function'
    ? checkSlice.includes(0)
    : false;
  if (!binary && typeof checkSlice.includes !== 'function') {
    for (let i = 0; i < checkSlice.length; i++) {
      if (checkSlice[i] === 0x00) { binary = true; break; }
    }
  }

  let rawText = '';
  if (!binary) {
    try {
      rawText = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (_) {
      binary = true;
    }
  }
  if (binary) {
    rawText = new TextDecoder('utf-8', { fatal: false }).decode(body);
    // Replace NUL characters with replacement char for safe textarea display
    if (rawText.indexOf('\0') !== -1) {
      rawText = rawText.replace(/\0/g, '\uFFFD');
    }
  }

  const hasCRLF = rawText.indexOf('\r\n') !== -1;
  const eol = hasCRLF ? 'CRLF' : 'LF';
  const text = rawText.indexOf('\r') !== -1 ? rawText.replace(/\r\n?/g, '\n') : rawText;

  return {
    text,
    eol,
    bom,
    binary,
    readOnly: binary,
  };
}

/**
 * Encode a document's normalized text back into raw bytes with its EOL and BOM.
 */
export function encodeBufferBytes(doc) {
  const outText = doc.eol === 'CRLF' ? doc.text.replace(/\n/g, '\r\n') : doc.text;
  const body = new TextEncoder().encode(outText);
  if (!doc.bom) return body;
  const withBom = new Uint8Array(body.length + 3);
  withBom[0] = 0xEF;
  withBom[1] = 0xBB;
  withBom[2] = 0xBF;
  withBom.set(body, 3);
  return withBom;
}

/**
 * Read a file from disk into a new or existing DocBuffer.
 */
export async function readBufferFromDisk(filePath, existingDoc = null) {
  const resolved = path.resolve(filePath);
  const raw = await fs.promises.readFile(resolved);
  const decoded = decodeBufferBytes(raw);
  if (existingDoc) {
    existingDoc.path = resolved;
    existingDoc.title = path.basename(resolved);
    existingDoc.eol = decoded.eol;
    existingDoc.bom = decoded.bom;
    existingDoc.binary = decoded.binary;
    existingDoc.readOnly = decoded.readOnly;
    existingDoc.deletedOnDisk = false;
    existingDoc.externalChanged = false;
    existingDoc.setText(decoded.text, { markDirty: false });
    return existingDoc;
  }
  return new DocBuffer({
    filePath: resolved,
    title: path.basename(resolved),
    text: decoded.text,
    savedText: decoded.text,
    eol: decoded.eol,
    bom: decoded.bom,
    binary: decoded.binary,
    readOnly: decoded.readOnly,
    dirty: false,
  });
}

/**
 * Atomically write a DocBuffer to `targetPath` by writing a temp file in the
 * same folder and renaming over the target.
 */
export async function writeBufferToDisk(doc, targetPath) {
  const resolved = path.resolve(targetPath || doc.path);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved);
  const tmpName = `.~${base}.${process.pid}.${Date.now()}.tmp`;
  const tmpPath = path.join(dir, tmpName);
  const bytes = encodeBufferBytes(doc);

  doc.selfWriteUntil = Date.now() + 1500;
  await fs.promises.mkdir(dir, { recursive: true });

  let wroteTemp = false;
  try {
    await fs.promises.writeFile(tmpPath, bytes);
    wroteTemp = true;
    await fs.promises.rename(tmpPath, resolved);
  } catch (_) {
    if (wroteTemp) {
      try { await fs.promises.unlink(tmpPath); } catch {}
    }
    await fs.promises.writeFile(resolved, bytes);
  }

  doc.selfWriteUntil = Date.now() + 1500;
  doc.path = resolved;
  doc.title = base;
  doc.savedText = doc.text;
  doc.dirty = false;
  doc.deletedOnDisk = false;
  doc.externalChanged = false;
  return resolved;
}
