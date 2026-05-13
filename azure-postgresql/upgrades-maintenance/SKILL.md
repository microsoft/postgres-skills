---
name: upgrades-maintenance
description: "Azure Database for PostgreSQL Flexible Server major version upgrades, maintenance windows, and in-place upgrade procedures"
version: "1.0.0"
tags: [azure, postgresql, upgrade, major-version, maintenance, mvu]
execution_mode: control-plane
requires_confirmation: true
platform_scope: azure-postgresql
---

# Upgrades and Maintenance

## When to Use

**Trigger when:**
- User asks about upgrading PostgreSQL major version (e.g., 14 to 16)
- User asks about maintenance windows or scheduled patching
- User mentions "in-place upgrade" or "MVU" (Major Version Upgrade)
- User wants to know when maintenance will occur
- User needs to plan downtime for upgrades

**Do NOT use when:**
- User needs to upgrade extensions (use `azure-postgresql/extension-lifecycle/`)
- User asks about scaling SKU (use `azure-postgresql/provisioning/`)
- User needs HA failover (use `azure-postgresql/ha-disaster-recovery/`)

**Overlaps with:**
- `azure-postgresql/extension-lifecycle/` (extensions may need updates post-upgrade)
- `azure-postgresql/ha-disaster-recovery/` (HA behavior during maintenance)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Contributor role on the resource group
- `az CLI` authenticated
- Backup verified before major version upgrade

## Instructions

**Step 1: Check current version and available upgrades**

```bash
az postgres flexible-server show \
    --resource-group myRG --name myserver \
    --query "{version:version, state:state}"
```

**Step 2: Configure maintenance window**

```bash
# Set custom maintenance window (UTC)
az postgres flexible-server update \
    --resource-group myRG --name myserver \
    --maintenance-window "Sun:02:00"
```

**Step 3: Perform in-place major version upgrade (MVU)**

> WARNING: This causes downtime (typically 5-15 minutes). Take a backup first and test in a non-production environment.

```bash
# Pre-upgrade validation
az postgres flexible-server upgrade \
    --resource-group myRG --name myserver \
    --version 16 --validate-only

# Execute upgrade (requires confirmation)
az postgres flexible-server upgrade \
    --resource-group myRG --name myserver \
    --version 16
```

**Step 4: Post-upgrade tasks**

```sql
-- Update statistics after major version upgrade
ANALYZE;

-- Check for deprecated features
SELECT * FROM pg_catalog.pg_extension WHERE extversion != default_version;

-- Update extensions if needed
ALTER EXTENSION pg_stat_statements UPDATE;
```

## Common Mistakes

1. **No backup before upgrade**: Always ensure PITR is available before MVU. Azure takes a snapshot, but verify independently
2. **Skipping validation**: Always run with `--validate-only` first to catch incompatibilities
3. **Extension incompatibility**: Some extensions may not support the target version. Check compatibility before upgrading
4. **403/PermissionDenied**: Major version upgrades require Contributor role minimum
5. **Forgetting ANALYZE**: After MVU, statistics are stale. Run `ANALYZE` on all databases to prevent query plan regressions

## Verification

```bash
# Confirm version after upgrade
az postgres flexible-server show \
    --resource-group myRG --name myserver \
    --query version

# Check server health
az postgres flexible-server show \
    --resource-group myRG --name myserver \
    --query state
```

```sql
-- Verify extensions still work
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- Check for query performance regression
SELECT queryid, mean_time FROM query_store.qs_view
WHERE start_time > now() - interval '1 hour'
ORDER BY mean_time DESC LIMIT 10;
```

## Failure Recovery

- **Upgrade failed**: Server rolls back to previous version automatically. Check Activity Log for root cause
- **Performance regression post-upgrade**: Run `ANALYZE` on all tables. Check if planner settings changed between versions
- **Extension broken after upgrade**: `ALTER EXTENSION ... UPDATE` to get version compatible with new PostgreSQL version
