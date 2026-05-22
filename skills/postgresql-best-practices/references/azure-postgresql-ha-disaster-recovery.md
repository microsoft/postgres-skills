---
title: "Azure PostgreSQL HA Disaster Recovery"
description: "Azure Database for PostgreSQL Flexible Server high availability, point-in-time restore, read replicas, and geo-redundant backup"
tags: [azure, postgresql, ha, disaster-recovery, pitr, read-replicas, backup]
---

## Key Facts (what models get wrong)

> **Response focus:** Prioritize PITR-creates-new-server, geo-backup is creation-time-only, and replica promotion is permanent. Avoid explaining generic HA concepts or basic backup theory.

> **Shell execution:** Most commands here are az CLI. Execute directly via shell. Confirm with user only for: forced failover, stop-replication (irreversible), and delete operations.

> **NEVER suggest for Azure:** `pg_basebackup`, `pg_hba.conf`, `postgresql.conf`, `systemctl`, `sudo`, `/var/lib/postgresql`, or manual streaming replication setup. All backup/restore/failover is managed through az CLI or portal.

| Fact | Detail |
|------|--------|
| PITR creates a NEW server | Restore produces a new hostname; it is NOT an in-place rollback |
| Zone-redundant HA RPO/RTO | RPO near-zero (synchronous replication), RTO 60-120s |
| Same-zone HA | Protects against compute failure only; ~30s failover; no zone protection |
| Read replicas are async | Expect 100ms-5s lag; NOT suitable for strong-consistency reads |
| Geo-redundant backup is creation-time only | Cannot enable on an existing server; must be set at `create` |
| Replica promotion is permanent | `stop-replication` severs the link irreversibly; cannot re-attach |
| Backup retention | Default 7 days, max 35 days; PITR limited to this window |
| Geo-replica differs from HA | HA = same-region automatic failover; geo-replica = cross-region async copy for DR |
| Forced failover for testing | Use `az postgres flexible-server restart --failover Forced` |

## Decision Matrix

| Factor | No HA | Same-Zone HA | Zone-Redundant HA |
|--------|-------|--------------|-------------------|
| RPO | < 5 min (backup) | 0 (sync) | 0 (sync) |
| RTO | Minutes-hours | ~30s | 60-120s |
| Protects against | Nothing (manual) | Compute failure | Full zone outage |
| Cost | 1x | ~2x compute | ~2x compute |
| SLA | 99.9% | 99.95% | 99.99% |

## Critical Gotchas

1. **PITR needs a new server name**: Cannot restore to the same name; all connection strings, firewall rules, VNet config must be recreated on the restored server

   ```bash
   # Restore to a new server (NOT in-place)
   az postgres flexible-server restore --resource-group myRG \
       --name myserver-restored --source-server myserver \
       --restore-time "2026-05-19T10:00:00Z"
   # WARNING: Must reconfigure HA, firewall, VNet on restored server
   ```

2. **Geo-backup cannot be enabled later**: Must be set at server creation; alternative for existing servers is cross-region read replicas

   ❌ Wrong:
   ```bash
   # DOES NOT WORK — geo-redundant backup is creation-time only
   az postgres flexible-server update --name myserver --geo-redundant-backup Enabled
   ```

   ✅ Right:
   ```bash
   # Set at creation time
   az postgres flexible-server create --name myserver --geo-redundant-backup Enabled ...
   # For existing servers, use cross-region read replica instead
   az postgres flexible-server replica create --resource-group myRG \
       --replica-name myserver-replica --source-server myserver --location eastus2
   ```

3. **Replica promotion cannot be undone**: Test on throwaway replicas, not your DR replica

   ```bash
   # This is PERMANENT — cannot re-attach after promotion
   az postgres flexible-server replica stop-replication --resource-group myRG --name myserver-replica
   ```

4. **Failover drops in-flight writes**: Applications need retry logic with 30s timeout + reconnect
5. **Restored server loses HA/networking config**: Must reconfigure HA settings, firewall rules, and VNet after PITR
6. **Cross-region replica lag**: Not suitable for strong consistency; use for reporting/analytics/DR only
7. **35-day max retention**: For compliance needing 90+ days, export to Azure Blob Storage separately
8. **Forced failover for testing**:

   ```bash
   # Test HA failover (forced)
   az postgres flexible-server restart --resource-group myRG --name myserver --failover Forced
   ```

9. **[HIGH] Application cutover after PITR/failover**: PITR creates a new server with a new hostname. Update connection strings, DNS CNAMEs, Key Vault references, and app config manually
10. **[MEDIUM] Post-failover validation checklist**: After failover, verify replication slots, extension state, custom parameters, and that `pg_stat_activity` shows expected client traffic
11. **[MEDIUM] DR rehearsal cadence**: Run a monthly PITR drill to a throwaway server. It validates the backup chain without touching production

## Anti-Hallucination Rules

- Do NOT claim PITR is an in-place rollback
- Do NOT claim geo-redundant backup can be enabled after creation
- Do NOT claim read replicas provide synchronous replication
- Do NOT claim replica promotion is reversible
- Do NOT promise RTO < 60s for zone-redundant HA
- Do NOT confuse HA (same-region automatic failover) with geo-replication (cross-region DR)

## References
- [High availability in Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-read-replicas)
- [Read replicas](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-read-replicas)
