---
name: ha-disaster-recovery
description: "Azure Database for PostgreSQL Flexible Server high availability, point-in-time restore, read replicas, and geo-redundant backup"
version: "1.0.0"
tags: [azure, postgresql, ha, disaster-recovery, pitr, read-replicas, backup]
execution_mode: control-plane
requires_confirmation: true
platform_scope: azure-postgresql
---

# HA and Disaster Recovery

## When to Use

**Trigger when:**
- User asks about failover, high availability, or disaster recovery
- User needs to restore to a point in time (PITR)
- User asks about read replicas or geo-replication
- User mentions backup retention, RPO, or RTO
- Error or outage recovery planning

**Do NOT use when:**
- User needs logical replication for selective table sync (use `postgresql/logical-replication/`)
- User asks about application-level retry logic (use `postgresql/connection-management/`)
- User needs networking for replica connectivity (use `azure-postgresql/networking-ssl/`)

**Overlaps with:**
- `postgresql/logical-replication/` (Azure replicas use physical replication)
- `azure-postgresql/provisioning/` (HA is configured at provision time)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Contributor role on the resource group
- `az CLI` authenticated

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

## Common Mistakes

1. **Assuming PITR modifies the original**: PITR creates a completely NEW server with a new connection string. Applications must be updated to point to the new server
2. **Geo-backup after creation**: Geo-redundant backup can only be enabled at server creation time
3. **Read replica as HA**: Replicas have async replication lag. They are for read scale-out, not automatic failover
4. **403/PermissionDenied**: HA and replica operations need Contributor role on the resource group
5. **Backup retention default**: Default is 7 days. Set up to 35 days for compliance requirements

## Verification

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

## Failure Recovery

- **Failover triggered**: Check `az postgres flexible-server show` for new primary zone. Connections auto-redirect if using server FQDN
- **PITR failed**: Verify restore time is within backup retention window. Check Azure Activity Log for errors
- **Replica lag too high**: Check source server load. Consider upgrading replica SKU or reducing write load
