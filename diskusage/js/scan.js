/**
 * The scanner: walk a folder tree with brokit's async fs and total the size
 * of every folder. Symlinks are counted as themselves, never followed, so a
 * link cycle cannot loop and nothing is counted twice.
 *
 *   const root = await scanTree('/home/j', { showHidden: false, onProgress, signal });
 *   root = { name, path, isDir: true, size, files, dirs, children: [...], error? }
 */

const fs = require('fs');
const path = require('path');

/** A token a new scan uses to stop the old one. */
export class ScanSignal {
  constructor() { this.cancelled = false; }
  cancel() { this.cancelled = true; }
}

/**
 * @param {string} root
 * @param {object} [o]
 * @param {boolean} [o.showHidden]   count dot files and folders
 * @param {(p: {files: number, bytes: number, current: string}) => void} [o.onProgress]
 * @param {ScanSignal} [o.signal]
 * @returns {Promise<object|null>} the tree, or null when cancelled
 */
export async function scanTree(root, { showHidden = false, onProgress, signal } = {}) {
  const progress = { files: 0, bytes: 0, current: root, lastReport: 0 };
  const report = (force) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - progress.lastReport < 100) return;
    progress.lastReport = now;
    onProgress({ files: progress.files, bytes: progress.bytes, current: progress.current });
  };

  async function walk(dirPath, name, parent) {
    const node = { name, path: dirPath, isDir: true, size: 0, files: 0, dirs: 0, children: [], parent };
    if (signal && signal.cancelled) return node;
    progress.current = dirPath;
    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      node.error = err && err.code ? err.code : String(err);
      return node;
    }
    const files = [];
    const dirs = [];
    for (const d of entries) {
      if (!showHidden && d.name.startsWith('.')) continue;
      if (d.isDirectory() && !d.isSymbolicLink()) dirs.push(d.name);
      else files.push(d.name);
    }
    // Sizes of the files here, a batch at a time.
    for (let i = 0; i < files.length; i += 64) {
      if (signal && signal.cancelled) return node;
      const batch = files.slice(i, i + 64);
      const stats = await Promise.all(batch.map((f) => fs.promises.lstat(path.join(dirPath, f)).catch(() => null)));
      batch.forEach((f, j) => {
        const s = stats[j];
        const size = s ? s.size : 0;
        node.children.push({ name: f, path: path.join(dirPath, f), isDir: false, size, files: 1, dirs: 0,
          mtime: s ? s.mtimeMs : 0, parent: node });
        node.size += size;
        node.files += 1;
        progress.files += 1;
        progress.bytes += size;
      });
      report(false);
    }
    for (const d of dirs) {
      if (signal && signal.cancelled) return node;
      const child = await walk(path.join(dirPath, d), d, node);
      node.children.push(child);
      node.size += child.size;
      node.files += child.files;
      node.dirs += 1 + child.dirs;
    }
    return node;
  }

  const tree = await walk(root, path.basename(root) || root, null);
  report(true);
  return signal && signal.cancelled ? null : tree;
}

/** Take a node out of its tree and subtract it from every ancestor's totals. */
export function detach(node) {
  const parent = node.parent;
  if (!parent) return;
  parent.children = parent.children.filter((c) => c !== node);
  for (let p = parent; p; p = p.parent) {
    p.size -= node.size;
    p.files -= node.files;
    p.dirs -= node.isDir ? 1 + node.dirs : 0;
  }
}

/** The node at an absolute path under root, or null. */
export function findNode(root, p) {
  if (!root) return null;
  if (root.path === p) return root;
  const rel = path.relative(root.path, p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  let node = root;
  for (const part of rel.split(path.sep)) {
    node = (node.children || []).find((c) => c.name === part);
    if (!node) return null;
  }
  return node;
}
