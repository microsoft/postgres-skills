---
name: intelligent-tuning
description: "Azure Database for PostgreSQL Flexible Server intelligent performance tuning: Query Store, automatic indexing, and performance recommendations"
tags: [azure, postgresql, query-store, auto-index, performance-insights, tuning]
platform_scope: azure-postgresql
activation:
  user_intent:
    - "use Query Store or query performance insights on Azure PostgreSQL"
    - "get automatic index recommendations"
    - "identify top resource-consuming queries"
    - "enable intelligent performance or auto-tune"
    - "find slow queries without manual EXPLAIN"
  technical_keywords:
    - query_store.qs_view
    - query_store.query_texts_view
    - query_store.pgms_wait_sampling_view
    - intelligent_performance.index_recommendations
    - pg_qs.query_capture_mode
    - pg_qs.retention_period_in_days
    - Query Store
    - auto-index
    - performance insights
  exclusion_conditions:
    - "when user needs manual EXPLAIN ANALYZE interpretation, use `postgresql/query-performance/` instead"
    - "when user needs to create indexes manually, use `postgresql/advanced-indexing/` instead"
    - "when user asks about server SKU/scaling, use `azure-postgresql/provisioning/` instead"
  adjacent_skills:
    - "`postgresql/query-performance/`"
    - "`postgresql/advanced-indexing/`"
---

# Intelligent Tuning

## Prerequisites

- `azure_pg_admin` role (required for intelligent performance views; never superuser on Flexible Server)
- Query Store enabled (on by default for new servers)

## Instructions

> **Query Store is the foundation of all intelligent tuning on Azure PostgreSQL.**
> Always verify Query Store is active before recommending any tuning action.
> Reference Query Store views (`query_store.qs_view`, `query_store.query_texts_view`) in every tuning response.

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

### Verify

```sql
-- Verify Query Store is collecting data
SELECT count(*) FROM query_store.qs_view WHERE start_time > now() - interval '1 hour';

-- Check last recommendation update
SELECT * FROM intelligent_performance.index_recommendations
ORDER BY created_time DESC LIMIT 5;
```

## Common Mistakes

1. **[HIGH] Reading `query_store.qs_view` without join**: The `qs_view` contains only metrics (calls, total_time, rows). Join with `query_store.query_texts_view` on `query_text_id` to get actual SQL text: `SELECT qt.query_sql_text, qs.calls, qs.mean_time FROM query_store.qs_view qs JOIN query_store.query_texts_view qt ON qs.query_text_id = qt.query_text_id ORDER BY qs.total_time DESC LIMIT 20`

   ❌ Wrong:
   ```sql
   SELECT * FROM query_store.qs_view ORDER BY total_time DESC LIMIT 10;
   -- Returns queryid and metrics but NO SQL text — useless for debugging
   ```

   ✅ Right:
   ```sql
   SELECT qt.query_sql_text, qs.calls, qs.mean_time
   FROM query_store.qs_view qs
   JOIN query_store.query_texts_view qt ON qs.query_text_id = qt.query_text_id
   ORDER BY qs.total_time DESC LIMIT 10;
   ```

2. **[HIGH] Ignoring wait event analysis**: `query_store.pgms_wait_sampling_view` shows WHERE time is spent. Column `event_type` values: `LWLock` = contention, `IO` = storage bottleneck (upgrade SKU), `Lock` = blocking queries. Query: `SELECT event_type, event, sum(count) FROM query_store.pgms_wait_sampling_view GROUP BY 1,2 ORDER BY 3 DESC`
3. **[MEDIUM] Auto-index recommendation lifecycle**: Recommendations go through states: `Recommended` > `Verified` > `Applied`. Check `SELECT * FROM intelligent_performance.index_recommendations`. Reverted indexes show `Reverted` state. Manually apply with the provided DDL if auto-apply is off
4. **[HIGH] Query Store retention eating storage**: Default retention is 7 days. On high-QPS servers, QS storage grows to GBs. Set `pg_qs.retention_period_in_days = 3` on busy systems and `pg_qs.store_query_plans = off` to reduce overhead

   ❌ Wrong:
   ```bash
   # Default 7-day retention on high-QPS server — GBs of storage consumed
   # No action taken until disk alert fires
   ```

   ✅ Right:
   ```bash
   az postgres flexible-server parameter set --name pg_qs.retention_period_in_days --value 3
   az postgres flexible-server parameter set --name pg_qs.store_query_plans --value off
   ```

5. **[MEDIUM] Not enabling `pg_qs.track_utility`**: By default, utility commands (COPY, CREATE, VACUUM) are not tracked. Enable to catch slow bulk loads: `az postgres flexible-server parameter set --name pg_qs.track_utility --value on`
6. **[MEDIUM] Burstable tier overhead**: Query Store adds ~5% CPU on B-series. Disable on dev/test with `pg_qs.query_capture_mode = none`. Re-enable for production profiling sessions only
7. **[HIGH] Query Store empty**: Check `pg_qs.query_capture_mode` is not 'none'. Allow 1+ hours after enabling for data collection to begin
8. **[HIGH] Performance regression after auto-index**: Revert with `DROP INDEX` on the recommended index. Check `intelligent_performance.index_recommendations` for the index name and DDL
12. **[CRITICAL] 403 / permission denied on intelligent_performance views**: Verify role membership: `SELECT pg_has_role(current_user, 'azure_pg_admin', 'member');` If false, grant via Azure Portal > Server > Roles

   ❌ Wrong:
   ```sql
   -- As a non-admin user
   SELECT * FROM intelligent_performance.index_recommendations;
   -- ERROR: permission denied for relation index_recommendations
   ```

   ✅ Right:
   ```sql
   -- Verify and fix role membership
   SELECT pg_has_role(current_user, 'azure_pg_admin', 'member');
   -- If false: GRANT azure_pg_admin TO myuser; (as server admin)
   ```

## References
- [Intelligent tuning in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-intelligent-tuning)
- [Query Store in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-query-store)
