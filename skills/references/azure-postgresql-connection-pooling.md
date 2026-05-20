---
name: connection-pooling
description: "Configure Azure Database for PostgreSQL Flexible Server built-in PgBouncer: transaction vs session mode, port 6432, and pool sizing"
tags: [azure, postgresql, pgbouncer, connection-pooling, port-6432]
platform_scope: azure-postgresql
activation:
  user_intent:
    - "configure PgBouncer on Azure PostgreSQL"
    - "set up connection pooling for serverless or high-connection workloads"
    - "connect on port 6432 or use built-in pooler"
    - "fix too many connections error on Azure Flexible Server"
    - "choose between transaction and session pooling mode"
  technical_keywords:
    - pgbouncer.enabled
    - pgbouncer.default_pool_mode
    - pgbouncer.default_pool_size
    - pgbouncer.max_client_conn
    - port 6432
    - "too many connections"
    - transaction mode
    - session mode
  exclusion_conditions:
    - "when user needs auth configuration, use `azure-postgresql/entra-id-auth/` instead"
  adjacent_skills:
    - "`azure-postgresql/entra-id-auth/`"
---

# Connection Pooling (Built-in PgBouncer)

## When to use this skill

Use for Azure PostgreSQL built-in PgBouncer issues involving:
- Port 6432 configuration and connection routing
- Transaction vs session mode tradeoffs
- Entra token + pooling conflicts
- Prepared statement failures in transaction mode
- Pool math overflow

Avoid explaining generic PgBouncer concepts or basic `az parameter set` commands. Focus on Azure-specific behavior and failure modes.

> **Shell execution:** Pool mode and parameter changes require az CLI. Execute directly via shell. Read pool status via `pgsql_query` against `pg_stat_activity`.

## Key Facts (what models get wrong)

| Fact | Detail |
|------|--------|
| Port 6432 is mandatory | Built-in PgBouncer always on port 6432. Cannot change. Port 5432 bypasses pooler entirely |
| No admin console | Azure built-in PgBouncer does NOT expose `SHOW POOLS`, `SHOW STATS`, `SHOW CLIENTS` |
| Entra tokens need session mode | Transaction mode breaks token auth (auth context is per-connection, not per-transaction) |
| Pool math | `max_backend_connections = default_pool_size × num_databases × num_users`. Easy to exceed `max_connections` |
| DISCARD ALL runs automatically | Azure's built-in PgBouncer runs `DISCARD ALL` as `server_reset_query` in transaction mode |
| Session state leaks in txn mode | `SET statement_timeout` leaks across clients. Only `SET LOCAL` is safe |
| Prepared statements break | Transaction mode cannot route `PREPARE`/`EXECUTE` across backends |

## Common Mistakes

1. **[HIGH] Port 6432 is mandatory**: Built-in PgBouncer always listens on 6432. Cannot change it. Connection strings MUST use port 6432. Using 5432 bypasses PgBouncer entirely (direct to PostgreSQL)

   Wrong:
   ```bash
   psql "host=myserver.postgres.database.azure.com port=5432 dbname=postgres"
   # Connects directly to PostgreSQL PgBouncer bypassed entirely
   ```

   Right:
   ```bash
   psql "host=myserver.postgres.database.azure.com port=6432 dbname=postgres"
   # Routes through PgBouncer for connection pooling
   ```

3. **[HIGH] Pool math overflow**: `default_pool_size` (default=50) applies per user/database pair. Formula: `max_backend_connections = default_pool_size * num_databases * num_users`. Set `pgbouncer.max_client_conn = 5000` and verify `max_connections` on the backend supports the pool's demand
4. **[CRITICAL] Entra token + transaction mode conflict**: Transaction mode reassigns backends per transaction but Entra tokens bind to the original auth handshake. Use `pgbouncer.pool_mode = session` when ANY client uses token auth, or route token clients to port 5432 directly

   Wrong:
   ```bash
   # Transaction mode + Entra token auth = auth failures
   az postgres flexible-server parameter set --name pgbouncer.default_pool_mode --value transaction
   # Then connect with Entra token FATAL: password authentication failed
   ```

   Right:
   ```bash
   # Use session mode when ANY client uses token auth
   az postgres flexible-server parameter set --name pgbouncer.default_pool_mode --value session
   ```

5. **[MEDIUM] `SHOW POOLS` unavailable**: Azure built-in PgBouncer does NOT expose the admin console. No `SHOW POOLS`, `SHOW STATS`, `SHOW CLIENTS`. Use `pg_stat_activity` (shows backend connections) and Azure Monitor metrics (`pgbouncer_active_connections`, `pgbouncer_waiting_connections`) instead
6. **[HIGH] Prepared statement workaround**: Transaction mode breaks server-side prepared statements. Solutions: (a) `pgbouncer.pool_mode = session` for that user, (b) client-side prepared statements, (c) `DEALLOCATE ALL` at transaction start

   Wrong:
   ```sql
   -- In transaction mode, prepared statements break across transactions
   PREPARE my_query AS SELECT * FROM users WHERE id = $1;
   EXECUTE my_query(1);  -- may fail: prepared statement does not exist
   ```

   Right:
   ```sql
   -- Use SET LOCAL or client-side prepared statements in transaction mode
   DEALLOCATE ALL;  -- at transaction start to clear stale state
   ```

7. **[HIGH] Connection storm recovery**: When PgBouncer queue fills (`pgbouncer.max_client_conn` reached), new connections get `ERROR: no more connections allowed`. Add exponential backoff with jitter in application retry logic. Monitor `pgbouncer_waiting_connections` metric for early warning
8. **[HIGH] Session-level state leakage**: `SET statement_timeout` in one transaction leaks to the next client in transaction mode. Azure's built-in PgBouncer runs `DISCARD ALL` as `server_reset_query` automatically, but custom GUCs set with `SET LOCAL` only are safe

## References
- [PgBouncer in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-pgbouncer)
- [Connection pooling best practices](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-connection-pooling-best-practices)