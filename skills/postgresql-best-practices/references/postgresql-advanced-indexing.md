---
title: "PostgreSQL Advanced Indexing"
description: "B-tree, GIN, GiST, BRIN, partial, and expression index strategies for PostgreSQL"
tags: [postgresql, indexing, performance, gin, gist, brin]
---

# Advanced Indexing Strategy

## Version History

| Version | Feature | Notes |
|---|---|---|
| All supported versions | B-tree, GIN, GiST, BRIN, partial indexes, expression indexes | Core indexing toolbox |
| PG 11 | `INCLUDE` columns | Covering indexes for index-only scans |
| PG 11 | Parallel `CREATE INDEX` improvements | Controlled by `max_parallel_maintenance_workers` |
| PG 12 | `REINDEX CONCURRENTLY` | Safer rebuild path for production |
| PG 13 | B-tree deduplication | Helps duplicate-heavy non-unique B-tree indexes |

## Parameter Correctness

| Item | Correct meaning | Why it matters |
|---|---|---|
| B-tree | Equality, range, ordering | Default choice for scalar predicates |
| GIN | Membership/containment (`@>`, arrays, FTS) | Not the right default for scalar equality |
| GiST | Nearest-neighbor / geometric / specialized ops | More flexible, often slower than B-tree for plain equality |
| BRIN | Page-range summaries | Only works well with strong physical correlation |
| `INCLUDE (...)` | Non-key payload columns | Helps index-only scans; adds write cost |
| `CREATE INDEX CONCURRENTLY` | Avoids blocking writes | Cannot run inside a transaction block |
| `REINDEX CONCURRENTLY` | Online rebuild path | PG 12+ only |

## Feature Interactions

- **Partial indexes + prepared statements**: planner may not prove a parameterized predicate implies the partial-index predicate.
- **Expression indexes + functions**: the query expression must match exactly, and indexed functions must be `IMMUTABLE`.
- **`INCLUDE` + visibility map**: index-only scans still need heap access until pages become all-visible.
- **BRIN + heap order**: low correlation makes BRIN nearly useless; check `pg_stats.correlation` first. Tune `pages_per_range` (default 128): smaller values improve selectivity but increase index size. For append-only tables with perfect correlation, BRIN can be 1000x smaller than B-tree.
- **BRIN + mixed workloads**: random UPDATEs destroy physical ordering over time; BRIN degrades silently. Monitor with correlation checks.
- **Partitioning + indexes**: indexes are per-partition; there are no global indexes across declarative partitions.
- **Collation + text indexes**: collation or opclass mismatch can make a seemingly correct index unusable.

## Diagnostic Checklist

| Symptom | Run | Fix |
|---|---|---|
| Query still seq-scans | `EXPLAIN (ANALYZE, BUFFERS) SELECT ...;` | Verify predicate shape, selectivity, and exact expression match |
| Suspect unused indexes | `SELECT relname, indexrelname, idx_scan FROM pg_stat_user_indexes ORDER BY idx_scan, indexrelname;` | Drop or justify indexes with `idx_scan = 0` after enough workload time |
| Considering BRIN | `SELECT correlation FROM pg_stats WHERE tablename = 'logs' AND attname = 'created_at';` | Use BRIN only when correlation is high |
| Build progress unknown | `SELECT * FROM pg_stat_progress_create_index;` | Monitor active builds, especially concurrent ones |
| Index created but planner ignores it | `ANALYZE orders;` | Refresh stats, then re-check plan |
| Want index-only scans | `EXPLAIN (ANALYZE, BUFFERS) SELECT total FROM orders WHERE status = 'open';` | Consider `INCLUDE` payload columns if reads justify extra write cost |

## Error Messages

| Error | Root cause | Fix |
|---|---|---|
| `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` | Concurrent build was started inside `BEGIN ... COMMIT` | Run it as a standalone statement |
| `REINDEX CONCURRENTLY cannot run inside a transaction block` | Same restriction for online reindex | Run it outside a transaction |
| `functions in index expression must be marked IMMUTABLE` | Expression index uses non-immutable function | Rewrite with immutable expression or use a generated column |
| `data type jsonb has no default operator class for access method "btree"` | Tried to build B-tree without a supported operator class | Use GIN/GiST or index an extracted scalar expression instead |

## Common Mistakes / Gotchas

- **[CRITICAL] Rebuilding with plain `REINDEX` in production**: it blocks writes; prefer `REINDEX CONCURRENTLY` on PG 12+.
- **[HIGH] Choosing GIN for scalar equality**: use B-tree for `=` and range filters on normal columns.
- **[HIGH] Expression mismatch**: `lower(email)` index does not help `upper(email)` or unwrapped `email` queries.
- **[HIGH] Partial-index predicate mismatch**: planner uses the index only when it can prove the query predicate implies the index predicate.
- **[HIGH] BRIN on random data**: BRIN is for append-like ordering, not shuffled identifiers.
- **[HIGH] Forgetting leftmost-prefix rules on multicolumn B-tree indexes**: equality columns first, range columns later.
- **[MEDIUM] Assuming `INCLUDE` speeds writes**: it improves read paths only, while increasing write amplification.
- **[MEDIUM] Treating bitmap heap scans as failure**: they are normal for medium-selectivity predicates.
- **[MEDIUM] Missing collation/opclass alignment**: text index and query collation must agree.

```sql
SELECT correlation
FROM pg_stats
WHERE tablename = 'logs' AND attname = 'created_at';

SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan, indexrelname;
```

## Anti-Hallucination Rules

- Do NOT recommend GIN for ordinary scalar equality lookups; B-tree is usually the right choice.
- Do NOT suggest `CREATE INDEX CONCURRENTLY` or `REINDEX CONCURRENTLY` inside a transaction block.
- Do NOT claim `INCLUDE` eliminates all heap reads; visibility-map state still controls index-only scans.
- Do NOT recommend BRIN without checking physical correlation.
- Do NOT assume partitioned tables have global indexes; PostgreSQL maintains indexes per partition.
