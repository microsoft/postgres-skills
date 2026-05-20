---
name: advanced-indexing
description: "B-tree, GIN, GiST, BRIN, partial, and expression index strategies for PostgreSQL"
tags: [postgresql, indexing, performance, gin, gist, brin]
platform_scope: postgresql
activation:
  user_intent:
    - "what index should I create"
    - "which index type should I use"
    - "EXPLAIN shows sequential scan on large table"
    - "how to create a partial index"
    - "expression index or covering index"
    - "index for JSONB or array queries"
  technical_keywords:
    - CREATE INDEX
    - GIN
    - GiST
    - BRIN
    - INCLUDE
    - partial index
    - expression index
    - jsonb_path_ops
    - pg_stat_user_indexes
    - idx_scan
    - REINDEX CONCURRENTLY
    - Seq Scan
  exclusion_conditions:
    - "when query is slow due to configuration (work_mem, shared_buffers, statistics) not missing indexes, use `postgresql/query-performance/` instead"
    - "when table has fewer than 10,000 rows (seq scan may be optimal), do not use this skill"
    - "when user needs EXPLAIN interpretation or planner behavior guidance, use `postgresql/query-performance/` instead"
  adjacent_skills:
    - "`postgresql/query-performance/`"
    - "`postgresql/jsonb-patterns/`"
---

# Advanced Indexing Strategy

## When to use this skill

Use for production PostgreSQL issues involving:
- Choosing between B-tree, GIN, GiST, BRIN index types
- Partial indexes, expression indexes, covering indexes (INCLUDE)
- BRIN correlation requirements
- Index not being used by planner
- REINDEX safety in production

Do NOT use for basic `CREATE INDEX` syntax or when the user simply needs EXPLAIN interpretation (route to `query-performance`).

## Response focus

Prioritize index type tradeoffs, version-gated features, and common misapplications. Include runnable CREATE INDEX examples when the user asks for help creating an index.

## When NOT to Index

Agents frequently recommend indexes that the planner will ignore or that cause more harm than good:

| Situation | Why index won't help | Better approach |
|---|---|---|
| Column has < 10 distinct values (status, boolean) | Selectivity too low; seq-scan wins | Partial index: `WHERE status = 'active'` |
| Table has < 10K rows | Planner always prefers seq-scan for small tables | Don't index; full scan is fast enough |
| Write-heavy table with > 8 indexes | Each INSERT updates all indexes; write amplification | Audit unused indexes: `SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0` |
| Highly correlated column already matches physical order | BRIN provides same benefit at 1000x less space | Use BRIN instead of B-tree |
| Expression in WHERE doesn't match index expression exactly | Index silently ignored | Verify with `EXPLAIN` that index is actually used |

## Common Mistakes

1. **[HIGH] Missing expression match**: Expression index must exactly match the query expression (`lower(email)` index won't help `UPPER(email)` query)

2. **[HIGH] BRIN on randomly-ordered data**: BRIN only works when physical row order correlates with column values

   ❌ Wrong:
   ```sql
   -- user_id is randomly distributed across heap pages
   CREATE INDEX idx_users_brin ON users USING brin(user_id);
   ```

   ✅ Right:
   ```sql
   -- Check correlation first
   SELECT correlation FROM pg_stats WHERE tablename='users' AND attname='user_id';
   -- Only use BRIN if correlation > 0.9
   CREATE INDEX idx_logs_brin ON logs USING brin(created_at);  -- append-only, correlation ~1.0
   ```

3. **[MEDIUM] Ignoring index-only scans**: Add `INCLUDE` columns to avoid heap fetches: `CREATE INDEX ON orders(status) INCLUDE (total, created_at)` (PG 12+)

4. **[MEDIUM] Not detecting unused indexes**: Query `pg_stat_user_indexes` for `idx_scan = 0` to find indexes wasting write amplification

5. **[HIGH] Partial index predicate mismatch**: Query WHERE must be a superset of the partial index predicate or planner won't use it

6. **[CRITICAL] REINDEX without CONCURRENTLY**: `REINDEX INDEX idx` locks the table for writes

   ❌ Wrong:
   ```sql
   REINDEX INDEX idx_orders_status;  -- ACCESS EXCLUSIVE lock
   ```

   ✅ Right:
   ```sql
   REINDEX INDEX CONCURRENTLY idx_orders_status;  -- PG 12+, no lock
   ```

7. **[HIGH] Multi-column B-tree column order**: Leftmost column must appear in WHERE or index is unusable. Equality filters first, range filters last

8. **[MEDIUM] Index not used after creation**: Run `ANALYZE <table>` to update statistics, then re-check EXPLAIN

9. **[MEDIUM] Index build too slow on large table**: Use `CREATE INDEX CONCURRENTLY` to avoid locking writes

10. **[MEDIUM] Wrong index type error**: GIN/GiST require correct operator class; check `pg_opclass`

11. **[MEDIUM] Parallel index build (PG 11+)**: `CREATE INDEX` uses parallel workers on PG 11+. Tune with `SET max_parallel_maintenance_workers = 4` for faster builds on large tables. Not available on PG 10 and earlier
12. **[HIGH] Collation/opclass mismatch for text indexes**: If queries use `COLLATE "C"` or ICU collation, build the index with that same collation or it is ignored
13. **[HIGH] Planner ignores index due to low selectivity**: Indexes on low-cardinality columns like `status` often lose to seq scans. Prefer partial or composite indexes
14. **[MEDIUM] Bitmap scan vs index scan confusion**: Bitmap heap scans are normal for ~1-20% selectivity. Do not treat them as planner failure when EXPLAIN shows moderate row counts
