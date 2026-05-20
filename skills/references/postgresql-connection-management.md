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

## When to use this skill

Use for production PostgreSQL issues involving:
- "too many clients" errors or connection exhaustion
- PgBouncer mode selection (session vs transaction)
- Prepared statements broken by transaction-mode pooling
- Idle connections holding locks/preventing VACUUM
- Serverless connection patterns (Lambda, Cloud Functions)

Include diagnostic queries and connection pool configuration examples. Focus on production failure modes and Azure-specific connection limits.

## Response focus

Prioritize pooling mode tradeoffs, production failure modes, and managed-service constraints. The base model knows basic connection diagnostics well.

## High-value reminders

- `max_connections` is postmaster-level — requires restart and superuser or platform admin role; cannot use `SET` or `ALTER SYSTEM` on managed services
- `idle_in_transaction_session_timeout` prevents crashed clients from holding locks indefinitely
- PgBouncer transaction mode breaks `PREPARE`/`EXECUTE` across backends
- Total connections = `pool_size_per_instance × num_instances` — easy to exceed limits

## Pool Sizing Formula

**Server-side max_connections:**
- OLTP: `4 × vCPUs` (e.g., 8 vCPU = 32 connections)
- Mixed workload: `2 × vCPUs + 5` (for background workers)
- Memory check: `max_connections × work_mem` must fit in RAM. 100 connections × 256MB work_mem = 25GB (likely OOM)

**PgBouncer pool_size:**
- `pool_size = max_connections × 0.8` (reserve 20% for admin/monitoring)
- `max_client_conn = pool_size × 10` (10:1 multiplexing ratio is safe for transaction mode)

**Red flags:**
- `max_connections > 500` without PgBouncer = degraded performance
- `pool_size > max_connections` = PgBouncer can't actually use all slots
- Client `CONN_MAX_AGE=0` (Django default) = reconnect every request, defeats pooling

## Pooling decision tree

- **< 50 connections**: No pooler needed
- **50-200 + simple queries**: PgBouncer transaction mode
- **> 200 or serverless**: External pooler required
- **Prepared statements needed**: PgBouncer session mode OR PG 14+ protocol-level prepared statements

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

10. **[MEDIUM] Permission denied on pg_terminate_backend**: Requires `pg_signal_backend` role or superuser/platform admin role
11. **[HIGH] Async app connection leak**: Exceptions in Node.js or asyncio code can skip `pool.release()`. Always use `try/finally` or context managers
12. **[MEDIUM] `statement_timeout` vs connection timeout confusion**: `statement_timeout` cancels a running query; `connect_timeout` only limits initial TCP connect time
13. **[MEDIUM] `max_connections` sizing**: Rough OLTP baseline is ~4× vCPUs. Jumping to 500+ without PgBouncer often OOMs from per-connection memory overhead

## Guardrails

- Do NOT claim `max_connections` can be changed with `SET` or `ALTER SYSTEM` on managed services — it requires server restart via portal/CLI
- Do NOT recommend connection counts above 500 without PgBouncer — PostgreSQL process-per-connection model degrades rapidly
- Do NOT claim PgBouncer transaction mode supports prepared statements natively
- If user's exact managed service is unknown, caveat with "check your provider's max_connections limits"
