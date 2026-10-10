# Brief: Files

| | |
|---|---|
| Folder | `helmapps/files/` |
| id | `helm.files` |
| Replaces | Dolphin, Nautilus, Explorer |
| Size | about 4000 lines, the largest Wave 1 app |
| Permissions | none (`bro.vfs`, `bro.apps`, `bro.thumb` are not privileged) |

## What it is

The file manager. It browses folders as icons or a detailed list with
thumbnails, opens files with the right app, and copies, moves, renames and
trashes them with undo. Every other app sends people here ("Show in Files"),
so it must be solid.

## Read first

- `../AGENTS.md`, `../lib/README.md`, all of `../diskusage/`
- `../bro/docs/vfs-api.js`: scan, copy, move, remove, trash, undo/redo, watch, getMime, listVolumes
- `../bro/docs/thumb-api.js`: thumbnails (`get` returns pixels; draw them into a canvas or an `<img>`)
- `../bro/docs/apps-api.js`: default apps, "Open With", recent files
- `../bro/docs/brokit-api.js`: `fs`, `path`, `os`
- `../bro/docs/file-api.js`: dropped files (`dataTransfer.files`)
- The clipboard is the web one, `navigator.clipboard.writeText` / `readText`
  (bro has no page for it yet; diskusage's Copy Path uses it)

## Window

```
┌ toolbar: ← → ↑ │ breadcrumbs ............ │ search │ grid/list │ ⋯ ┐
├ sidebar ─────┬ content ─────────────────────────────────────────────┤
│ PLACES       │  [icon grid or list with Name / Size / Modified / Kind]│
│ Home         │                                                        │
│ Desktop      │                                                        │
│ Documents …  │                                                        │
│ Trash        │                                                        │
│ DRIVES       │                                                        │
│ BOOKMARKS    │                                                        │
├──────────────┴────────────────────────────────────────────────────────┤
│ status: 12 items, 3 selected (4.2 MB)                    free: 120 GB │
└───────────────────────────────────────────────────────────────────────┘
```

## Must have

1. **Browse.** Open a folder from the sidebar, the breadcrumbs, a typed
   path (Mod+L turns the breadcrumbs into a path field), or the command
   line (`bro files ~/Pictures`). Back, Forward and Up, with history.
   Folders sort first. Hidden files toggle with Mod+H and persist.
2. **Two views.** A grid (`VirtualList` grid, icon size from a slider, 48 to
   256) and a list (Name, Size, Modified, Kind; sortable columns), toggled
   with a `Segmented` control. The view and sort are remembered per folder
   (settings `json` map, capped at 500 entries).
3. **Thumbnails** in the grid for images (and for anything `bro.thumb`
   supports), loaded lazily for the cells on screen and cached in memory.
   Without `bro.thumb`, use the file-kind icon.
4. **Live updates.** A `bro.vfs.watch` on the open folder: files created,
   deleted or renamed elsewhere appear and disappear without a refresh.
5. **Open.** Double-click or Enter opens a folder in place, and a file with
   its default app (`openFile` from `lib/files.js`). "Open With" in the
   context menu lists `appsFor(mime)`.
6. **File operations**, all through `bro.vfs` so they are undoable:
   - New Folder (Mod+Shift+N, a prompt, then select it)
   - Rename (F2, `promptDialog` with `selectStem: true`)
   - Copy / Cut / Paste (Mod+C / X / V). Keep an in-app clipboard of paths
     and also write the paths as text to `navigator.clipboard`.
   - Duplicate (Mod+D)
   - Move to Trash (Delete), then a toast with Undo
   - Delete permanently (Shift+Delete), after a `confirmDialog` with danger
   - Undo / Redo (Mod+Z / Mod+Shift+Z), through `bro.vfs.undo/redo`
   - Name conflicts on paste ask Replace / Keep Both / Skip, with an "apply
     to all" checkbox
   - Long operations (over about 300 ms) show progress in the status bar
     and can be cancelled if the API allows it
7. **Drag and drop.** Drag items onto a folder in the view or the sidebar
   to move them (Ctrl to copy). Files dropped from another app are copied
   in. The kit has no item drag-and-drop, so build it in the app and file a
   kit gap.
8. **Trash.** The Trash place lists `bro.vfs.listTrash()` with the original
   location and deletion date, and offers Restore and Empty Trash (confirm).
9. **Sidebar.** Places (the user dirs that exist), Drives
   (`bro.vfs.listVolumes()`, with free space in the tooltip), and
   Bookmarks (drop a folder on the sidebar or use Mod+B; persisted; remove
   from the context menu).
10. **Search.** Typing in the search field (Mod+F) filters the current
    folder by name, fuzzy is fine. Enter searches recursively below it,
    asynchronously, cancellable, with results streamed into the list. A
    simple recursive walk with `fs.promises` is fine. If `bro.search` is
    present, its walker may be used.
11. **Properties** (Alt+Enter). A dialog with name, kind, MIME, size (a
    folder's computed asynchronously), location, modified time, and a
    thumbnail.
12. **Status bar.** Item count, selection count and size, and free space on
    the volume.
13. **Single instance.** `"singleInstance": true`. A launch with a path
    while running opens that path (`app.onLaunch`). "New Window" (Mod+N)
    uses `app.newWindow()`.
14. **Show in Files.** `bro files /path/to/file` opens the containing
    folder with that file selected.

## Commands and shortcuts

| Command | Keys |
|---|---|
| Back / Forward / Up | Alt+Left / Alt+Right / Alt+Up |
| Location bar | Mod+L |
| Search | Mod+F |
| Toggle hidden | Mod+H |
| Grid / List | Mod+1 / Mod+2 |
| New Folder | Mod+Shift+N |
| Rename | F2 |
| Copy / Cut / Paste / Duplicate | Mod+C / Mod+X / Mod+V / Mod+D |
| Select all | Mod+A |
| Move to Trash / Delete | Delete / Shift+Delete |
| Undo / Redo | Mod+Z / Mod+Shift+Z |
| Properties | Alt+Enter |
| Refresh | F5 |
| Bookmark this folder | Mod+B |
| New Window / Close Window | Mod+N / Mod+W |

## Settings

`view` (grid|list), `iconSize`, `showHidden`, `sortByFolder` (json map),
`bookmarks` (json list), `lastFolder`.

## Missing APIs

- No `bro.vfs`: browse and open with `fs` only. The file-operation commands
  are disabled, with a tooltip saying why. No watching.
- No `bro.thumb`: icons only.
- No `bro.apps`: Open (default app) and Open With are disabled. Folders
  still open.

## Known gaps to expect

- Opening another bro app by id is Linux-only (see `../GAPS.md`).
- The kit has no item drag-and-drop or tree view.

## Acceptance tests

All on `fixtureDir()` trees. Never on real user folders.

1. Opening a fixture lists its entries, folders first, and the status bar
   counts them.
2. Grid and list views both show the same items, and switching keeps the
   selection.
3. Sorting by Size and by Modified in the list view orders correctly, and
   reopening the folder restores that sort.
4. Double-click into a subfolder, then Back, Forward and Up, with the
   breadcrumbs right at each step.
5. New Folder creates it on disk and selects it. Rename changes it on disk
   and an invalid name (`a/b`) is refused.
6. Copy then Paste into another folder: the file exists in both. Cut then
   Paste: it moved. Paste onto an existing name asks, and Keep Both makes
   `name (2).ext`.
7. Undo after a move puts the file back (where `bro.vfs` exists).
8. A file created on disk by the test appears in the view without a
   refresh, and one deleted disappears.
9. Filtering by typing narrows the list, and Escape clears it.
10. Hidden files: hidden by default, shown after Mod+H, and the setting
    persists across a restart of the test app.
11. Delete permanently asks first, and Cancel keeps the file. Do not test
    Move to Trash on a real trash; test it only with Cancel, or skip it.
12. Launching with a file path argument opens its folder with it selected.
13. The app boots and browses with `bro.vfs` treated as missing (stub
    `api` by running the test with a flag your app reads, e.g.
    `app.expose({ disableVfs })`), and the operation commands are
    disabled.

## Not in this pass

Tabs, split view, a tree sidebar, network locations (smb, sftp), archive
browsing, the portal file chooser mode (helm will later ask Files to act as
the system file picker), batch rename, tags, previews of text and PDFs.
