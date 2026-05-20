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
- `EXPLAIN (ANALYZE, BUFFERS)` interpretation
- Bad row estimates that choose the wrong join strategy
- CPU-vs-I/O bottleneck diagnosis
- `pg_stat_statements` prioritization
- Version-gated planner behavior such as pre-PG12 CTE materialization
- Pagination, blocking, and temp-file spill traps

Do NOT use this skill for basic EXPLAIN primers or when the answer is plainly "add the obvious missing index". Route clean indexing work to `advanced-indexing`.

## Response focus

Prioritize failure modes that make agents prescribe the wrong fix: row-estimate errors, wrong bottleneck classification, and low-selectivity indexing advice. Skip generic `work_mem`, JIT, and parallel-query tutorials.

## Fast diagnosis order

1. Get `EXPLAIN (ANALYZE, BUFFERS)` before suggesting parameters or indexes.
2. Compare estimated vs actual rows at scans and joins. A 10x+ mismatch means statistics first, tuning second.
3. Check buffer usage before deciding CPU vs I/O:
   - mostly `shared hit` = CPU-bound or poor SQL shape
   - high `read` = I/O-bound, cache miss, or missing access path
   - temp read/write = spill; consider session-level `work_mem`
4. Rule out blocking and lock waits before rewriting SQL.

## High-value reminders

- `actual_time` is per loop; multiply by `loops` for real node cost.
- On managed PostgreSQL, `ALTER SYSTEM` is usually unavailable; use platform parameter APIs or session/database settings.
- `Rows Removed by Filter` is only actionable after you check selectivity. Large filtered counts on a low-cardinality column do not automatically justify an index.

## Useful checks

```sql
-- Stale stats candidates
SELECT schemaname, relname, n_live_tup, n_mod_since_analyze
FROM pg_stat_user_tables
WHERE n_live_tup > 0
  AND n_mod_since_analyze > n_live_tup * 0.1;

-- Hot queries by total impact, not just per-call latency
SELECT query, total_exec_time, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

## Common Mistakes / Gotchas

1. **[HIGH] Ignoring loops multiplier**: A node showing `actual time=0.1..0.1` with `loops=10000` cost ~1000 ms total. Agents routinely underweight inner-loop work if they read node time literally.

2. **[HIGH] Join order / cardinality misestimation**: The agent recommends a new index, but the real failure is bad row estimates causing a nested-loop join on a large intermediate result.

   Fix: compare estimated vs actual rows in `EXPLAIN ANALYZE`. If the mismatch is 10x+, refresh stats with `ANALYZE`; for correlated predicates, create extended statistics:
   ```sql
   CREATE STATISTICS s_orders_customer_status
   ON customer_id, status
   FROM orders;

   ANALYZE orders;
   ```

3. **[HIGH] I/O vs CPU bottleneck confusion**: The agent increases `work_mem` for an I/O-bound query or adds an index to a CPU-bound aggregation/function-heavy query.

   Fix: use `EXPLAIN (ANALYZE, BUFFERS)`.
   - high `shared hit`, low `read` => data is already cached; reduce computation, row explosion, or repeated function work
   - high `read` => query is I/O-bound; look for better access paths, more RAM/cache, or realistic `effective_cache_size`

4. **[HIGH] Missing index vs bad selectivity**: The agent adds an index on a low-cardinality column such as `status` or a boolean flag. The planner ignores it because selectivity is too poor, often worse than ~10%.

   Fix: prefer a partial index such as `WHERE status = 'active'` or a composite index that starts with a more selective predicate.

5. **[HIGH] OFFSET pagination at scale**: `OFFSET 100000` still scans and discards 100K rows.

   ❌ Wrong:
   ```sql
   SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 100000;
   ```

   ✅ Right:
   ```sql
   SELECT *
   FROM orders
   WHERE id > :last_seen_id
   ORDER BY id
   LIMIT 20;
   ```

6. **[HIGH] Plan instability after bulk load or skew change**: After large inserts, deletes, or repartitioning, agents jump to config tuning before fixing stale statistics.

   Fix: run `ANALYZE` first. For skewed columns, raise per-column stats targets instead of globally changing defaults.

7. **[MEDIUM] Treating every temp spill as a global `work_mem` problem**: `Sort Method: external merge` or hash batches means that operator spilled. That does **not** justify raising `work_mem` cluster-wide.

   Fix: change `work_mem` for the session or statement first, then re-check the plan. Global increases multiply across concurrent workers and can cause memory pressure.

8. **[HIGH] Missing `pg_stat_statements` top-N analysis**: Sorting by `mean_exec_time` finds rare outliers, not the queries burning the most wall-clock time.

   Fix: sort by `total_exec_time` first, then inspect `calls` and `mean_exec_time`.

9. **[HIGH] CTE materialization trap (pre-PG 12)**: Before PG 12, CTEs are optimization fences. Agents that rewrite everything into CTEs can accidentally force large materializations.

   Fix: inline the subquery on old versions, or on PG 12+ use `MATERIALIZED` / `NOT MATERIALIZED` deliberately.

10. **[MEDIUM] Tuning SQL when the session is actually blocked**: A query with long runtime may be waiting on locks, not executing.

    Fix: check `wait_event_type`, `wait_event`, and blockers in `pg_stat_activity` before changing indexes or planner settings.
