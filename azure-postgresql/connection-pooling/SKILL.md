---
name: connection-pooling
description: "Configure Azure Database for PostgreSQL Flexible Server built-in PgBouncer: transaction vs session mode, port 6432, and pool sizing"
version: "1.0.0"
tags: [azure, postgresql, pgbouncer, connection-pooling, port-6432]
execution_mode: mutate
requires_confirmation: true
platform_scope: azure-postgresql
---

# Connection Pooling (Built-in PgBouncer)

## When to Use

**Trigger when:**
- User asks about PgBouncer on Azure PostgreSQL
- User needs connection pooling for serverless or high-connection workloads
- User mentions port 6432 or "built-in pooler"
- Error: "too many connections" on Azure Flexible Server
- User asks about transaction vs session pooling mode

**Do NOT use when:**
- User needs general PostgreSQL connection management theory (use `postgresql/connection-management/`)
- User runs self-managed PgBouncer outside Azure (use `postgresql/connection-management/`)
- User needs auth configuration (use `azure-postgresql/entra-id-auth/`)

**Overlaps with:**
- `postgresql/connection-management/` (general pooling concepts)
- `azure-postgresql/entra-id-auth/` (token passthrough with PgBouncer)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Application can switch to port 6432

## Instructions

**Step 1: Enable built-in PgBouncer**

```bash
az postgres flexible-server parameter set \
    --resource-group myRG --server-name myserver \
    --name pgbouncer.enabled --value true
```

**Step 2: Choose pooling mode**

| Mode | Behavior | Use Case |
|------|----------|----------|
| transaction (default) | Connection returned after each transaction | Most apps, serverless |
| session | Connection held for entire session | Prepared statements, SET commands |

```bash
# Set transaction mode (recommended)
az postgres flexible-server parameter set \
    --resource-group myRG --server-name myserver \
    --name pgbouncer.default_pool_mode --value transaction
```

**Step 3: Connect through PgBouncer**

```bash
# Use port 6432 (not 5432)
psql "host=myserver.postgres.database.azure.com port=6432 \
    dbname=postgres user=myadmin sslmode=require"
```

**Step 4: Tune pool size**

```bash
# Default pool size per user/database pair
az postgres flexible-server parameter set \
    --resource-group myRG --server-name myserver \
    --name pgbouncer.default_pool_size --value 50

# Max client connections to PgBouncer
az postgres flexible-server parameter set \
    --resource-group myRG --server-name myserver \
    --name pgbouncer.max_client_conn --value 5000
```

## Common Mistakes

1. **`pgbouncer.*` parameter namespace**: All PgBouncer settings use server parameters prefixed with `pgbouncer.`. Set via: `az postgres flexible-server parameter set --name pgbouncer.default_pool_size --value 50`. NOT via SQL `SHOW` commands
2. **Port 6432 is mandatory**: Built-in PgBouncer always listens on 6432. Cannot change it. Connection strings MUST use port 6432. Using 5432 bypasses PgBouncer entirely (direct to PostgreSQL)
3. **Pool math overflow**: `default_pool_size` (default=50) applies per user/database pair. Formula: `max_backend_connections = default_pool_size * num_databases * num_users`. Set `pgbouncer.max_client_conn = 5000` and verify `max_connections` on the backend supports the pool's demand
4. **Entra token + transaction mode conflict**: Transaction mode reassigns backends per transaction but Entra tokens bind to the original auth handshake. Use `pgbouncer.pool_mode = session` when ANY client uses token auth, or route token clients to port 5432 directly
5. **`SHOW POOLS` unavailable**: Azure built-in PgBouncer does NOT expose the admin console. No `SHOW POOLS`, `SHOW STATS`, `SHOW CLIENTS`. Use `pg_stat_activity` (shows backend connections) and Azure Monitor metrics (`pgbouncer_active_connections`, `pgbouncer_waiting_connections`) instead
6. **Prepared statement workaround**: Transaction mode breaks server-side prepared statements. Solutions: (a) `pgbouncer.pool_mode = session` for that user, (b) client-side prepared statements, (c) `DEALLOCATE ALL` at transaction start
7. **Connection storm recovery**: When PgBouncer queue fills (`pgbouncer.max_client_conn` reached), new connections get `ERROR: no more connections allowed`. Add exponential backoff with jitter in application retry logic. Monitor `pgbouncer_waiting_connections` metric for early warning
8. **Session-level state leakage**: `SET statement_timeout` in one transaction leaks to the next client in transaction mode. Azure's built-in PgBouncer runs `DISCARD ALL` as `server_reset_query` automatically, but custom GUCs set with `SET LOCAL` only are safe

## Verification

```bash
# Verify PgBouncer is enabled
az postgres flexible-server parameter show \
    --resource-group myRG --server-name myserver \
    --name pgbouncer.enabled --query value

# Test connection through PgBouncer
psql "host=myserver.postgres.database.azure.com port=6432 \
    dbname=postgres user=myadmin sslmode=require" \
    -c "SELECT 1;"
```

```sql
-- Check pool stats (connect to pgbouncer database)
-- psql -p 6432 -d pgbouncer -c "SHOW POOLS;"
```

## Failure Recovery

- **Connection refused on 6432**: Verify PgBouncer is enabled via az CLI parameter check
- **Prepared statement errors**: Switch to session mode or remove PREPARE/EXECUTE from queries
- **Pool exhaustion**: Increase `default_pool_size` or reduce application connection hold time
