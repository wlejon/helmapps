/**
 * Find Animals' records on disk, off the page thread: one JSONL file per
 * folder in the app's cache dir (records.js cacheFile), one line per photo,
 * appended as photos finish (the last line for a path wins). A listing's
 * path finds its record by pathKey (forward slashes; no case on Windows).
 *
 *   { id, op: 'scan', file, paths, config }
 *     -> { id, entries: [{ path, key, mtimeMs, rec }] }  every path's key now
 *        (size:mtime), and its record when one was made for that key and
 *        config (else rec null: the photo is new, changed, or the settings
 *        changed). Paths that cannot be stat'ed (gone) are left out. A file
 *        holding many lines no longer used is rewritten with only the current
 *        records (through a temporary file and a rename).
 *   { id, op: 'append', file, recs } -> { id }
 *   { id, op: 'embLoad', file, want, config } / { id, op: 'embAppend', file, entries }:
 *     the folder's crop embeddings (below)
 */

import { pathKey } from './records.js';

const fs = require('fs');
const path = require('path');

function readLines(file) {
  const out = new Map();
  let text = '';
  try { text = String(fs.readFileSync(file, 'utf-8')); } catch (_) { return { out, lines: 0 }; }
  let lines = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    lines++;
    try {
      const o = JSON.parse(line);
      if (o && typeof o.path === 'string') out.set(pathKey(o.path), o);
    } catch (_) { /* a torn line from an interrupted write */ }
  }
  return { out, lines };
}

function scan(m) {
  const { out: old, lines } = readLines(m.file);
  const entries = [];
  const keep = [];
  for (const p of m.paths) {
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    const mtimeMs = Math.round(st.mtimeMs);
    const key = `${st.size}:${mtimeMs}`;
    const prev = old.get(pathKey(p));
    const rec = prev && prev.key === key && prev.config === m.config ? prev : null;
    if (rec) keep.push(rec);
    entries.push({ path: p, key, mtimeMs, rec });
  }
  if (lines > keep.length * 1.5 + 16) {
    try {
      fs.mkdirSync(path.dirname(m.file), { recursive: true });
      fs.writeFileSync(`${m.file}.tmp`, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''), 'utf-8');
      fs.renameSync(`${m.file}.tmp`, m.file);
    } catch (err) { console.warn(`wildlife: compacting ${m.file}: ${err.message}`); }
  }
  return { id: m.id, entries };
}

function append(m) {
  fs.mkdirSync(path.dirname(m.file), { recursive: true });
  // A torn last line from an interrupted write must not swallow the next one.
  let lead = '';
  try {
    const st = fs.statSync(m.file);
    if (st.size > 0) {
      const fd = fs.openSync(m.file, 'r');
      const last = new Uint8Array(1);
      fs.readSync(fd, last, 0, 1, st.size - 1);
      fs.closeSync(fd);
      if (last[0] !== 10) lead = '\n';
    }
  } catch (_) { /* a new file */ }
  fs.appendFileSync(m.file, lead + m.recs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  return { id: m.id };
}

// ---- crop embeddings ------------------------------------------------------------------
//
// One binary file per folder beside its records (records.js embeddingsFile),
// appended as photos finish, the last entry for a path winning. An entry:
// 'EMB1', a u32 (little-endian) header length, the header (UTF-8 JSON
// { path, key, config, n, dim }), zeros to a multiple of 4, then n * dim
// float32 (little-endian): animal i's embedding at i * dim. A torn entry at
// the end (an interrupted write) ends the read.

const MAGIC = [69, 77, 66, 49];   // 'EMB1'

function readEmbeddings(file) {
  const out = new Map();
  let buf;
  try { buf = fs.readFileSync(file); } catch (_) { return { out, entries: 0 }; }
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let at = 0, entries = 0;
  const dec = new TextDecoder();
  while (at + 8 <= u8.length) {
    if (MAGIC.some((c, i) => u8[at + i] !== c)) break;
    const hl = dv.getUint32(at + 4, true);
    if (at + 8 + hl > u8.length) break;
    let head;
    try { head = JSON.parse(dec.decode(u8.subarray(at + 8, at + 8 + hl))); } catch (_) { break; }
    const start = at + 8 + Math.ceil(hl / 4) * 4;
    const bytes = (head.n | 0) * (head.dim | 0) * 4;
    if (start + bytes > u8.length) break;
    // Little-endian hosts only (x86-64, arm64): the bytes are the floats.
    const rows = new Float32Array(u8.buffer.slice(u8.byteOffset + start, u8.byteOffset + start + bytes));
    out.set(pathKey(head.path), { path: head.path, key: head.key, config: head.config, dim: head.dim, rows });
    entries++;
    at = start + bytes;
  }
  return { out, entries };
}

function encodeEntry(e) {
  const head = new TextEncoder().encode(JSON.stringify({ path: e.path, key: e.key, config: e.config,
    n: e.dim ? e.rows.length / e.dim : 0, dim: e.dim }));
  const pad = Math.ceil(head.length / 4) * 4;
  const out = new Uint8Array(8 + pad + e.rows.length * 4);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(4, head.length, true);
  out.set(head, 8);
  const rows = e.rows instanceof Float32Array ? e.rows : Float32Array.from(e.rows);
  out.set(new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength), 8 + pad);
  return out;
}

function writeEntries(file, list, flag) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, flag);
  try { for (const e of list) fs.writeSync(fd, encodeEntry(e)); } finally { fs.closeSync(fd); }
}

/**
 * { file, want: [{ path, key }], config } -> { entries: [{ path, dim, rows }] }: the embeddings
 * made for each path's key and config. A file holding many entries no longer used is rewritten.
 */
function embLoad(m) {
  const { out, entries } = readEmbeddings(m.file);
  const found = [];
  for (const w of m.want) {
    const e = out.get(pathKey(w.path));
    if (e && e.key === w.key && e.config === m.config) found.push(e);
  }
  if (entries > found.length * 1.5 + 16) {
    try {
      writeEntries(`${m.file}.tmp`, found, 'w');
      fs.renameSync(`${m.file}.tmp`, m.file);
    } catch (err) { console.warn(`wildlife: compacting ${m.file}: ${err.message}`); }
  }
  return { id: m.id, entries: found.map((e) => ({ path: e.path, dim: e.dim, rows: e.rows })) };
}

/** { file, entries: [{ path, key, config, dim, rows }] } -> {} */
function embAppend(m) {
  writeEntries(m.file, m.entries, 'a');
  return { id: m.id };
}

self.onmessage = (e) => {
  const m = e.data || {};
  let reply;
  try {
    if (m.op === 'scan') reply = scan(m);
    else if (m.op === 'append') reply = append(m);
    else if (m.op === 'embLoad') reply = embLoad(m);
    else if (m.op === 'embAppend') reply = embAppend(m);
    else reply = { id: m.id, error: `unknown op ${m.op}` };
  } catch (err) {
    reply = { id: m.id, error: String((err && err.message) || err) };
  }
  self.postMessage(reply);
};
