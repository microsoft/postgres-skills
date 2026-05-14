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

   ❌ Wrong:
   ```bash
   # Skipping validation — upgrade may fail mid-way
   az postgres flexible-server upgrade --name myserver --version 16
   ```

   ✅ Right:
   ```bash
   # Always validate first
   az postgres flexible-server upgrade --name myserver --version 16 --validate-only
   # Fix any reported issues, THEN:
   az postgres flexible-server upgrade --name myserver --version 16
   ```

2. **[HIGH] MVU snapshot verification**: Azure takes an automatic snapshot before MVU. Verify it exists: `az postgres flexible-server backup list --resource-group rg --name server` — look for a backup with timestamp just before upgrade start. Keep manual backup as additional safety net
3. **[HIGH] Extension compatibility matrix**: Not all extensions support all PG versions. Check BEFORE upgrade: `SELECT e.extname, e.extversion FROM pg_extension e` then verify target version supports each. `pg_partman` and `postgis` are common blockers
4. **[HIGH] Post-MVU `ANALYZE` requirement**: After major version upgrade, `pg_statistic` is stale. All query plans may regress. Run: `vacuumdb --all --analyze-in-place` immediately post-upgrade. On large databases, prioritize critical tables first

   ❌ Wrong:
   ```bash
   # Upgrade completes, application goes live immediately
   # All queries regress — planner has no statistics for new version
   ```

   ✅ Right:
   ```bash
   # Immediately after upgrade completes:
   vacuumdb --all --analyze-in-place --host=myserver.postgres.database.azure.com
   # Then verify critical query plans before releasing traffic
   ```

5. **[HIGH] Post-MVU extension updates**: After upgrading PG version (e.g., 15→16), extension versions may have newer compatible releases. Run: `ALTER EXTENSION vector UPDATE; ALTER EXTENSION postgis UPDATE;` for each extension to get version compatible with new PG major
6. **[MEDIUM] Maintenance window control**: MVU takes 5-15 minutes of downtime. Schedule with `--planned-maintenance-window`: `az postgres flexible-server update --maintenance-window "Mon:02:00"`. MVU itself must be triggered manually but respects the window for automatic restarts
7. **[HIGH] Application connection handling during MVU**: Server restarts during upgrade. Applications get `FATAL: the database system is shutting down`. Implement retry with 30s timeout and exponential backoff. Connection pools (PgBouncer) will queue requests during the brief outage
8. **[CRITICAL] Rollback strategy**: MVU is one-way (cannot downgrade). If upgrade causes issues, restore from pre-upgrade PITR backup (creates NEW server at old version). Test upgrade on a read replica first: promote replica, upgrade it, validate, then upgrade primary

   ❌ Wrong:
   ```bash
   # Assuming you can downgrade if something goes wrong
   az postgres flexible-server upgrade --name myserver --version 15
   # ERROR: downgrade is not supported
   ```

   ✅ Right:
   ```bash
   # Pre-upgrade: note PITR backup exists. If issues arise:
   az postgres flexible-server restore --name myserver-rollback \
       --source-server myserver --restore-time "<pre-upgrade-timestamp>"
   # Restores to old version on a NEW server
   ```

9. **[MEDIUM] Upgrade failed**: Server rolls back to previous version automatically. Check Activity Log for root cause
10. **[HIGH] Performance regression post-upgrade**: Run `ANALYZE` on all tables. Check if planner settings changed between versions
11. **[HIGH] Extension broken after upgrade**: `ALTER EXTENSION ... UPDATE` to get version compatible with new PostgreSQL version

## References
- [Major version upgrades in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-major-version-upgrade)
- [Scheduled maintenance](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-maintenance)
