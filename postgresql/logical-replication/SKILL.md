---
name: logical-replication
description: "PostgreSQL logical replication setup, publication/subscription patterns, and conflict resolution"
tags: [postgresql, replication, logical, publication, subscription, cdc]
platform_scope: postgresql
activation:
  user_intent:
    - "replicate specific tables between PostgreSQL servers"
    - "set up CDC (Change Data Capture) from PostgreSQL"
    - "replicate between different PostgreSQL major versions"
    - "zero-downtime migration between servers"
    - "set up publication and subscription"
  technical_keywords:
    - CREATE PUBLICATION
    - CREATE SUBSCRIPTION
    - wal_level = logical
    - pg_replication_slots
    - REPLICA IDENTITY
    - confirmed_flush_lsn
    - pg_stat_subscription
    - publish_via_partition_root
    - max_replication_slots
    - pgoutput
    - wal2json
  exclusion_conditions:
    - "when user needs full byte-for-byte standby, use streaming replication instead"
    - "when user needs Azure read replicas with virtual endpoints, use `azure-postgresql/ha-disaster-recovery/` instead"
    - "when user needs event streaming to Kafka, use Debezium on top of logical replication"
  adjacent_skills:
    - "`azure-postgresql/ha-disaster-recovery/`"
    - "`postgresql/connection-management/`"
    - "`postgresql/table-partitioning/`"
---

# Logical Replication

## Instructions

**Step 1: Configure publisher**

```sql
-- Verify wal_level (if not 'logical', requires restart to change)
SHOW wal_level;

-- Create publication for specific tables
CREATE PUBLICATION my_pub FOR TABLE orders, customers;

-- Or for all tables
CREATE PUBLICATION my_pub FOR ALL TABLES;
```

> **Note:** On managed PostgreSQL (Azure, RDS), change `wal_level` via the cloud portal or server parameters API, not `postgresql.conf` directly. Use `SHOW` commands to verify current settings.

**Step 2: Configure subscriber**

```sql
-- On the subscriber server
CREATE SUBSCRIPTION my_sub
    CONNECTION 'host=publisher_host dbname=mydb user=repl_user password=...'
    PUBLICATION my_pub;
```

**Step 3: Handle tables without primary keys**

```sql
-- Set replica identity for tables without PK
ALTER TABLE audit_log REPLICA IDENTITY FULL;
-- WARNING: FULL identity sends entire row on UPDATE/DELETE (slower)
```

**Step 4: Monitor replication lag**

```sql
-- On publisher: check replication slots
SELECT slot_name, active, 
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots;
```

### Verify

```sql
-- Publisher: confirm publication exists
SELECT * FROM pg_publication_tables WHERE pubname = 'my_pub';

-- Subscriber: confirm subscription is active
SELECT subname, subenabled, subconninfo FROM pg_subscription;

-- Check replication is flowing (lag should be near 0)
SELECT slot_name, active, 
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lag
FROM pg_replication_slots;
```

## Common Mistakes

1. **Missing primary key**: Without PK or REPLICA IDENTITY, UPDATE/DELETE fail: "cannot update/delete from table without primary key or replica identity". Fix: `ALTER TABLE t REPLICA IDENTITY FULL` (slow) or add a PK
2. **Slot bloat consuming all disk**: Inactive replication slots prevent WAL cleanup indefinitely. Monitor: `SELECT slot_name, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal FROM pg_replication_slots WHERE NOT active`. Drop orphaned slots immediately
3. **Schema changes (DDL) not replicated**: `ALTER TABLE ADD COLUMN` is NOT replicated. Apply DDL on subscriber FIRST (new column with default), then on publisher. Reverse order breaks replication with column mismatch error
4. **Initial table sync fails silently**: `CREATE SUBSCRIPTION` copies existing rows. If table is large, initial sync can take hours and consumes `max_wal_senders` slot the entire time. Monitor: `SELECT * FROM pg_stat_subscription`
5. **Conflict resolution on subscriber**: Duplicate key or constraint violation halts replication. Fix: `ALTER SUBSCRIPTION my_sub DISABLE; DELETE conflicting row; ALTER SUBSCRIPTION my_sub ENABLE` or use `ALTER SUBSCRIPTION SET (disable_on_error = true)` (PG 16+)
6. **publish_via_partition_root not set**: Partitioned tables default to publishing as individual partition names. Subscriber expects parent table. Fix: `ALTER PUBLICATION pub SET (publish_via_partition_root = true)`
7. **max_replication_slots too low**: Each subscription uses one slot. Default is 10. If you hit limit, new subscriptions silently fail. Check with `SHOW max_replication_slots` and increase before adding more subscribers
8. **wal2json vs pgoutput**: `pgoutput` is built-in (PG 10+) and efficient. `wal2json` is third-party and outputs JSON but adds decode overhead. Use `pgoutput` unless you need Debezium/Kafka Connect JSON format
9. **Subscription stuck**: `ALTER SUBSCRIPTION my_sub DISABLE; ALTER SUBSCRIPTION my_sub ENABLE;`
10. **Slot consuming disk after subscriber is gone**: If subscriber is gone, drop the orphaned slot: `SELECT pg_drop_replication_slot('my_sub')`
11. **wal_level not set to logical**: Requires `wal_level = logical` (restart needed). On Azure Flexible Server, change via Server Parameters blade then restart
12. **Sequence values not replicated**: Logical replication does not replicate sequences. After failover, reset sequences on subscriber: `SELECT setval('my_seq', (SELECT max(id) FROM my_table) + 1)`
