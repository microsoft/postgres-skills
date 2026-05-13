---
name: query-performance
description: "EXPLAIN ANALYZE interpretation, bottleneck identification, and PostgreSQL server configuration tuning"
version: "1.0.0"
tags: [postgresql, performance, explain, work_mem, statistics]
execution_mode: read
requires_confirmation: false
platform_scope: postgresql
---

# Query Performance Tuning

## When to Use

**Trigger when:**
- User says "my query is slow" or "how do I optimize this query"
- User shares EXPLAIN ANALYZE output
- Queries spilling to disk (sort/hash operations)
- User asks about `work_mem`, `shared_buffers`, `effective_cache_size`
- `pg_stat_statements` shows high total_time queries

**Do NOT use when:**
- Issue is missing index (use `postgresql/advanced-indexing/`)
- Problem is Azure-specific tuning (use `azure-postgresql/intelligent-tuning/`)
- Query is correct but table needs partitioning (use `postgresql/table-partitioning/`)

**Overlaps with:**
- `postgresql/advanced-indexing/` (EXPLAIN may reveal missing index as root cause)
- `azure-postgresql/intelligent-tuning/` (Azure-managed tuning recommendations)

## Prerequisites

- `psql` or MCP `execute_sql` tool
- Access to run `EXPLAIN (ANALYZE, BUFFERS)` on the slow query
- Access to `pg_stat_statements` (if investigating workload-wide)

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

## Common Mistakes

1. **Ignoring loops multiplier**: A node showing 0.1ms but with loops=10000 is actually 1000ms total. Always compute `actual_time × loops`
2. **OFFSET pagination at scale**: `OFFSET 100000` scans and discards 100K rows. Use keyset pagination: `WHERE id > last_seen_id ORDER BY id LIMIT 20`
3. **JIT compilation overhead on short queries**: JIT (PG 11+) compiles to machine code but adds 5-50ms startup. Disable for OLTP: `SET jit = off` per session if queries < 100ms
4. **Parallel query not activating**: Requires `max_parallel_workers_per_gather > 0`, table > `min_parallel_table_scan_size` (8MB default), and no `FOR UPDATE/SHARE` clause
5. **Plan instability from bad statistics**: After bulk loads, `ANALYZE` immediately. For columns with skewed distributions: `ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000` (default 100)
6. **Missing pg_stat_statements top-N analysis**: Sort by `total_exec_time` not `mean_exec_time` — a 1ms query called 1M times is worse than a 500ms query called once
7. **CTE materialization trap (pre-PG 12)**: CTEs are optimization fences before PG 12. On PG 12+, add `MATERIALIZED`/`NOT MATERIALIZED` to control this explicitly

## Verification

```sql
-- Re-run EXPLAIN after fix and compare actual time
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <optimized_query>;
-- Confirm: no "Sort Method: external merge", reduced actual time
```

## Failure Recovery

- **Cannot change server config**: Use session-level SET for work_mem (no server restart needed)
- **ANALYZE doesn't help**: Increase `default_statistics_target` for columns with skewed distribution: `ALTER TABLE t ALTER COLUMN c SET STATISTICS 1000`
- **No pg_stat_statements**: Enable it: add to `shared_preload_libraries` (requires restart) or use `EXPLAIN` on individual queries
