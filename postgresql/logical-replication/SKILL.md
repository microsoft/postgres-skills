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
SHOW wal_level;  -- Must be 'logical'; requires restart to change
CREATE PUBLICATION my_pub FOR TABLE orders, customers;
```

> On managed PG: change `wal_level` via portal/API, not `postgresql.conf`.

**Step 2: Handle tables without primary keys**

```sql
-- Required for UPDATE/DELETE replication on tables without PK
ALTER TABLE audit_log REPLICA IDENTITY FULL;
-- WARNING: sends entire row on UPDATE/DELETE (slower)
```

**Step 3: Monitor replication lag**

```sql
SELECT slot_name, active,
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots;
```

**Step 4: Critical gotchas**

- **Sequences NOT replicated** — reset on subscriber after failover
- **DDL NOT replicated** — apply on subscriber FIRST, then publisher
- **Conflicts halt replication** — subscriber must resolve duplicates manually

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

1. **[HIGH] Missing primary key**: Without PK or REPLICA IDENTITY, UPDATE/DELETE fail. Fix: `ALTER TABLE t REPLICA IDENTITY FULL` (slow) or add PK

2. **[CRITICAL] Slot bloat consuming all disk**: Inactive slots prevent WAL cleanup indefinitely

   ❌ Wrong:
   ```sql
   -- Subscriber removed but slot left behind — WAL grows unbounded
   SELECT slot_name, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn))
   FROM pg_replication_slots WHERE NOT active;
   -- Shows: orphaned_slot | 50 GB
   ```

   ✅ Right:
   ```sql
   -- Monitor and drop orphaned slots immediately
   SELECT pg_drop_replication_slot('orphaned_slot');
   -- Set up alerting on: pg_wal_lsn_diff > threshold
   ```

3. **[CRITICAL] Schema changes (DDL) not replicated**: `ALTER TABLE ADD COLUMN` is NOT replicated

   ❌ Wrong:
   ```sql
   -- Add column on publisher first
   ALTER TABLE orders ADD COLUMN priority int;  -- publisher
   -- Subscriber now gets rows with unknown column → replication breaks
   ```

   ✅ Right:
   ```sql
   -- Step 1: Add column on SUBSCRIBER first (with default)
   ALTER TABLE orders ADD COLUMN priority int DEFAULT 0;  -- subscriber
   -- Step 2: Then add on publisher
   ALTER TABLE orders ADD COLUMN priority int DEFAULT 0;  -- publisher
   ```

4. **[HIGH] Initial table sync fails silently**: Large table sync takes hours and consumes `max_wal_senders` slot. Monitor: `SELECT * FROM pg_stat_subscription`

5. **[HIGH] Conflict resolution on subscriber**: Duplicate key halts replication. Fix: `ALTER SUBSCRIPTION my_sub DISABLE; DELETE conflicting row; ALTER SUBSCRIPTION my_sub ENABLE` or `disable_on_error = true` (PG 16+)

6. **[HIGH] publish_via_partition_root not set**: Partitioned tables publish as individual partition names. Fix: `ALTER PUBLICATION pub SET (publish_via_partition_root = true)`

7. **[MEDIUM] max_replication_slots too low**: Default 10. New subscriptions silently fail at limit. Check: `SHOW max_replication_slots`

8. **[MEDIUM] wal2json vs pgoutput**: `pgoutput` is built-in and efficient. Use `wal2json` only for Debezium/Kafka JSON format

9. **[MEDIUM] Subscription stuck**: `ALTER SUBSCRIPTION my_sub DISABLE; ALTER SUBSCRIPTION my_sub ENABLE;`

10. **[MEDIUM] Slot consuming disk after subscriber gone**: Drop orphaned: `SELECT pg_drop_replication_slot('my_sub')`

11. **[HIGH] wal_level not set to logical**: Requires restart. On Azure, change via Server Parameters then restart

12. **[CRITICAL] Sequence values not replicated**: Logical replication does NOT replicate sequences

   ❌ Wrong:
   ```sql
   -- After failover to subscriber, sequences still at 1
   INSERT INTO orders(id) VALUES (DEFAULT);  -- duplicate key!
   ```

   ✅ Right:
   ```sql
   -- After failover, reset sequences on new primary
   SELECT setval('orders_id_seq', (SELECT max(id) FROM orders) + 1);
   ```
