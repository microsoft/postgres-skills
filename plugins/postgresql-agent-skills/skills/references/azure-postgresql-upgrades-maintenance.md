---
name: upgrades-maintenance
description: "Azure Database for PostgreSQL Flexible Server major version upgrades, maintenance windows, and in-place upgrade procedures"
tags: [azure, postgresql, upgrade, major-version, maintenance, mvu]
platform_scope: azure-postgresql
activation:
  user_intent:
    - upgrade PostgreSQL major version
    - configure maintenance windows or scheduled patching
    - perform in-place upgrade or MVU
    - find out when maintenance will occur
    - plan downtime for upgrades
  technical_keywords:
    - az postgres flexible-server upgrade
    - --validate-only
    - --maintenance-window
    - MVU
    - major version upgrade
    - ANALYZE
  exclusion_conditions:
    - "when user needs to upgrade extensions, use `azure-postgresql/extension-lifecycle/` instead"
    - "when user asks about scaling SKU, use `azure-postgresql/provisioning/` instead"
    - "when user needs HA failover, use `azure-postgresql/ha-disaster-recovery/` instead"
  adjacent_skills:
    - "`azure-postgresql/extension-lifecycle/`"
    - "`azure-postgresql/ha-disaster-recovery/`"
---

> **âš ï¸ AZURE GATE:** This reference contains Azure Database for PostgreSQL-specific guidance. Before applying any operational steps, confirm the target is Azure by calling `pgsql_get_server_capabilities` and verifying `isAzure: true`. If the connection is NOT Azure, use the corresponding generic postgresql-* reference instead.

# Upgrades and Maintenance

## Prerequisites

- Contributor role on the resource group
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

### Verify

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

## Common Mistakes

1. **[CRITICAL] `--validate-only` first, always**: `az postgres flexible-server upgrade --resource-group rg --name server --version 16 --validate-only` checks extension compatibility, disk space, and connection limits without performing upgrade. Takes 2-5 minutes. Never skip

   Ã¢ÂÅ’ Wrong:
   ```bash
   # Skipping validation Ã¢â‚¬â€ upgrade may fail mid-way
   az postgres flexible-server upgrade --name myserver --version 16
   ```

   Ã¢Å“â€¦ Right:
   ```bash
   # Always validate first
   az postgres flexible-server upgrade --name myserver --version 16 --validate-only
   # Fix any reported issues, THEN:
   az postgres flexible-server upgrade --name myserver --version 16
   ```

2. **[HIGH] MVU snapshot verification**: Azure takes an automatic snapshot before MVU. Verify with: `az postgres flexible-server backup list --resource-group rg --name server`. Keep manual backup as additional safety net
3. **[HIGH] Extension compatibility matrix**: Not all extensions support all PG versions. Check BEFORE upgrade: `SELECT e.extname, e.extversion FROM pg_extension e` then verify target version supports each. `pg_partman` and `postgis` are common blockers
4. **[HIGH] Post-MVU `ANALYZE` requirement**: After major version upgrade, `pg_statistic` is stale. Run `ANALYZE;` on priority tables immediately, then `vacuumdb --all --analyze-in-place` for the full database

   Ã¢ÂÅ’ Wrong:
   ```bash
   # Upgrade completes, application goes live immediately
   # All queries regress Ã¢â‚¬â€ planner has no statistics for new version
   ```

   Ã¢Å“â€¦ Right:
   ```sql
   -- Immediately after upgrade completes:
   ANALYZE;
   -- Then verify critical query plans before releasing traffic
   ```

5. **[HIGH] Post-MVU extension updates**: Run `ALTER EXTENSION vector UPDATE; ALTER EXTENSION postgis UPDATE;` for each extension to get version compatible with new PG major
6. **[CRITICAL] Rollback strategy**: MVU is one-way (cannot downgrade). If upgrade causes issues, restore from pre-upgrade PITR backup using `az postgres flexible-server restore` (creates NEW server at old version)

   Ã¢ÂÅ’ Wrong:
   ```bash
   # Assuming you can downgrade if something goes wrong
   az postgres flexible-server upgrade --name myserver --version 15
   # ERROR: downgrade is not supported
   ```

   Ã¢Å“â€¦ Right:
   ```bash
   # Pre-upgrade: note PITR backup exists. If issues arise:
   az postgres flexible-server restore --name myserver-rollback \
       --source-server myserver --restore-time "<pre-upgrade-timestamp>"
   # Restores to old version on a NEW server
   ```

7. **[HIGH] Application connection handling during MVU**: Server restarts during upgrade. Applications get `FATAL: the database system is shutting down`. Implement retry with 30s timeout and exponential backoff
8. **[MEDIUM] Do NOT use `ALTER SYSTEM SET` or edit `postgresql.conf` directly**: On Azure managed PostgreSQL, use `az postgres flexible-server parameter set` or the Azure Portal to change server parameters. OS-level tools like `pg_basebackup` are also unavailable; use Azure PITR instead

## References
- [Major version upgrades in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-major-version-upgrade)
- [Scheduled maintenance](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-maintenance)