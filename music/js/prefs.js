/**
 * Library folders: which folders the library is built from. The Music
 * folder by default; others are added with the native folder picker. A
 * change rescans (only the files that changed are read again).
 *
 *   libraryRoots(settings)              the folders, absolute
 *   await editFolders(settings)         the dialog; true when the list changed
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { Dialog } from '/lib/dialog.js';
import { userDirs, homeDir } from '/lib/files.js';

const path = require('path');

/** The library's folders: the `folders` setting, or the Music folder when it was never set. */
export function libraryRoots(settings) {
  const saved = settings.get('folders');
  const list = Array.isArray(saved) ? saved : [userDirs().music];
  const out = [];
  for (const p of list) {
    if (typeof p !== 'string' || !p) continue;
    const abs = path.resolve(p);
    // A folder inside another one on the list is already covered by it.
    if (!out.includes(abs)) out.push(abs);
  }
  return out.filter((p) => !out.some((q) => q !== p && p.startsWith(q.endsWith(path.sep) ? q : q + path.sep)));
}

export async function editFolders(settings) {
  const before = libraryRoots(settings);
  let folders = before.slice();
  const d = new Dialog({ title: 'Library Folders', icon: 'folder', wide: true });
  const list = h('div.mu-folders');
  const draw = () => {
    list.replaceChildren(...(folders.length ? folders.map((f) => h('div.mu-folder-row',
      icon('folder'),
      h('div.mu-folder-text', h('div.ellipsis', path.basename(f) || f), h('div.dim.ellipsis.mu-folder-path', f)),
      h('button.icon-btn.small', { 'data-tip': 'Remove from the library', 'aria-label': `Remove ${f}`,
        onclick: () => { folders = folders.filter((x) => x !== f); draw(); } }, icon('x'))))
      : [h('div.dim.mu-folders-empty', 'No folders: the library is empty.')]));
  };
  draw();
  const add = h('button.btn', {
    onclick: () => {
      if (typeof showOpenFolderDialog !== 'function') return;
      const picked = showOpenFolderDialog(folders[0] || homeDir(), false);
      for (const p of picked || []) if (p && !folders.includes(p)) folders.push(p);
      draw();
    },
  }, icon('folder-plus'), 'Add Folder…');
  d.body.append(
    h('p.dim', 'Music finds songs in these folders and everything inside them, and keeps up as files change.'),
    list,
    h('div', add));
  d.addButton('Cancel', { value: false });
  d.addButton('Save', { primary: true, value: true });
  const ok = await d.open();
  if (!ok) return false;
  const same = folders.length === before.length && folders.every((f, i) => f === before[i]);
  if (!same) settings.set('folders', folders);
  return !same;
}
