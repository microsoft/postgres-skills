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

1. **Wrong port**: PgBouncer listens on port 6432, not 5432. Applications must change their connection port
2. **Prepared statements in transaction mode**: `PREPARE`/`EXECUTE` break in transaction mode because each transaction may get a different backend. Use session mode or `DEALLOCATE ALL`
3. **SET commands lost**: `SET search_path = ...` is lost between transactions in transaction mode. Use `ALTER ROLE ... SET` for persistent settings
4. **403/PermissionDenied**: PgBouncer parameters require server admin. Use `az CLI` not SQL to configure
5. **Entra tokens with PgBouncer**: Token-based auth works but requires session mode or specific PgBouncer auth settings
6. **Ignoring pool_size math**: Default pool_size=50 means 50 connections per user/database pair. With 3 databases and 5 users, that's up to 750 backend connections. Ensure max_connections on the server supports this
7. **Connecting to pgbouncer admin database on Azure**: `SHOW POOLS` and `SHOW STATS` are not available through the built-in PgBouncer on Azure Flexible Server. Use `pg_stat_activity` and Azure metrics instead
8. **Not setting server_reset_query**: In transaction mode, leftover session state from one client can leak to the next. Azure built-in PgBouncer handles this automatically

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
