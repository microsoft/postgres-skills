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

1. **Query Store disabled**: Older servers may have it off. Must be enabled to get recommendations
2. **Not waiting for data**: Auto-index needs days of query patterns before generating recommendations
3. **Ignoring wait statistics**: Query Store captures waits too. A slow query blocked on I/O needs storage/SKU changes, not index changes
4. **403/PermissionDenied**: Query Store views require `azure_pg_admin` role

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
