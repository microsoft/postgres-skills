---
name: extension-lifecycle
description: "Manage PostgreSQL extensions on Azure Database for PostgreSQL Flexible Server: allowlisting, shared_preload_libraries, CREATE EXTENSION, and version upgrades"
tags: [azure, postgresql, extensions, allowlist, shared-preload, pgvector]
platform_scope: azure-postgresql
activation:
  user_intent:
    - "install an extension on Azure PostgreSQL"
    - "fix extension is not allowlisted error"
    - "fix must be preloaded error"
    - "use CREATE EXTENSION or shared_preload_libraries"
    - "upgrade an extension version"
    - "check which extensions are available on Azure"
  technical_keywords:
    - CREATE EXTENSION
    - ALTER EXTENSION
    - azure.extensions
    - shared_preload_libraries
    - pg_available_extensions
    - allowlist
    - vector
    - pg_stat_statements
    - pg_cron
    - azure_pg_admin
    - "extension is not allowlisted"
    - "must be loaded via shared_preload_libraries"
  exclusion_conditions:
    - "when user asks about azure_ai extension specifically, use `azure-postgresql/azure-ai/` instead"
    - "when user asks about custom/community extensions not in the Azure allowlist, not supported"
  adjacent_skills:
    - "`azure-postgresql/azure-ai/`"
---

# Extension Lifecycle

## Prerequisites

- `azure_pg_admin` role (default admin role; never superuser)

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

### Verify

```sql
-- Confirm extension installed
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- List all installed extensions
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- Verify shared_preload_libraries
SHOW shared_preload_libraries;
```

## Common Mistakes

1. **[CRITICAL] Allowlist append workflow**: `az postgres flexible-server parameter show --name azure.extensions` returns current list. You must append, not replace: `az postgres flexible-server parameter set --name azure.extensions --value "vector,pg_diskann,pg_trgm,NEW_EXT"`. Setting `--value "NEW_EXT"` alone REMOVES all existing extensions

   ❌ Wrong:
   ```bash
   # OVERWRITES entire list — removes all other extensions!
   az postgres flexible-server parameter set --name azure.extensions --value "pg_cron"
   ```

   ✅ Right:
   ```bash
   # First GET current list, then APPEND
   az postgres flexible-server parameter show --name azure.extensions --query value
   # Returns: "vector,pg_stat_statements"
   az postgres flexible-server parameter set --name azure.extensions --value "vector,pg_stat_statements,pg_cron"
   ```

2. **[HIGH] `shared_preload_libraries` restart behavior**: Adding to this parameter requires server restart. Plan maintenance window. Current value check: `SHOW shared_preload_libraries`. Common values needing preload: `pg_cron`, `pg_stat_statements`, `auto_explain`
3. **[HIGH] Binary name vs marketing name mapping**: `pgvector` → `CREATE EXTENSION vector`. `pg_partman` → `CREATE EXTENSION pg_partman`. `PostGIS` → `CREATE EXTENSION postgis`. Always verify with `SELECT * FROM pg_available_extensions WHERE name LIKE '%search%'`

   ❌ Wrong:
   ```sql
   CREATE EXTENSION pgvector;
   -- ERROR: extension "pgvector" is not available
   ```

   ✅ Right:
   ```sql
   CREATE EXTENSION vector;  -- binary name, not marketing name
   ```

4. **[MEDIUM] Version pinning for reproducibility**: `CREATE EXTENSION vector VERSION '0.7.0'` ensures same version across environments. Without version, server's `default_version` is used which auto-updates with server patches. Pin in migration scripts
5. **[MEDIUM] Extension availability matrix**: Available: `vector`, `pg_diskann`, `postgis`, `pg_cron`, `pg_partman`, `pg_stat_statements`, `pg_trgm`, `hstore`, `uuid-ossp`, `azure_ai`. NOT available: `file_fdw`, `plpython3u`, `adminpack`, `dblink` (to external). Check: `SELECT * FROM pg_available_extensions ORDER BY name`
6. **[HIGH] `azure_pg_admin` role limitations**: You have `azure_pg_admin`, not superuser. Cannot: `CREATE EXTENSION` for unlisted extensions, load custom C libraries, modify `pg_hba.conf`. Can: create any extension in the allowlist, manage roles, create databases

   ❌ Wrong:
   ```sql
   -- Attempting superuser-only operations
   ALTER SYSTEM SET shared_preload_libraries = 'pg_cron';
   -- ERROR: must be superuser to execute this command
   ```

   ✅ Right:
   ```bash
   # Use Azure CLI for postmaster-level GUCs
   az postgres flexible-server parameter set --name shared_preload_libraries --value "pg_cron"
   az postgres flexible-server restart --resource-group myRG --name myserver
   ```

7. **[CRITICAL] Dependency checking before DROP**: `SELECT classid::regclass, objid, deptype FROM pg_depend WHERE refobjid = (SELECT oid FROM pg_extension WHERE extname = 'vector')` shows what depends on the extension. CASCADE drops all dependent objects (indexes, columns)
8. **[HIGH] Extension update path**: `ALTER EXTENSION vector UPDATE TO '0.8.0'` only works if update path exists. Check: `SELECT * FROM pg_extension_update_paths('vector') WHERE source = '0.7.0'`. Some updates require DROP + CREATE (data loss for extension-managed types)
9. **[CRITICAL] "extension not allowlisted" error**: Run Step 2 to add the extension to the `azure.extensions` server parameter. Remember to include all existing extensions in the value
10. **[HIGH] "must be loaded via shared_preload_libraries" error**: Run Step 3 and restart the server. The restart is required for the parameter change to take effect

## References
- [Extensions in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-extensions)
- [How to use extensions](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-extensions)
