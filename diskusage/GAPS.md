# Gaps

## path.relative is missing
- **Where:** brokit `path` module (`require('path')`)
- **Expected:** `path.relative('/a/b', '/a/b/c')` → `'c'` (Node)
- **Actual:** `TypeError: undefined is not a function`
- **Repro:** `bro-headless diskusage -e "require('path').relative('/a','/a/b')"`
- **Impact:** the old JS scanner could not map a path into its tree.
- **Belongs in:** brokit. **Fixed** (brokit `src/api/js/path.js`).

## Scanning a drive froze the window
- **Where:** brokit `fs`, brovfs
- **Expected:** a whole drive is counted with the window live.
- **Actual:** `fs.promises` ran on the page's thread, and a JS walk of a
  million entries could not keep a frame under 16 ms however it was sliced.
  Windows showed "Not Responding" while `C:\` was scanned.
- **Belongs in:** brokit / brovfs. **Fixed:** `fs.promises` is real async
  in brokit, and `bro.vfs.usage` (brovfs) scans on its own threads and
  hands the page one folder at a time; see `../docs/performance.md`.

## Windows roots were mangled by `path`
- **Where:** brokit `path`
- **Actual:** `path.normalize('C:/')` was `'C:'`, and
  `path.basename('C:\\')` was `'C:'`.
- **Belongs in:** brokit. **Fixed** (with tests in `tests/js/test_path.js`).

Kit-level gaps (opening another app by id off Linux) are in `../GAPS.md`.
