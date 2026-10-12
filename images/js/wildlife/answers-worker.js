/**
 * Her answers on disk, off the page thread (answers.js is the page's half).
 *
 *   { id, op: 'load', file }  -> { id, records, error? }
 *        every record of the answers file ([] when there is none). A file
 *        that does not parse is never written over: it is kept beside as
 *        `<file>.unreadable-<time>` and the answers start empty (error says so).
 *   { id, op: 'ids', paths, index } -> { id, ids: { path: key | null } }
 *        each photo's file key (fileKey below), from the path index when the
 *        file's size and mtime are what the index has, else read and hashed
 *        (and the index written back). A path that cannot be read is null.
 *   { id, op: 'save', file, records } -> { id }
 *        the whole answers file, written to a temporary file, flushed, and
 *        renamed over the old one, so a crash leaves the old file or the new.
 *   { id, op: 'exLoad' | 'exSave', ... }
 *        her examples' index and embeddings (examples.js; below).
 *
 * A file's key is its identity across moves, renames, copies and new
 * analysis: "<size>:<32 hex>", the hex the start of the SHA-256 of its first
 * 64 KiB and its last 64 KiB (the whole file when it is smaller). Two files
 * share a key only when they share their size and both ends.
 */

const fs = require('fs');
const path = require('path');

const END = 64 * 1024;
let index = null;          // { file, entries: { [path]: { size, mtimeMs, key } } }

/** The bytes a file's key is made of: its first and last 64 KiB. */
function ends(p, size) {
  const fd = fs.openSync(p, 'r');
  try {
    if (size <= 2 * END) {
      const all = new Uint8Array(size);
      let got = 0;
      while (got < size) {
        const n = fs.readSync(fd, all, got, size - got, got);
        if (!n) break;
        got += n;
      }
      return all.subarray(0, got);
    }
    const buf = new Uint8Array(2 * END);
    let got = fs.readSync(fd, buf, 0, END, 0);
    got += fs.readSync(fd, buf, got, END, size - END);
    return buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

async function fileKey(p, size) {
  const digest = await crypto.subtle.digest('SHA-256', ends(p, size));
  const hex = Array.from(new Uint8Array(digest).subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${size}:${hex}`;
}

/** Write `text` to `file` through a temporary file and a rename. */
function writeDurably(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${Date.now().toString(36)}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    // On the disk before the rename, so a crash leaves the old file or the new one whole.
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function load(m) {
  let text;
  try { text = String(fs.readFileSync(m.file, 'utf-8')); } catch (_) { return { id: m.id, records: [] }; }
  try {
    const doc = JSON.parse(text);
    const records = Array.isArray(doc) ? doc : doc && Array.isArray(doc.answers) ? doc.answers : null;
    if (!records) throw new Error('no answers list');
    return { id: m.id, records: records.filter((r) => r && typeof r.key === 'string' && r.answer) };
  } catch (err) {
    const aside = `${m.file}.unreadable-${Date.now()}`;
    try { fs.renameSync(m.file, aside); } catch (_) { /* left where it is; nothing writes until a save */ }
    return { id: m.id, records: [], error: `${path.basename(m.file)} could not be read (${err.message}); kept as ${path.basename(aside)}` };
  }
}

function readIndex(file) {
  if (index && index.file === file) return index;
  let entries = {};
  try {
    const doc = JSON.parse(String(fs.readFileSync(file, 'utf-8')));
    if (doc && doc.entries && typeof doc.entries === 'object') entries = doc.entries;
  } catch (_) { entries = {}; }
  index = { file, entries };
  return index;
}

async function ids(m) {
  const ix = readIndex(m.index);
  const out = {};
  let changed = false;
  for (const p of m.paths) {
    let st;
    try { st = fs.statSync(p); } catch (_) { out[p] = null; continue; }
    const mtimeMs = Math.round(st.mtimeMs);
    const have = ix.entries[p];
    if (have && have.size === st.size && have.mtimeMs === mtimeMs && have.key) { out[p] = have.key; continue; }
    try {
      const key = await fileKey(p, st.size);
      ix.entries[p] = { size: st.size, mtimeMs, key };
      out[p] = key;
      changed = true;
    } catch (_) {
      out[p] = null;
    }
  }
  if (changed) {
    try { writeDurably(ix.file, JSON.stringify({ version: 1, entries: ix.entries })); } catch (err) {
      console.warn(`answers: writing the path index: ${err.message}`);
    }
  }
  return { id: m.id, ids: out };
}

function save(m) {
  writeDurably(m.file, `${JSON.stringify(m.doc, null, 1)}\n`);
  return { id: m.id };
}

// ---- her examples (examples.js) ----------------------------------------------------

/**
 * { op: 'exLoad', file } -> { entries, rows }: the examples index and its
 * embeddings (one Float32Array; entry i's at entries[i].off, entries[i].dim
 * floats). An index whose rows file is missing or short loads empty.
 */
function exLoad(m) {
  let doc;
  try { doc = JSON.parse(String(fs.readFileSync(m.file, 'utf-8'))); } catch (_) { return { id: m.id, entries: [], rows: new Float32Array(0) }; }
  const entries = doc && Array.isArray(doc.entries) ? doc.entries : [];
  let bytes;
  try { bytes = fs.readFileSync(path.join(path.dirname(m.file), String(doc.rows || ''))); } catch (_) { bytes = null; }
  if (!bytes) return { id: m.id, entries: [], rows: new Float32Array(0) };
  const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows = new Float32Array(Math.floor(u8.byteLength / 4));
  new Uint8Array(rows.buffer).set(u8.subarray(0, rows.length * 4));
  const ok = entries.filter((e) => e && typeof e.key === 'string' && e.off >= 0 && e.dim > 0 && e.off + e.dim <= rows.length);
  return { id: m.id, entries: ok, rows };
}

/**
 * { op: 'exSave', file, entries, rows } -> {}: the rows to a new file of
 * their own (`examples-<time>.f32`), then the index naming it, then the old
 * rows file removed: a crash anywhere leaves an index and the rows it names.
 */
function exSave(m) {
  const dir = path.dirname(m.file);
  fs.mkdirSync(dir, { recursive: true });
  let old = '';
  try { old = String(JSON.parse(String(fs.readFileSync(m.file, 'utf-8'))).rows || ''); } catch (_) { old = ''; }
  const name = `examples-${Date.now().toString(36)}.f32`;
  const rows = m.rows instanceof Float32Array ? m.rows : new Float32Array(m.rows || 0);
  const fd = fs.openSync(path.join(dir, name), 'w');
  try {
    fs.writeSync(fd, new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  writeDurably(m.file, `${JSON.stringify({ format: 'helm.images.examples', version: 1, rows: name, entries: m.entries })}\n`);
  if (old && old !== name && !old.includes('/') && !old.includes('\\')) {
    try { fs.unlinkSync(path.join(dir, old)); } catch (_) { /* gone already */ }
  }
  return { id: m.id };
}

// load and save run as they arrive, in order (synchronous), so a save never
// waits behind a folder being hashed; ids answers when its hashes are done.
self.onmessage = async (e) => {
  const m = e.data || {};
  let reply;
  try {
    if (m.op === 'load') reply = load(m);
    else if (m.op === 'ids') reply = await ids(m);
    else if (m.op === 'save') reply = save(m);
    else if (m.op === 'exLoad') reply = exLoad(m);
    else if (m.op === 'exSave') reply = exSave(m);
    else reply = { id: m.id, error: `unknown op ${m.op}` };
  } catch (err) {
    reply = { id: m.id, error: String((err && err.message) || err) };
  }
  self.postMessage(reply);
};
