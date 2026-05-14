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

**Step 1: Read EXPLAIN ANALYZE correctly**

Key rules:
- **Actual time** is per-loop. Multiply by `loops` for true cost
- **Rows Removed by Filter** indicates missing index opportunity
- **Sort Method: external merge** means work_mem is too low
- The slowest node is your bottleneck (highest actual time x loops)

**Step 2: Check configuration before schema changes**

```sql
-- Sorts/hashes spilling to disk?
SHOW work_mem;  -- Default 4MB is too low for analytics
-- Recommendation: SET work_mem = '256MB' for the session (not globally)

-- Planner underestimates available cache?
SHOW effective_cache_size;  -- Should be ~75% of total RAM
SHOW shared_buffers;        -- Should be ~25% of total RAM
```

**Step 3: Check statistics freshness**

```sql
-- Find tables with stale stats (large estimation errors)
SELECT schemaname, relname, last_analyze, last_autoanalyze,
       n_live_tup, n_mod_since_analyze
FROM pg_stat_user_tables
WHERE n_mod_since_analyze > n_live_tup * 0.1;

-- Fix: run ANALYZE on stale tables
ANALYZE <table_name>;
```

**Step 4: Identify row estimation errors**

In EXPLAIN output, compare `rows=` (estimated) vs actual rows. If off by 10x+, run ANALYZE or increase `default_statistics_target` for that column.

### Verify

```sql
-- Re-run EXPLAIN after fix and compare actual time
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <optimized_query>;
-- Confirm: no "Sort Method: external merge", reduced actual time
```

## Common Mistakes

1. **Ignoring loops multiplier**: A node showing 0.1ms but with loops=10000 is actually 1000ms total. Always compute `actual_time × loops`
2. **OFFSET pagination at scale**: `OFFSET 100000` scans and discards 100K rows. Use keyset pagination: `WHERE id > last_seen_id ORDER BY id LIMIT 20`
3. **JIT compilation overhead on short queries**: JIT (PG 11+) compiles to machine code but adds 5-50ms startup. Disable for OLTP: `SET jit = off` per session if queries < 100ms
4. **Parallel query not activating**: Requires `max_parallel_workers_per_gather > 0`, table > `min_parallel_table_scan_size` (8MB default), and no `FOR UPDATE/SHARE` clause
5. **Plan instability from bad statistics**: After bulk loads, `ANALYZE` immediately. For columns with skewed distributions: `ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000` (default 100)
6. **Missing pg_stat_statements top-N analysis**: Sort by `total_exec_time` not `mean_exec_time` — a 1ms query called 1M times is worse than a 500ms query called once
7. **CTE materialization trap (pre-PG 12)**: CTEs are optimization fences before PG 12. On PG 12+, add `MATERIALIZED`/`NOT MATERIALIZED` to control this explicitly
8. **Cannot change server config**: Use session-level SET for work_mem (no server restart needed)
9. **No pg_stat_statements available**: Enable it: add to `shared_preload_libraries` (requires restart) or use `EXPLAIN` on individual queries
