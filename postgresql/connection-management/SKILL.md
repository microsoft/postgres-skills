---
name: connection-management
description: "PostgreSQL connection lifecycle, pooling strategies, idle timeout tuning, and connection exhaustion prevention"
version: "1.0.0"
tags: [postgresql, connections, pooling, pgbouncer, timeout]
execution_mode: read
requires_confirmation: false
platform_scope: postgresql
---

# Connection Management

## When to Use

**Trigger when:**
- Error: "too many connections" or "FATAL: sorry, too many clients already"
- User asks about connection pooling, PgBouncer, or pgpool
- Application has slow connection establishment or high connection churn
- User asks about `max_connections`, `idle_in_transaction_session_timeout`
- Serverless/Lambda functions exhausting connection limits

**Do NOT use when:**
- User needs Azure-specific built-in PgBouncer setup (use `azure-postgresql/connection-pooling/`)
- Issue is query performance not connection overhead (use `postgresql/query-performance/`)
- User needs auth/SSL configuration (use `azure-postgresql/networking-ssl/`)

**Overlaps with:**
- `azure-postgresql/connection-pooling/` (Azure built-in PgBouncer)
- `postgresql/query-performance/` (idle connections consuming resources)

## Prerequisites

- `psql` or MCP `execute_sql` tool
- Access to `pg_stat_activity` for connection diagnostics

## Instructions

**Step 1: Diagnose current connection usage**

```sql
-- Current connection count by state
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;

-- Identify idle connections holding resources
SELECT pid, now() - state_change AS idle_time, query, application_name
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY idle_time DESC;
```

**Step 2: Set safety timeouts**

```sql
-- Kill connections idle in transaction for > 5 minutes
ALTER SYSTEM SET idle_in_transaction_session_timeout = '5min';

-- Kill completely idle connections after 30 minutes
ALTER SYSTEM SET idle_session_timeout = '30min';  -- PostgreSQL 14+

SELECT pg_reload_conf();
```

**Step 3: Right-size max_connections**

Rule of thumb: `max_connections` = 2-4x CPU cores for OLTP workloads. Higher values increase lock contention and memory usage.

```sql
SHOW max_connections;  -- Default: 100
-- Each connection uses ~5-10MB RAM (work_mem + sort buffers)
```

**Step 4: Connection pooling decision tree**

- **< 50 connections**: No pooler needed
- **50-200 connections + simple queries**: Transaction-mode pooling (PgBouncer)
- **> 200 connections or serverless**: External pooler required (PgBouncer, pgpool-II)

## Common Mistakes

1. **Setting max_connections = 1000**: Each connection uses RAM and CPU context switches. Use a pooler instead
2. **Session-mode pooling with serverless**: Session mode holds connections open. Use transaction mode for short-lived requests
3. **No idle timeout**: Idle connections accumulate overnight from crashed clients. Always set `idle_in_transaction_session_timeout`
4. **Application-level pooling alone**: Libraries like HikariCP/SQLAlchemy pool per-process. With multiple pods, you still need a server-side pooler

## Verification

```sql
-- Verify timeout settings
SHOW idle_in_transaction_session_timeout;
SHOW idle_session_timeout;

-- Monitor connection headroom
SELECT count(*) AS active, 
       (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_conn
FROM pg_stat_activity;
```

## Failure Recovery

- **"too many clients" error**: Terminate idle connections: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND now() - state_change > interval '10 min'`
- **Cannot change max_connections**: Requires restart. Use pooler as immediate fix
- **Pooler breaks prepared statements**: Switch from transaction to session mode, or use `DEALLOCATE ALL` in pool reset query
