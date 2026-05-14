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
- User asks about azure_ai extension specifically (use `azure-postgresql/azure-ai/`)
- User needs general CREATE INDEX patterns (use `postgresql/advanced-indexing/`)
- User asks about custom/community extensions not in the Azure allowlist (not supported)

**Overlaps with:**
- `azure-postgresql/azure-ai/` (specific azure_ai extension setup)
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

1. **Allowlist append workflow (critical)**: `az postgres flexible-server parameter show --name azure.extensions` returns current list. You must append, not replace: `az postgres flexible-server parameter set --name azure.extensions --value "vector,pg_diskann,pg_trgm,NEW_EXT"`. Setting `--value "NEW_EXT"` alone REMOVES all existing extensions
2. **`shared_preload_libraries` restart behavior**: Adding to this parameter requires server restart. Plan maintenance window. Current value check: `SHOW shared_preload_libraries`. Common values needing preload: `pg_cron`, `pg_stat_statements`, `auto_explain`
3. **Binary name vs marketing name mapping**: `pgvector` → `CREATE EXTENSION vector`. `pg_partman` → `CREATE EXTENSION pg_partman`. `PostGIS` → `CREATE EXTENSION postgis`. Always verify with `SELECT * FROM pg_available_extensions WHERE name LIKE '%search%'`
4. **Version pinning for reproducibility**: `CREATE EXTENSION vector VERSION '0.7.0'` ensures same version across environments. Without version, server's `default_version` is used which auto-updates with server patches. Pin in migration scripts
5. **Extension availability matrix**: Available: `vector`, `pg_diskann`, `postgis`, `pg_cron`, `pg_partman`, `pg_stat_statements`, `pg_trgm`, `hstore`, `uuid-ossp`, `azure_ai`. NOT available: `file_fdw`, `plpython3u`, `adminpack`, `dblink` (to external). Check: `SELECT * FROM pg_available_extensions ORDER BY name`
6. **`azure_pg_admin` role limitations**: You have `azure_pg_admin`, not superuser. Cannot: `CREATE EXTENSION` for unlisted extensions, load custom C libraries, modify `pg_hba.conf`. Can: create any extension in the allowlist, manage roles, create databases
7. **Dependency checking before DROP**: `SELECT classid::regclass, objid, deptype FROM pg_depend WHERE refobjid = (SELECT oid FROM pg_extension WHERE extname = 'vector')` shows what depends on the extension. CASCADE drops all dependent objects (indexes, columns)
8. **Extension update path**: `ALTER EXTENSION vector UPDATE TO '0.8.0'` only works if update path exists. Check: `SELECT * FROM pg_extension_update_paths('vector') WHERE source = '0.7.0'`. Some updates require DROP + CREATE (data loss for extension-managed types)

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
