// The scanner on its own: totals, hidden files, symlinks not followed,
// detach() keeping the ancestors' totals right.

import { fixtureDir, eq } from '/lib/test.js';
import { scanTree, detach, findNode } from '/app/js/scan.js';

const fs = require('fs');
const path = require('path');

const dir = fixtureDir({
  'a.bin': new Uint8Array(1000),
  'sub/b.bin': new Uint8Array(3000),
  'sub/deep/c.bin': new Uint8Array(500),
  '.hidden/d.bin': new Uint8Array(7000),
  '.e.bin': new Uint8Array(20),
  'empty/': null,
});

let tree = null;
scanTree(dir, { showHidden: false }).then((t) => { tree = t; });
const end = Date.now() + 10000;
while (!tree && Date.now() < end) { advanceTime(16); wallSleep(5); }
assert(tree, 'the scan finished');

eq(tree.size, 4500, 'total without hidden files');
eq(tree.files, 3, 'file count without hidden files');
eq(tree.dirs, 3, 'folders: sub, sub/deep, empty');
const sub = findNode(tree, path.join(dir, 'sub'));
eq(sub && sub.size, 3500, 'sub totals its subtree');
eq(findNode(tree, path.join(dir, 'empty')).size, 0, 'an empty folder is 0 bytes');

let all = null;
scanTree(dir, { showHidden: true }).then((t) => { all = t; });
while (!all && Date.now() < end) { advanceTime(16); wallSleep(5); }
eq(all.size, 11520, 'hidden files count when asked');

// A symlink to a folder is counted as a link, not walked.
let linked = false;
try {
  fs.symlinkSync(path.join(dir, 'sub'), path.join(dir, 'link-to-sub'), 'dir');
  linked = true;
} catch (_) { /* Windows without developer mode: no symlinks */ }
if (linked) {
  let t2 = null;
  scanTree(dir, {}).then((t) => { t2 = t; });
  while (!t2 && Date.now() < end) { advanceTime(16); wallSleep(5); }
  const link = findNode(t2, path.join(dir, 'link-to-sub'));
  assert(link && !link.isDir, 'the link is a leaf');
  assert(t2.size < 4500 + 3500, 'the link\'s target is not counted twice');
}

// detach() takes a node out and fixes every ancestor.
const deep = findNode(tree, path.join(dir, 'sub', 'deep'));
detach(deep);
eq(sub.size, 3000, 'sub lost deep\'s bytes');
eq(tree.size, 4000, 'the root lost them too');
eq(tree.dirs, 2, 'and one folder');

console.log('test_scan PASSED');
