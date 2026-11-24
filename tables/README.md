# Tables (`helm.tables`)

Zero-copy `.brotable`, Apache Parquet, and CSV/TSV columnar workbench powered by `bro.table` and `brass` JIT/SIMD queries.

- Opens `.brotable` (single tables and multi-table 4096B-aligned bundles, via `mmap` when uncompressed), `.parquet` (PLAIN + Dictionary, LZ4/Snappy), `.csv`, and `.tsv`.
- Live predicate filtering, sorting, `groupBy` aggregations, query `explain()` telemetry, and interactive column profiling charts.
- Exports views or opened tables to compressed `.brotable` v4, LZ4 `.parquet`, or `.csv`.
