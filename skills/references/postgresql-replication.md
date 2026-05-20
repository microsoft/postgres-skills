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
    - "when user needs event streaming to Kafka, use Debezium on top of logical replication"
  adjacent_skills:
    - "`postgresql/connection-management/`"
    - "`postgresql/table-partitioning/`"
---

# Logical Replication

## When to use this skill

Use for PostgreSQL issues involving:
- Replication lag diagnosis, slot bloat, WAL retention
- Logical replication failure modes (conflicts, missing PK, sequence gaps)
- DDL coordination across publisher/subscriber
- Partitioned table replication (version-gated)
- Zero-downtime migration or CDC setup
- Setting up publications and subscriptions

## Response focus

Prioritize gotchas, version boundaries, and production-safe corrections. Include runnable examples when users ask for setup help.

## High-value reminders

- `wal_level = logical` requires restart; on managed PG change via portal/API
- Sequences are NOT replicated — subscriber sequences do not advance; risk of duplicate keys after failover
- DDL is NOT replicated — apply schema changes on subscriber FIRST
- Conflicts halt replication silently — subscriber must resolve manually
- `REPLICA IDENTITY FULL` is required for UPDATE/DELETE on tables without PK (but is slower)

## Quick Setup Reference

```sql
-- PUBLISHER: Enable logical replication (requires restart)
ALTER SYSTEM SET wal_level = logical;
-- Then restart PostgreSQL

-- PUBLISHER: Create publication for specific tables
CREATE PUBLICATION my_pub FOR TABLE orders, customers;

-- SUBSCRIBER: Create subscription (connects to publisher)
CREATE SUBSCRIPTION my_sub
    CONNECTION 'host=publisher_host dbname=mydb user=repl_user password=...'
    PUBLICATION my_pub;

-- Monitor replication status
SELECT * FROM pg_stat_subscription;  -- on subscriber
SELECT slot_name, active, restart_lsn FROM pg_replication_slots;  -- on publisher
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

12. **[CRITICAL] Sequence values not replicated**: Logical replication does NOT replicate sequences. After failover, reset on new primary: `SELECT setval('orders_id_seq', (SELECT max(id) FROM orders) + 1)`

13. **[MEDIUM] Logical replication for partitioned tables (PG 13+)**: Before PG 13, you must add each partition individually to the publication. PG 13+ supports `ALTER PUBLICATION pub ADD TABLE partitioned_parent` directly

14. **[MEDIUM] `FOR ALL TABLES IN SCHEMA` (PG 15+)**: `CREATE PUBLICATION pub FOR ALL TABLES IN SCHEMA myschema` is PG 15+ only. On PG 14 and earlier, list tables explicitly or use `FOR ALL TABLES`

## Anti-Hallucination Rules

- Do NOT claim logical replication keeps sequence state synchronized. Inserted row values replicate, but sequence counters do not advance on subscribers. After failover, sequences must be manually reset.
- Do NOT claim DDL changes replicate automatically — they never do in any PostgreSQL version.
- Do NOT assume `wal_level` can be changed without restart.
- Do NOT claim bidirectional replication is natively supported — it requires third-party extensions (e.g., BDR) or application-level conflict handling.
