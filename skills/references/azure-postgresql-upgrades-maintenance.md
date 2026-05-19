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

## Key Facts (what models get wrong)

| Fact | Detail |
|------|--------|
| MVU is one-way | Cannot downgrade. Rollback = PITR restore to NEW server |
| No skip-version | Must go 13→14→15→16→17 sequentially |
| `--validate-only` | Always run first. Checks extensions, disk, connections (2-5 min) |
| Maintenance window | Only controls MINOR patches. MVU runs when you execute it |
| HA servers | Primary + standby both upgrade. Failover adds 30-60s |
| Read replicas | Must upgrade separately AFTER primary. Version mismatch breaks replication |
| Disk requirement | 25% free space minimum for upgrade process |
| Post-upgrade | `ANALYZE;` immediately (pg_statistic is stale). Then update extensions |

## Downtime Estimates

| Scenario | Expected Downtime |
|----------|------------------|
| Simple (no HA) | 5-15 min |
| HA (zone-redundant) | 15-30 min |
| Large databases (>500GB) | 30+ min |

## Version EOL Dates

| Version | End of Life |
|---------|-------------|
| PG 13 | Nov 2025 |
| PG 14 | Nov 2026 |
| PG 15 | Nov 2027 |
| PG 16 | Nov 2028 |

## Critical Gotchas

1. **validate-only first**: `az postgres flexible-server upgrade --version 16 --validate-only` catches extension blockers before commit
2. **Extension compatibility**: `pg_partman`, `postgis` are common MVU blockers. Check before, update after
3. **ANALYZE after upgrade**: Planner has no stats for new version. Queries regress until you run `ANALYZE;`
4. **ALTER EXTENSION UPDATE**: Run for each extension post-MVU to get PG-version-compatible builds
5. **No ALTER SYSTEM**: Use `az postgres flexible-server parameter set` or Portal. OS-level tools unavailable

## Anti-Hallucination Rules

- Cannot downgrade after MVU
- Cannot skip versions (e.g., 13→16 directly)
- Maintenance windows do NOT control MVU timing
- Read replicas do NOT auto-upgrade with primary

## References
- [Major version upgrades](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-major-version-upgrade)
- [Scheduled maintenance](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-maintenance)
