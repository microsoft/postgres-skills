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
    - "when table needs partitioning, use `postgresql/table-partitioning/` instead"
  adjacent_skills:
    - "`postgresql/advanced-indexing/`"
---

# Query Performance Tuning

## When to use this skill

Use for production PostgreSQL issues involving:
- Stale statistics causing bad estimates
- Row estimation errors (10x+ off)
- work_mem / JIT / parallel query tuning
- pg_stat_statements top-N analysis
- CTE materialization traps (version-gated)
- OFFSET pagination at scale

Do NOT use for basic EXPLAIN ANALYZE reading or when the fix is adding an index (route to `advanced-indexing`).

## Response focus

Prioritize estimation errors, parameter tuning, version-gated behavior, and production anti-patterns. Avoid explaining basic EXPLAIN output format unless directly asked.

## High-value reminders

- `actual_time` in EXPLAIN is per-loop — multiply by `loops` for true cost
- `Sort Method: external merge` → increase `work_mem` for that session
- `Rows Removed by Filter` → missing index (route to `advanced-indexing`)
- On managed PostgreSQL, `ALTER SYSTEM SET` is unavailable. Use `ALTER DATABASE` for runtime params or portal for postmaster params.

## Stale statistics detection

```sql
SELECT schemaname, relname, n_live_tup, n_mod_since_analyze
FROM pg_stat_user_tables
WHERE n_mod_since_analyze > n_live_tup * 0.1;

ANALYZE <table_name>;
```

## Row estimation fix

Compare `rows=` (estimated) vs actual. If 10x+ off:
```sql
ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000;  -- default 100
ANALYZE t;
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

8. **[HIGH] MERGE statement (PG 15+ only)**: `MERGE INTO ... USING ... WHEN MATCHED/NOT MATCHED` is not available before PG 15. On PG 14 and earlier, use `INSERT ... ON CONFLICT` for upserts

9. **[MEDIUM] Incremental sort (PG 13+)**: PG 13+ can use a pre-sorted prefix to avoid full re-sort. If EXPLAIN shows `Sort` instead of `Incremental Sort` on PG 13+, add a partial index on the leading sort column
