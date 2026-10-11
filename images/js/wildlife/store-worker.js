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

self.onmessage = (e) => {
  const m = e.data || {};
  let reply;
  try {
    if (m.op === 'scan') reply = scan(m);
    else if (m.op === 'append') reply = append(m);
    else reply = { id: m.id, error: `unknown op ${m.op}` };
  } catch (err) {
    reply = { id: m.id, error: String((err && err.message) || err) };
  }
  self.postMessage(reply);
};
