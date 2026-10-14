# Engine and Kit Gaps

None found. `CompressionStream('deflate-raw')`, `DecompressionStream('deflate-raw')`, `CompressionStream('gzip')`, and `DecompressionStream('gzip')` are all provided in-process by `bro` via `miniz`, enabling full `.zip`, `.tar`, and `.tar.gz` reading and writing without external tools.
