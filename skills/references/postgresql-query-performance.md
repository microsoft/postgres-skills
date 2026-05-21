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

> **Response focus:** Diagnose misestimates, plan-cache issues, spills, JIT overhead, and blocking before suggesting indexes or global GUC changes.

## Version History

| Version | Feature | Why it matters |
|---------|---------|----------------|
| PG 10 | `CREATE STATISTICS` for `ndistinct` and `dependencies` | Fixes multi-column estimate failures |
| PG 11 | JIT compilation | Helps long CPU-heavy queries, hurts short OLTP when compile time dominates |
| PG 12 | CTE inlining by default | `WITH` stops being an optimization fence unless `MATERIALIZED` |
| PG 13 | Incremental sort | Avoids full re-sort when input is partially ordered |
| PG 14 | Memoize plan node | Helps nested loops with repeated parameter values |

## Parameter Correctness

| Setting | Scope | Correct use | Wrong advice to avoid |
|---------|-------|-------------|-----------------------|
| `work_mem` | session, role, db | Raise locally for a known spilling sort/hash | Raising cluster-wide for one bad query |
| `hash_mem_multiplier` | cluster | Include it in hash memory math | Forgetting hash nodes can use more than `work_mem` |
| `jit_above_cost` | session, role, db, cluster | Raise or disable for short OLTP if JIT compile time dominates | Enabling JIT blindly everywhere |
| `plan_cache_mode` | session | Compare `force_custom_plan` vs `force_generic_plan` for parameter-sensitive SQL | Assuming prepared statements always pick the best plan |
| `default_statistics_target` | session, role, db, cluster | Prefer per-column `ALTER TABLE ... SET STATISTICS` for skewed columns | Raising it globally without evidence |
| `effective_cache_size` | planner hint | Reflect realistic OS plus shared cache | Treating it as reserved memory |

## Feature Interactions

- **Prepared statements + skewed predicates**: Generic plans can stay slow for one tenant and fast for another. Test with `SET plan_cache_mode = force_custom_plan`.
- **CTEs + version**: Pre-PG12 CTEs materialize. PG12+ inlines unless you force `MATERIALIZED`.
- **Extended statistics + correlated columns**: `customer_id` plus `status` or `country` plus `region` often need `CREATE STATISTICS`, not a new index.
- **Parallel workers + `work_mem`**: Sort and hash memory multiply across workers and plan nodes.
- **JIT + OLTP**: Queries under the JIT cost threshold often get slower if compilation cost outweighs execution time.

## Diagnostic Checklist

| Symptom | Run | Look for | Fix |
|---------|-----|----------|-----|
| Same SQL fast for one bind value, slow for another | `SET plan_cache_mode = force_custom_plan; EXPLAIN (ANALYZE, BUFFERS) ...` | Custom plan differs sharply from prepared plan | Use custom plans, rewrite predicate, or reduce skew |
| 10x row estimate error | `EXPLAIN (ANALYZE, BUFFERS) ...` | `rows=` vs `actual rows=` mismatch at scan or join | `ANALYZE`; add extended stats; raise per-column stats target |
| Temp files or spill | `EXPLAIN (ANALYZE, BUFFERS) ...` | `Sort Method: external merge`, hash batches, temp read/write | Raise local `work_mem`; reduce row width; pre-aggregate |
| Query is "slow" but mostly waiting | `SELECT pid, wait_event_type, wait_event, state, query FROM pg_stat_activity WHERE state <> 'idle';` | Lock waits or client waits | Fix blocker first |
| Need top offenders | `SELECT query, total_exec_time, calls, mean_exec_time FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;` | High total impact, not just high mean | Optimize by total time burned |

```sql
-- Stale stats candidates
SELECT schemaname, relname, n_live_tup, n_mod_since_analyze
FROM pg_stat_user_tables
WHERE n_live_tup > 0
  AND n_mod_since_analyze > n_live_tup * 0.1;

-- Check skewed column stats
SELECT attname, n_distinct, most_common_vals, most_common_freqs
FROM pg_stats
WHERE schemaname = 'public' AND tablename = 'orders';
```

## Error Messages

| Error | Root cause | Fix |
|-------|------------|-----|
| `canceling statement due to statement timeout` | Query ran too long or waited on a blocker | Check `pg_stat_activity`, then plan and locks |
| `could not write to file "base/pgsql_tmp/...": No space left on device` | Sort or hash spilled beyond temp space | Reduce spill, raise local `work_mem`, add temp storage |
| `out of memory` | Hash or sort memory exploded, often with parallelism | Lower concurrency, lower row width, avoid global `work_mem` increases |

## Common Mistakes / Gotchas

- **Ignore `loops` at your peril**: Node time is per loop. `0.1 ms × 10000 loops` still hurts.
- **Treat every Seq Scan as a bug**: On low selectivity or small tables, Seq Scan is correct.
- **Add an index for a statistics problem**: Fix 10x estimate errors before adding access paths.
- **Sort by `mean_exec_time` first**: Start with `total_exec_time` in `pg_stat_statements`.
- **Blame CPU when the query is blocked**: Check waits before tuning SQL.
- **Global `work_mem` increase for one spill**: Prefer session or statement scope.
- **Assume JIT always helps**: It often hurts short requests.

## Anti-Hallucination Rules

- Do not claim `VACUUM FULL` is routine performance maintenance.
- Do not recommend raising `work_mem` globally without concurrency math.
- Do not treat pre-PG12 and PG12+ CTE behavior as identical.
- Do not prescribe indexes before checking row-estimate quality and wait events.
- Do not claim `effective_cache_size` reserves RAM.
