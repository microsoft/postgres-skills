---
title: "Azure PostgreSQL Upgrades Maintenance"
description: "Azure Database for PostgreSQL Flexible Server major version upgrades, maintenance windows, and in-place upgrade procedures"
tags: [azure, postgresql, upgrade, major-version, maintenance, mvu]
---

# Upgrades and Maintenance

> **Response focus:** Prioritize MVU-is-one-way, no-skip-version, validate-only-first, and post-upgrade ANALYZE. Avoid explaining basic PostgreSQL version features or generic upgrade concepts.

> **Shell execution:** `--validate-only` is safe to execute directly. The actual `upgrade` command is destructive (irreversible, causes downtime) and requires user confirmation. Restart after upgrade also requires confirmation.

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
6. **[HIGH] Extension-specific upgrade blockers**: `pg_partman`, `postgis`, and `timescaledb` commonly block MVU. Run `az postgres flexible-server upgrade --validate-only` first, then update blockers before the real upgrade
7. **[MEDIUM] App SQL behavior changes between major versions**: PG 15 changed default `public` schema permissions and PG 14 tightened some `GROUP BY` behavior. Test app queries, not just the upgrade command
8. **[MEDIUM] Blue-green upgrade with read replicas**: Replica -> upgrade replica -> promote -> switch DNS is a valid low-downtime path. Offer it when MVU downtime is unacceptable

## Anti-Hallucination Rules

- Cannot downgrade after MVU
- Cannot skip versions (e.g., 13→16 directly)
- Maintenance windows do NOT control MVU timing
- Read replicas do NOT auto-upgrade with primary

## References
- [Major version upgrades](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-major-version-upgrade)
- [Scheduled maintenance](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-maintenance)
