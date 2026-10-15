# Gaps found building `helm.files`

None remaining.

## Resolved
- Pointer-based item drag-and-drop (`enableItemDrag`) has been lifted into `/lib/list.js` with `.drag-ghost` and `.drop-target` in `/lib/css/overlays.css`, and adopted in `files/js/views.js`.
- `VirtualList` (`/lib/list.js`) now builds `.list-header` whenever `columns` are provided regardless of initial `layout`, toggles `.list-header` visibility on `setLayout()`, and uses `columns` in `'list'` mode even when `render` is also supplied for `'grid'` mode.
- `Commands.attach` (`/lib/commands.js`) now listens for `copy`, `cut`, and `paste` DOM events and dispatches commands bound to `Mod+C`, `Mod+X`, and `Mod+V` when focus is not inside an editable text field.
- `fs.utimesSync` and `fs.promises.utimes` are now implemented in `brokit` `fs` (adopted in `files/tests/test_navigation.js`).
- `bro.vfs.watch` event shape (`kind`, `watch`, `path`, `oldPath`) is documented in `bro/docs/vfs-api.js`.
- `bro.vfs.scan` path separators and `isHidden` handling on Windows are normalized in `brovfs`.
