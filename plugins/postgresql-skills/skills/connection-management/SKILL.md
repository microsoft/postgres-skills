---
name: connection-management
description: "PostgreSQL connection lifecycle, pooling strategies, idle timeout tuning, and connection exhaustion prevention"
tags: [postgresql, connections, pooling, pgbouncer, timeout]
platform_scope: postgresql
activation:
  user_intent:
    - "too many connections error"
    - "how to set up connection pooling"
    - "PgBouncer configuration"
    - "slow connection establishment or high connection churn"
    - "tune max_connections or idle timeouts"
    - "serverless functions exhausting connection limits"
  technical_keywords:
    - "FATAL: sorry, too many clients already"
    - "too many connections"
    - max_connections
    - idle_in_transaction_session_timeout
    - idle_session_timeout
    - PgBouncer
    - pgpool
    - pg_stat_activity
    - pg_terminate_backend
  exclusion_conditions:
    - "when issue is query performance not connection overhead, use `postgresql/query-performance/` instead"
  adjacent_skills:
    - "`postgresql/query-performance/`"
---

# Connection Management

## Instructions

**Step 1: Diagnose connection state**

```sql
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;

SELECT pid, now() - state_change AS idle_time, query, application_name
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY idle_time DESC;
```

**Step 2: Safety timeouts**

```sql
ALTER DATABASE mydb SET idle_in_transaction_session_timeout = '5min';
ALTER DATABASE mydb SET idle_session_timeout = '30min';  -- PG 14+
```

> On managed PG: use `ALTER DATABASE` or portal. `ALTER SYSTEM SET` is unavailable.

**Step 3: max_connections formula**

```
max_connections = 2-4x CPU cores (OLTP)
Each connection ≈ 5-10MB RAM (work_mem + sort buffers)
total_app_connections = pool_size_per_instance × num_instances
```

> `max_connections` is postmaster-level — requires restart. Cannot use `SET`.

**Step 4: Pooling decision tree**

- **< 50 connections**: No pooler
- **50-200 + simple queries**: PgBouncer transaction mode
- **> 200 or serverless**: External pooler required
- **Prepared statements needed**: PgBouncer session mode OR PG 14+ protocol-level prepared statements

### Verify

```sql
-- Verify timeout settings
SHOW idle_in_transaction_session_timeout;
SHOW idle_session_timeout;

-- Monitor connection headroom
SELECT count(*) AS active, 
       (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
FROM pg_stat_activity;
```

## Common Mistakes

1. **[HIGH] Session-mode pooling with serverless**: Session mode holds connections open per client. Use transaction mode for Lambda/Cloud Functions

   ❌ Wrong:
   ```ini
   ; pgbouncer.ini — session mode with serverless
   pool_mode = session
   ```

   ✅ Right:
   ```ini
   ; pgbouncer.ini — transaction mode for serverless
   pool_mode = transaction
   server_reset_query = DEALLOCATE ALL; DISCARD ALL;
   ```

2. **[CRITICAL] Transaction-mode pooling breaks prepared statements**: PgBouncer transaction mode cannot route `PREPARE`/`EXECUTE` across backends

   ❌ Wrong:
   ```sql
   -- App uses PREPARE then EXECUTE across pooled connections
   PREPARE get_user(int) AS SELECT * FROM users WHERE id = $1;
   EXECUTE get_user(42);  -- may hit different backend
   ```

   ✅ Right:
   ```ini
   ; pgbouncer.ini — add DEALLOCATE ALL to reset query
   server_reset_query = DEALLOCATE ALL; DISCARD ALL; RESET ALL;
   ; OR use session mode if prepared statements are critical
   ```

3. **[HIGH] Application pool per-process adds up**: HikariCP pool_size=10 across 20 pods = 200 server connections. Calculate: `total = pool_size_per_instance × num_instances`. Use server-side pooler as central bottleneck

4. **[CRITICAL] Missing `idle_in_transaction_session_timeout`**: Crashed clients leave open transactions holding locks and preventing VACUUM

   ❌ Wrong:
   ```sql
   -- No timeout set; crashed client blocks VACUUM indefinitely
   ```

   ✅ Right:
   ```sql
   ALTER DATABASE mydb SET idle_in_transaction_session_timeout = '5min';
   ```

5. **[MEDIUM] `idle_session_timeout` (PG 14+) not used**: Idle connections consume backend slots. Set to 30min for non-pooled connections

6. **[MEDIUM] Using `ALTER SYSTEM SET` on managed PostgreSQL**: Unavailable on Azure/RDS/Cloud SQL. Use `ALTER DATABASE` or server parameters UI

7. **[MEDIUM] Using `SET` for postmaster-level params**: `SET max_connections` has no effect. Requires restart via portal/CLI

8. **[HIGH] Connection storm after restart**: All instances reconnect simultaneously. Use exponential backoff with jitter; set PgBouncer `min_pool_size` to pre-warm

9. **[MEDIUM] "too many clients" emergency**: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND now() - state_change > interval '10 min'`

10. **[MEDIUM] Permission denied on pg_terminate_backend**: Requires `pg_signal_backend` role. On Azure, `azure_pg_admin` has this
