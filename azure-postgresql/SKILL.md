---
name: azure-postgresql
description: "Core principles and CLI patterns for Azure Database for PostgreSQL Flexible Server. Always load this skill first when working with Azure PostgreSQL."
tags: [azure, postgresql, flexible-server, core, cli, fundamentals]
platform_scope: azure-postgresql
activation:
  user_intent: ["work with Azure PostgreSQL", "connect to Azure database", "manage flexible server"]
  technical_keywords: ["az postgres flexible-server", "azure database for postgresql", "flexible server"]
  exclusion_conditions: []
  adjacent_skills: ["provisioning", "networking-ssl", "extension-lifecycle", "entra-id-auth"]
---

# Azure Database for PostgreSQL — Core Principles

## 1. Features vary by PostgreSQL version, server tier, and extension allowlist — verify before implementing.

Do not assume a feature or extension is available. Check all three:

```sql
-- PostgreSQL version (determines SQL feature availability)
SELECT version();

-- Server tier (Burstable, GeneralPurpose, MemoryOptimized)
-- Burstable does NOT support: read replicas, HA with zone redundancy, >2 vCores
SELECT current_setting('azure.server_tier', true);

-- Allowed extensions (must be allowlisted before CREATE EXTENSION)
SHOW azure.extensions;
```

Extension installation on Azure requires an explicit allowlist step via the Azure Portal or CLI **before** `CREATE EXTENSION` will succeed. This is the most common failure agents encounter. See the `extension-lifecycle` skill for the full workflow.

## 2. Verify your work.

After implementing any change, run a verification query. A change without verification is incomplete.

- **Extension installed?** → `SELECT * FROM pg_extension WHERE extname = 'your_ext';`
- **Server parameter changed?** → `SHOW parameter_name;` (some require restart — check `pg_settings.pending_restart`)
- **Firewall rule applied?** → Test connection from the target IP
- **Schema change applied?** → `\dt` or query `information_schema.columns`

Some server parameter changes require a server restart. Always check:
```sql
SELECT name, setting, pending_restart FROM pg_settings WHERE pending_restart = true;
```

## 3. Recover from errors, don't loop.

If an approach fails after 2-3 attempts, stop and reconsider. Common Azure-specific failure patterns:

| Error pattern | Likely cause | Fix |
|---|---|---|
| `permission denied for function` | Missing `azure_pg_admin` role | `GRANT azure_pg_admin TO youruser;` |
| `extension ... is not available` | Not in `azure.extensions` allowlist | Allowlist via Portal/CLI, then retry |
| `could not connect to server` | Firewall or Private Endpoint DNS | Add client IP or check DNS resolution |
| `must be loaded via shared_preload_libraries` | Extension requires preload + restart | Set parameter via CLI, restart server |
| `SSL connection is required` | sslmode not set | Use `sslmode=require` in connection string |

Check Azure Monitor metrics (`cpu_percent`, `memory_percent`, `iops`) and Activity Log for server-level issues before retrying application-level fixes.

## Azure CLI

Discover commands via `--help` — never guess flag names. The `az postgres flexible-server` namespace is deep.

```bash
az postgres flexible-server --help                    # All server commands
az postgres flexible-server <command> --help          # Flags for a command
az postgres flexible-server parameter --help          # Server parameters
az postgres flexible-server firewall-rule --help      # Firewall management
```

**Common CLI patterns:**

```bash
# Create a server
az postgres flexible-server create \
  --resource-group myRG --name myserver \
  --location eastus --sku-name Standard_D2ds_v4 \
  --tier GeneralPurpose --version 16 \
  --storage-size 128 --admin-user myadmin

# Set a server parameter
az postgres flexible-server parameter set \
  --resource-group myRG --server-name myserver \
  --name azure.extensions --value "vector,pg_diskann,azure_ai"

# Restart (required after shared_preload_libraries changes)
az postgres flexible-server restart \
  --resource-group myRG --name myserver

# Check connection string
az postgres flexible-server show-connection-string --server-name myserver
```

**CLI gotchas:**
- `--sku-name` format is `Standard_{series}` (e.g., `Standard_D2ds_v4`), NOT just `D2ds_v4`
- `--tier` accepts `Burstable`, `GeneralPurpose`, `MemoryOptimized` (PascalCase)
- `parameter set --value` for list-type params (like `azure.extensions`) replaces the entire list — always include existing values when adding new ones
- `firewall-rule create` requires `--start-ip-address` and `--end-ip-address` (use same IP for single host)

## Documentation

For detailed guidance on any Azure Database for PostgreSQL feature, consult the MS Learn documentation:

- [Azure Database for PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/flexible-server/overview)
- [What's new](https://learn.microsoft.com/azure/postgresql/flexible-server/whats-new)
- [Supported extensions](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-extensions)
- [Server parameters](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-server-parameters)
- [Service limits](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-limits)
