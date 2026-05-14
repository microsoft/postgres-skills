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

For self-managed PostgreSQL:
```sql
-- Kill connections idle in transaction for > 5 minutes
ALTER DATABASE mydb SET idle_in_transaction_session_timeout = '5min';

-- Kill completely idle connections after 30 minutes (PostgreSQL 14+)
ALTER DATABASE mydb SET idle_session_timeout = '30min';
```

For managed PostgreSQL (Azure, RDS, etc.) use `ALTER DATABASE` or the cloud portal server parameters page. Do NOT use `ALTER SYSTEM SET` (unavailable on managed services).

**Step 3: Right-size max_connections**

Rule of thumb: `max_connections` = 2-4x CPU cores for OLTP workloads. Higher values increase lock contention and memory usage.

```sql
SHOW max_connections;  -- Default: 100
-- Each connection uses ~5-10MB RAM (work_mem + sort buffers)
```

> **⚠️ `max_connections` and `shared_buffers` are postmaster-level parameters** requiring a server restart.
> `SET` and `ALTER SYSTEM` do not work for these on managed services. On Azure Flexible Server,
> change them via the **Server Parameters** blade in the portal or `az postgres flexible-server parameter set`.

**Step 4: Connection pooling decision tree**

- **< 50 connections**: No pooler needed
- **50-200 connections + simple queries**: Transaction-mode pooling (PgBouncer)
- **> 200 connections or serverless**: External pooler required (PgBouncer, pgpool-II)

## Common Mistakes

1. **Session-mode pooling with serverless**: Session mode holds connections open per client. Use transaction mode for Lambda/Cloud Functions: connections return to pool after each transaction
2. **Transaction-mode pooling breaks prepared statements**: PgBouncer transaction mode cannot route `PREPARE`/`EXECUTE` across different backends. Fix: use `DEALLOCATE ALL` in `server_reset_query`, or switch to session mode, or use protocol-level prepared statements (PG 14+ `statement_timeout` setting in pgbouncer.ini)
3. **Application pool per-process adds up**: HikariCP pool_size=10 across 20 pods = 200 server connections. Always calculate: `total = pool_size_per_instance × num_instances`. Set server-side pooler as central bottleneck
4. **Missing `idle_in_transaction_session_timeout`**: Crashed clients leave open transactions that hold locks and prevent VACUUM. Always set: `ALTER DATABASE mydb SET idle_in_transaction_session_timeout = '5min'`
5. **`idle_session_timeout` (PG 14+) not used**: Completely idle connections (not in transaction) still consume a backend slot. Set to 30min for non-pooled connections to auto-reclaim slots
6. **Using `ALTER SYSTEM SET` on managed PostgreSQL**: This command is unavailable on Azure/RDS/Cloud SQL. Use `ALTER DATABASE` or the server parameters UI instead
7. **Using `SET` for postmaster-level params**: `SET max_connections` or `SET shared_buffers` has no effect (session-level SET only works for runtime parameters). These require a server restart. Change via portal or CLI on managed services
7. **Connection storm after restart**: All app instances reconnect simultaneously. Use exponential backoff with jitter in connection retry logic, and set PgBouncer `min_pool_size` to pre-warm connections

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
- **idle_in_transaction connections accumulating**: Set `idle_in_transaction_session_timeout = '30s'` at database level: `ALTER DATABASE mydb SET idle_in_transaction_session_timeout = '30s';`
- **Permission denied on pg_terminate_backend**: Requires `pg_signal_backend` role or ownership of the backend's session. On Azure, `azure_pg_admin` has this privilege
