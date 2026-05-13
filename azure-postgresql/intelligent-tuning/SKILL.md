---
name: intelligent-tuning
description: "Azure Database for PostgreSQL Flexible Server intelligent performance tuning: Query Store, automatic indexing, and performance recommendations"
version: "1.0.0"
tags: [azure, postgresql, query-store, auto-index, performance-insights, tuning]
execution_mode: read
requires_confirmation: false
platform_scope: azure-postgresql
---

# Intelligent Tuning

## When to Use

**Trigger when:**
- User asks about Query Store or query performance insights
- User asks about automatic index recommendations on Azure
- User wants to identify top resource-consuming queries
- User mentions "intelligent performance" or "auto-tune"
- User asks how to find slow queries without manual EXPLAIN

**Do NOT use when:**
- User needs manual EXPLAIN ANALYZE interpretation (use `postgresql/query-performance/`)
- User needs to create indexes manually (use `postgresql/advanced-indexing/`)
- User asks about server SKU/scaling (use `azure-postgresql/provisioning/`)

**Overlaps with:**
- `postgresql/query-performance/` (manual tuning complements auto-recommendations)
- `postgresql/advanced-indexing/` (auto-index recommends what to create manually)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Query Store enabled (on by default for new servers)
- MCP `execute_sql` tool or `psql`

## Instructions

**Step 1: Verify Query Store is enabled**

```sql
SHOW pg_qs.query_capture_mode;  -- Should be 'top' or 'all'
```

```bash
# Enable if disabled
az postgres flexible-server parameter set \
    --resource-group myRG --server-name myserver \
    --name pg_qs.query_capture_mode --value top
```

**Step 2: Find top queries by execution time**

```sql
SELECT queryid, calls, mean_time, total_time, query
FROM query_store.qs_view
ORDER BY total_time DESC
LIMIT 10;
```

**Step 3: Find queries that regressed**

```sql
-- Compare two time windows
SELECT q.queryid, q.query,
    s1.mean_time AS before_ms, s2.mean_time AS after_ms,
    (s2.mean_time - s1.mean_time) / s1.mean_time * 100 AS pct_change
FROM query_store.qs_view s1
JOIN query_store.qs_view s2 ON s1.queryid = s2.queryid
JOIN query_store.query_texts_view q ON q.queryid = s1.queryid
WHERE s1.start_time >= '2025-01-01' AND s1.start_time < '2025-01-08'
  AND s2.start_time >= '2025-01-08' AND s2.start_time < '2025-01-15'
  AND s2.mean_time > s1.mean_time * 1.5  -- 50%+ regression
ORDER BY pct_change DESC;
```

**Step 4: Check automatic index recommendations**

```sql
SELECT * FROM intelligent_performance.index_recommendations
WHERE state = 'Active'
ORDER BY estimated_improvement DESC;
```

**Step 5: Apply or dismiss recommendations**

```sql
-- Apply a recommendation
SELECT intelligent_performance.apply_recommendation('<recommendation_id>');

-- Dismiss
SELECT intelligent_performance.dismiss_recommendation('<recommendation_id>');
```

## Common Mistakes

1. **Reading `query_store.qs_view` without join**: The `qs_view` contains only metrics (calls, total_time, rows). Join with `query_store.query_texts_view` on `query_text_id` to get actual SQL text: `SELECT qt.query_sql_text, qs.calls, qs.mean_time FROM query_store.qs_view qs JOIN query_store.query_texts_view qt ON qs.query_text_id = qt.query_text_id ORDER BY qs.total_time DESC LIMIT 20`
2. **Ignoring wait event analysis**: `query_store.pgms_wait_sampling_view` shows WHERE time is spent. Column `event_type` values: `LWLock` = contention, `IO` = storage bottleneck (upgrade SKU), `Lock` = blocking queries. Query: `SELECT event_type, event, sum(count) FROM query_store.pgms_wait_sampling_view GROUP BY 1,2 ORDER BY 3 DESC`
3. **Auto-index recommendation lifecycle**: Recommendations go through states: `Recommended` > `Verified` > `Applied`. Check `SELECT * FROM intelligent_performance.index_recommendations`. Reverted indexes show `Reverted` state. Manually apply with the provided DDL if auto-apply is off
4. **Query Store retention eating storage**: Default retention is 7 days. On high-QPS servers, QS storage grows to GBs. Set `pg_qs.retention_period_in_days = 3` on busy systems and `pg_qs.store_query_plans = off` to reduce overhead
5. **Not enabling `pg_qs.track_utility`**: By default, utility commands (COPY, CREATE, VACUUM) are not tracked. Enable to catch slow bulk loads: `az postgres flexible-server parameter set --name pg_qs.track_utility --value on`
6. **Burstable tier overhead**: Query Store adds ~5% CPU on B-series. Disable on dev/test with `pg_qs.query_capture_mode = none`. Re-enable for production profiling sessions only
7. **Missing normalized query identification**: Same query with different literal values gets one `query_text_id`. Use `query_store.qs_view.query_id` to group by plan shape, then `mean_time` variance to detect plan instability
8. **Not correlating with Azure Metrics**: Cross-reference QS `total_time` spikes with Azure Monitor `cpu_percent` and `iops` metrics to determine if bottleneck is compute, storage, or query logic

## Verification

```sql
-- Verify Query Store is collecting data
SELECT count(*) FROM query_store.qs_view WHERE start_time > now() - interval '1 hour';

-- Check last recommendation update
SELECT * FROM intelligent_performance.index_recommendations
ORDER BY created_time DESC LIMIT 5;
```

## Failure Recovery

- **Query Store empty**: Check `pg_qs.query_capture_mode` is not 'none'. Allow 1+ hours for data collection
- **Recommendations not appearing**: Requires sufficient query volume and repeated patterns. Check after 48+ hours of workload
- **Performance regression after auto-index**: Revert with `DROP INDEX` on the recommended index
