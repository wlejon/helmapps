# Gaps

## path.relative is missing
- **Where:** brokit `path` module (`require('path')`)
- **Expected:** `path.relative('/a/b', '/a/b/c')` → `'c'` (Node)
- **Actual:** `TypeError: undefined is not a function`
- **Repro:** `bro-headless diskusage -e "require('path').relative('/a','/a/b')"`
- **Impact:** `findNode` (js/scan.js) could not map a path into the tree.
- **Belongs in:** brokit. **Fixed** (brokit `src/api/js/path.js`).

Kit-level gaps (opening another app by id off Linux) are in `../GAPS.md`.
