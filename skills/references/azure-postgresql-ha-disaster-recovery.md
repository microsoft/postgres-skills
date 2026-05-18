---
name: ha-disaster-recovery
description: "Azure Database for PostgreSQL Flexible Server high availability, point-in-time restore, read replicas, and geo-redundant backup"
tags: [azure, postgresql, ha, disaster-recovery, pitr, read-replicas, backup]
platform_scope: azure-postgresql
activation:
  user_intent:
    - "set up failover or high availability for Azure PostgreSQL"
    - "restore database to a point in time"
    - "create read replicas or geo-replication"
    - "configure backup retention, RPO, or RTO"
    - "plan for outage recovery"
  technical_keywords:
    - high-availability
    - ZoneRedundant
    - point-in-time restore
    - PITR
    - restore-time
    - replica create
    - geo-redundant-backup
    - failover
    - RPO
    - RTO
    - backup retention
  exclusion_conditions:
    - "when user needs networking for replica connectivity, use `azure-postgresql/networking-ssl/` instead"
  adjacent_skills:
    - "`azure-postgresql/networking-ssl/`"
    - "`azure-postgresql/provisioning/`"
---

# HA and Disaster Recovery

## Prerequisites

- Contributor role on the resource group

## Instructions

**Step 1: Understand HA modes**

| Mode | RPO | RTO | Cost |
|------|-----|-----|------|
| No HA | < 5 min (backup) | Minutes-hours | 1x |
| Same-zone HA | 0 (sync standby) | 60-120s | ~2x |
| Zone-redundant HA | 0 (sync standby) | 60-120s | ~2x |

**Step 2: Enable HA**

```bash
az postgres flexible-server update \
    --resource-group myRG --name myserver \
    --high-availability ZoneRedundant \
    --standby-zone 2
```

**Step 3: Point-in-Time Restore (PITR)**

> WARNING: PITR creates a NEW server. Your connection string will change. The original server is NOT modified.

```bash
# Restore to 30 minutes ago
az postgres flexible-server restore \
    --resource-group myRG \
    --name myserver-restored \
    --source-server myserver \
    --restore-time "2025-01-15T10:30:00Z"
```

**Step 4: Create a read replica**

```bash
az postgres flexible-server replica create \
    --resource-group myRG \
    --replica-name myserver-replica \
    --source-server myserver
```

**Step 5: Geo-redundant backup**

```bash
# Must be set at server creation (cannot be changed later)
az postgres flexible-server create \
    --resource-group myRG --name myserver \
    --geo-redundant-backup Enabled \
    # ... other params
```

### Verify

```bash
# Check HA status
az postgres flexible-server show --resource-group myRG --name myserver \
    --query "{ha:highAvailability.mode, state:highAvailability.state}"

# List replicas
az postgres flexible-server replica list --resource-group myRG --name myserver

# Check backup retention
az postgres flexible-server show --resource-group myRG --name myserver \
    --query "backup.{retention:backupRetentionDays, geo:geoRedundantBackup}"
```

## Common Mistakes

1. **[CRITICAL] PITR creates a NEW server**: Point-in-time restore produces a completely new server with a new hostname (`restored-server.postgres.database.azure.com`). All connection strings, firewall rules, and VNet configurations must be recreated. PITR is NOT an in-place rollback

   ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Wrong:
   ```bash
   # Expecting in-place rollback ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â original server is unchanged!
   az postgres flexible-server restore --name myserver --source-server myserver \
       --restore-time "2025-01-15T10:30:00Z"
   # ERROR: server name already exists
   ```

   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Right:
   ```bash
   # Restore creates a NEW server with a new name
   az postgres flexible-server restore --name myserver-restored \
       --source-server myserver --restore-time "2025-01-15T10:30:00Z"
   # Then update connection strings to point to myserver-restored
   ```

2. **[HIGH] PITR destination restrictions**: Restored server inherits source's tier/SKU but NOT HA settings, firewall rules, or VNet config. Must reconfigure networking post-restore. Restore target must be in same region as source
3. **[CRITICAL] Geo-backup is creation-time only**: `--geo-redundant-backup Enabled` can only be set at server creation. Cannot enable on existing servers. If you forgot, your DR option is cross-region read replicas

   ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Wrong:
   ```bash
   # Cannot enable geo-backup on existing server
   az postgres flexible-server update --name myserver --geo-redundant-backup Enabled
   # ERROR: geo-redundant backup cannot be changed after server creation
   ```

   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Right:
   ```bash
   # Must be set at creation time
   az postgres flexible-server create --name myserver \
       --geo-redundant-backup Enabled --location eastus
   ```

4. **[HIGH] Zone-redundant failover timing**: Automatic failover takes 60-120 seconds (DNS propagation + standby promotion). During this window, writes fail. Applications need retry logic with 30s timeout + reconnect. Read replicas are unaffected during primary failover
5. **[MEDIUM] Same-zone vs zone-redundant decision tree**: Same-zone HA: ~30s failover, protects against compute failure, no zone protection. Zone-redundant: ~120s failover, protects against entire zone outage, 2x compute cost. Use zone-redundant for production SLA > 99.95%
6. **[CRITICAL] Replica promotion is permanent and irreversible**: `az postgres flexible-server replica stop-replication --resource-group rg --name replica` permanently severs replication. The replica becomes an independent server. Cannot re-attach. Plan carefully

   ÃƒÆ’Ã‚Â¢Ãƒâ€šÃ‚ÂÃƒâ€¦Ã¢â‚¬â„¢ Wrong:
   ```bash
   # Promoting "just to test" ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â cannot be undone!
   az postgres flexible-server replica stop-replication --name myserver-replica
   # Replica is now independent. Cannot re-attach as replica.
   ```

   ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ Right:
   ```bash
   # Test on a throwaway replica, not your DR replica
   az postgres flexible-server replica create --replica-name myserver-test-replica --source-server myserver
   az postgres flexible-server replica stop-replication --name myserver-test-replica
   ```

7. **[HIGH] Cross-region read replica lag**: Expect 100ms-5s lag depending on transaction rate and network distance. NOT suitable for strong consistency reads. Use for reporting, analytics, and DR failover only. Monitor with `pg_stat_replication.sent_lsn - replay_lsn`
8. **[HIGH] Backup retention + PITR window**: Default 7 days, max 35 days. PITR can only restore to a point within the retention window. For compliance requiring 90+ day retention, export to Azure Blob Storage separately
9. **[MEDIUM] Failover testing**: Use `az postgres flexible-server restart --failover Forced` to test HA failover in production-like environments. Measures actual failover time. Schedule monthly to validate DR readiness
10. **[MEDIUM] Failover triggered ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â connection handling**: After failover, check `az postgres flexible-server show` for new primary zone. Connections auto-redirect if using server FQDN. Applications should implement retry logic
11. **[HIGH] PITR failed**: Verify restore time is within backup retention window. Check Azure Activity Log for specific errors. Ensure target server name is not already in use
12. **[MEDIUM] Replica lag too high**: Check source server load and consider upgrading replica SKU or reducing write load on the primary

## References
- [High availability in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-read-replicas)
- [Read replicas](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-read-replicas)