# Files (`helm.files`)

The file manager for **helm**. Browse folders in an icon grid with lazy thumbnails or a sortable list view, watch folders live as files change on disk, search recursively, and copy, move, rename, or trash files with undo.

## Running

```bash
# Headless boot check (from helmapps/)
../bro/build/Release/bro-headless.exe files -e "0"

# Run all acceptance and performance tests
bash scripts/run_tests.sh files
```

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Back / Forward / Enclosing Folder | `Alt+Left` / `Alt+Right` / `Alt+Up` |
| Enter Location | `Mod+L` |
| Search / Filter | `Mod+F` (`Enter` for recursive search, `Escape` to clear) |
| Show Hidden Files | `Mod+H` |
| Grid View / List View | `Mod+1` / `Mod+2` |
| New Folder | `Mod+Shift+N` |
| Rename | `F2` |
| Copy / Cut / Paste / Duplicate | `Mod+C` / `Mod+X` / `Mod+V` / `Mod+D` |
| Copy Path | `Mod+Shift+C` |
| Select All | `Mod+A` |
| Move to Trash / Delete Permanently | `Delete` / `Shift+Delete` |
| Undo / Redo | `Mod+Z` / `Mod+Shift+Z` |
| Properties | `Alt+Enter` |
| Refresh | `F5` / `Mod+R` |
| Bookmark This Folder | `Mod+B` |
| New Window / Close Window | `Mod+N` / `Mod+W` |
