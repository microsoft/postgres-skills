---
name: query-performance
description: "EXPLAIN ANALYZE interpretation, bottleneck identification, and PostgreSQL server configuration tuning"
tags: [postgresql, performance, explain, work_mem, statistics]
platform_scope: postgresql
activation:
  user_intent:
    - "my query is slow"
    - "how do I optimize this query"
    - "interpret this EXPLAIN ANALYZE output"
    - "queries spilling to disk"
    - "tune work_mem or shared_buffers"
    - "pg_stat_statements shows high total_time"
    - "autovacuum tuning"
    - "locks or deadlocks blocking queries"
  technical_keywords:
    - EXPLAIN ANALYZE
    - work_mem
    - shared_buffers
    - effective_cache_size
    - pg_stat_statements
    - Sort Method: external merge
    - Rows Removed by Filter
    - default_statistics_target
    - n_mod_since_analyze
  exclusion_conditions:
    - "when Seq Scan on large table is the bottleneck and adding an index is the fix, use `postgresql/advanced-indexing/` instead"
    - "when problem is Azure-specific tuning, use `azure-postgresql/intelligent-tuning/` instead"
    - "when table needs partitioning, use `postgresql/table-partitioning/` instead"
  adjacent_skills:
    - "`postgresql/advanced-indexing/`"
    - "`azure-postgresql/intelligent-tuning/`"
---

# Query Performance Tuning

## Instructions

**Step 1: Read EXPLAIN ANALYZE**

- `actual_time` is per-loop — multiply by `loops` for true cost
- `Sort Method: external merge` → `SET work_mem = '256MB'` for session
- `Rows Removed by Filter` → missing index (route to `advanced-indexing`)

**Step 2: Session-level config (no restart)**

```sql
SET work_mem = '256MB';  -- per-session only; cannot ALTER SYSTEM on managed PG
SET effective_cache_size = '24GB';  -- hint only, no allocation
```

> On managed PostgreSQL, `ALTER SYSTEM SET` is unavailable. Use `ALTER DATABASE` for runtime params or the portal for postmaster params.

**Step 3: Detect stale statistics**

```sql
SELECT schemaname, relname, n_live_tup, n_mod_since_analyze
FROM pg_stat_user_tables
WHERE n_mod_since_analyze > n_live_tup * 0.1;

ANALYZE <table_name>;
```

**Step 4: Row estimation errors**

Compare `rows=` (estimated) vs actual. If 10x+ off:
```sql
ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000;  -- default 100
ANALYZE t;
```

### Verify

```sql
-- Re-run EXPLAIN after fix and compare actual time
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <optimized_query>;
-- Confirm: no "Sort Method: external merge", reduced actual time
```

## Common Mistakes

1. **[HIGH] Ignoring loops multiplier**: A node showing 0.1ms with loops=10000 is actually 1000ms total. Always compute `actual_time × loops`

2. **[HIGH] OFFSET pagination at scale**: `OFFSET 100000` scans and discards 100K rows

   ❌ Wrong:
   ```sql
   SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 100000;
   ```

   ✅ Right:
   ```sql
   SELECT * FROM orders WHERE id > :last_seen_id ORDER BY id LIMIT 20;
   ```

3. **[MEDIUM] JIT compilation overhead on short queries**: JIT adds 5-50ms startup. Disable for OLTP: `SET jit = off` per session if queries < 100ms

4. **[MEDIUM] Parallel query not activating**: Requires `max_parallel_workers_per_gather > 0`, table > 8MB, no `FOR UPDATE/SHARE`

5. **[HIGH] Plan instability from bad statistics**: After bulk loads, `ANALYZE` immediately. Skewed columns: `ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000`

6. **[HIGH] Missing pg_stat_statements top-N analysis**: Sort by `total_exec_time` not `mean_exec_time`

   ❌ Wrong:
   ```sql
   SELECT query, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
   ```

   ✅ Right:
   ```sql
   SELECT query, total_exec_time, calls, mean_exec_time
   FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;
   ```

7. **[HIGH] CTE materialization trap (pre-PG 12)**: CTEs are optimization fences before PG 12. On PG 12+, add `MATERIALIZED`/`NOT MATERIALIZED` to control explicitly

8. **[MEDIUM] Cannot change server config**: Use session-level `SET` for work_mem (no restart needed)

9. **[MEDIUM] No pg_stat_statements available**: Add to `shared_preload_libraries` (requires restart) or use `EXPLAIN` on individual queries

10. **[HIGH] MERGE statement (PG 15+ only)**: `MERGE INTO ... USING ... WHEN MATCHED/NOT MATCHED` is not available before PG 15. On PG 14 and earlier, use `INSERT ... ON CONFLICT` for upserts

11. **[MEDIUM] Incremental sort (PG 13+)**: PG 13+ can use a pre-sorted prefix to avoid full re-sort. If EXPLAIN shows `Sort` instead of `Incremental Sort` on PG 13+, add a partial index on the leading sort column
