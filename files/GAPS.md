# Gaps found building `helm.files`

## Kit lacks item drag-and-drop between views and sidebar
- **Where:** `helmapps/lib` (`VirtualList` and `Sidebar`)
- **Expected:** A shared pointer drag-and-drop helper in `/lib` for dragging selected items from a `VirtualList` onto folder targets in the view or `Sidebar` sections.
- **Actual:** `VirtualList` only implements `dragToReorder` for vertical/horizontal single-list reordering.
- **Impact:** Implemented pointer-based item drag-and-drop with ghost preview and drop-target highlighting in `files/js/views.js`.
- **Belongs in:** kit

## `VirtualList` only creates `.list-header` when initial `layout === 'list'`
- **Where:** `helmapps/lib/list.js` constructor (line 132)
- **Expected:** Passing `columns` to `new VirtualList({ layout: 'grid', columns: [...] })` and later calling `list.setLayout('list')` should show the column header.
- **Actual:** `this.header` is only created if `this.layout === 'list'` at construction time, and `fill()` only renders `this.o.columns` when `this.o.render` is null/falsy.
- **Impact:** Constructed `VirtualList` with `layout: 'list'` first so `this.header` is built, and toggled `list.o.render` when switching between `'grid'` and `'list'` in `files/js/views.js`.
- **Belongs in:** kit

## `Mod+C` / `Mod+X` / `Mod+V` dispatch `copy` / `cut` / `paste` rather than `keydown`
- **Where:** `bro` input handling & `helmapps/lib/commands.js`
- **Expected:** Commands registered with `keys: ['Mod+C']`, `['Mod+X']`, `['Mod+V']` via `Commands.attach(window)` fire on `Ctrl+C` / `Ctrl+X` / `Ctrl+V`.
- **Actual:** `bro` intercepts `Ctrl+C`, `Ctrl+X`, and `Ctrl+V` at the host level and dispatches `copy`, `cut`, and `paste` DOM events rather than `keydown`.
- **Repro:** `bro-headless files -e "window.addEventListener('keydown', e => console.log(e.key)); keyDown(99, 6, 0x40);"`
- **Impact:** Added `copy`, `cut`, and `paste` event listeners on `window` in `files/js/main.js` that invoke the corresponding commands when not typing in an input.
- **Belongs in:** kit (`lib/commands.js`)

## `fs.utimesSync` / `fs.promises.utimes` is missing
- **Where:** brokit `fs` module (`require('fs')`)
- **Expected:** `fs.utimesSync(path, atime, mtime)` sets file timestamps as in Node.
- **Actual:** `TypeError: undefined is not a function`
- **Repro:** `bro-headless files -e "require('fs').utimesSync"`
- **Impact:** Used staggered file writes in `tests/test_navigation.js` to produce distinct modification times.
- **Belongs in:** brokit

## `bro.vfs.watch` event shape uses `kind` rather than `type`
- **Where:** `bro/docs/vfs-api.js` section 5
- **Expected:** `docs/vfs-api.js` shows `ev.type` on watch events.
- **Actual:** `bro.vfs.watch` delivers arrays of event objects with `{ kind, watch, path, oldPath }`.
- **Impact:** Handled in `files/js/model.js`.
- **Belongs in:** docs

## `bro.vfs.scan` `kind` and path separators on Windows
- **Where:** `bro.vfs.scan` (`brovfs`)
- **Expected:** Normalized platform separators in `entry.path`.
- **Actual:** On Windows, `bro.vfs.scan('D:/path')` joins the directory and entry name with `\\` (`D:/path\\name`) and sets `entry.isHidden` from the Windows file attribute only (dot-files without the attribute have `isHidden: false`).
- **Impact:** Normalized entry paths with `path.join(dirPath, it.name)` and combined `it.isHidden || isHidden(it.name)` in `files/js/model.js`.
- **Belongs in:** brovfs
