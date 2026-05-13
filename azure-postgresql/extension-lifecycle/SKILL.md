---
name: extension-lifecycle
description: "Manage PostgreSQL extensions on Azure Database for PostgreSQL Flexible Server: allowlisting, shared_preload_libraries, CREATE EXTENSION, and version upgrades"
version: "1.0.0"
tags: [azure, postgresql, extensions, allowlist, shared-preload, pgvector]
execution_mode: mutate
requires_confirmation: true
platform_scope: azure-postgresql
---

# Extension Lifecycle

## When to Use

**Trigger when:**
- User asks "how to install an extension" on Azure PostgreSQL
- Error: "extension is not allowlisted" or "must be preloaded"
- User mentions `CREATE EXTENSION`, `shared_preload_libraries`, or extension names (vector, pg_stat_statements, pg_cron)
- User needs to upgrade an extension version
- User asks which extensions are available

**Do NOT use when:**
- User asks about azure_ai extension specifically (use `azure-postgresql/azure-ai-extension/`)
- User needs general CREATE INDEX patterns (use `postgresql/advanced-indexing/`)
- User asks about custom/community extensions not in the Azure allowlist (not supported)

**Overlaps with:**
- `azure-postgresql/azure-ai-extension/` (specific azure_ai extension setup)
- `postgresql/advanced-indexing/` (extensions like btree_gin, btree_gist)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- `azure_pg_admin` role (default admin role; never superuser)
- `az CLI` or Azure Portal access for server parameters
- MCP `execute_sql` tool or `psql`

## Instructions

**Step 1: Check if extension is available**

```sql
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'vector'
ORDER BY name;
```

**Step 2: Allowlist the extension (Azure-specific requirement)**

```bash
# Add to azure.extensions server parameter
az postgres flexible-server parameter set \
    --resource-group myRG --server-name myserver \
    --name azure.extensions --value "vector,pg_stat_statements,pg_cron"
```

> WARNING: This overwrites the current list. Always GET current value first and append.

**Step 3: For extensions requiring preload (pg_stat_statements, pg_cron, auto_explain)**

```bash
# Requires server RESTART
az postgres flexible-server parameter set \
    --resource-group myRG --server-name myserver \
    --name shared_preload_libraries --value "pg_stat_statements,pg_cron"

az postgres flexible-server restart --resource-group myRG --name myserver
```

**Step 4: Create the extension**

```sql
-- Use binary name, not marketing name
CREATE EXTENSION vector;           -- NOT pgvector
CREATE EXTENSION pg_stat_statements;
CREATE EXTENSION azure_ai;
```

**Step 5: Upgrade an extension**

```sql
ALTER EXTENSION vector UPDATE TO '0.8.0';
```

## Common Mistakes

1. **Using marketing name**: `CREATE EXTENSION pgvector` fails. Use the binary name: `CREATE EXTENSION vector`
2. **Forgetting allowlist**: Extension must be in `azure.extensions` parameter before CREATE EXTENSION works
3. **No restart after preload change**: `shared_preload_libraries` requires server restart to take effect
4. **Overwriting allowlist**: `az parameter set --value "new_ext"` replaces the entire list. Always GET current value first and append
5. **403/PermissionDenied**: You have `azure_pg_admin` role, not superuser. Some extensions (e.g., file_fdw, adminpack) are not available on Azure
6. **Attempting DROP EXTENSION CASCADE**: Safe on dev, but on production Azure databases check dependencies first with `SELECT * FROM pg_depend WHERE deptype = 'e'`
7. **Version pinning forgotten**: `CREATE EXTENSION vector VERSION '0.7.0'` ensures deterministic builds. Without it, the server's default_version is used which may differ between environments
8. **Extensions not available on Azure**: `pg_cron`, `pg_partman`, `pgvector`, `postgis`, `pg_stat_statements` ARE available. `file_fdw`, `dblink to external`, `plpython3u` are NOT
9. **Ignoring `SELECT * FROM pg_available_extensions`**: This shows the exact version available on your server. Don't assume a version exists just because docs mention it

## Verification

```sql
-- Confirm extension installed
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- List all installed extensions
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- Verify shared_preload_libraries
SHOW shared_preload_libraries;
```

## Failure Recovery

- **"extension not allowlisted"**: Run Step 2 to add to azure.extensions parameter
- **"must be loaded via shared_preload_libraries"**: Run Step 3 and restart the server
- **Extension version mismatch**: Use `ALTER EXTENSION ... UPDATE TO 'version'` to align
