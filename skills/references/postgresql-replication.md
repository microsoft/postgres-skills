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

## What LLMs Get Wrong
1. `pg_basebackup` is for **physical** replication and standby seeding only; it does nothing for logical replication setup.
2. `max_wal_senders` and `max_replication_slots` are different limits. You can exhaust WAL senders while slots remain available, or exhaust slots while WAL senders look fine.
3. Logical replication from a standby is **PG 16+ only**. Before PG 16, logical replication needs the **primary** as publisher; only physical cascading worked from standbys.
4. `ALTER SUBSCRIPTION ... REFRESH PUBLICATION` after adding tables can trigger a full re-copy of subscribed tables when `copy_data = true` (the default), which can create hours of unexpected re-sync work.

## PG 16+ Features
- `disable_on_error = true` can stop endless retry loops; after fixing the bad row/transaction, use `ALTER SUBSCRIPTION my_sub SKIP (lsn = 'X/Y')` to advance past the offending change.
- Logical replication can now publish from a standby, reducing load on primaries for some topologies.
- Two-phase commit can participate in logical replication with `CREATE SUBSCRIPTION ... WITH (two_phase = true)` when the topology and workload need prepared transactions.

## Quick Setup Reference

```sql
-- PUBLISHER: Enable logical replication (requires superuser or platform admin role)
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

## Diagnostic Flow

When user reports a replication issue, follow this decision tree:

1. **Replication not starting?**
   - Check `SELECT * FROM pg_stat_subscription` — `last_msg_send_time` NULL = never connected
   - Verify network: can subscriber reach publisher on port 5432?
   - Verify `pg_hba.conf` on publisher allows replication connections
   - Check `max_wal_senders` not exhausted: `SELECT count(*) FROM pg_stat_replication`

2. **Replication lag growing?**
   - Check `SELECT slot_name, pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) as bytes_lag FROM pg_replication_slots`
   - If WAL accumulating: subscriber too slow, or idle transaction on subscriber blocking apply
   - If sudden spike: large transaction (COPY, bulk UPDATE) on publisher

3. **Data mismatch between publisher/subscriber?**
   - Sequences are NOT replicated. Check after failover.
   - DDL is NOT replicated. Schema drift = silent data divergence.
   - Check `REPLICA IDENTITY` — without FULL or PK, UPDATE/DELETE may silently skip rows

## Replication Slot Health

Use one query to distinguish apply lag from WAL retention risk:

```sql
SELECT
    slot_name,
    active,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS wal_retained,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS apply_lag,
    restart_lsn,
    confirmed_flush_lsn
FROM pg_replication_slots
ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC;
```

- `wal_retained` growing but `apply_lag` flat = orphaned or stalled slot holding WAL
- `apply_lag` growing fast = subscriber cannot consume changes quickly enough
- Alert thresholds: > 1 GB warning, > 5 GB urgent for OLTP; inactive slot with retained WAL > 15 min is usually a cleanup incident

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
4. **[HIGH] Initial table sync fails silently**: Large table sync takes hours and can consume a `max_wal_senders` worker. Monitor: `SELECT * FROM pg_stat_subscription`

5. **[HIGH] Conflict resolution on subscriber**: Duplicate key halts replication. Fix: `ALTER SUBSCRIPTION my_sub DISABLE; DELETE conflicting row; ALTER SUBSCRIPTION my_sub ENABLE` or `disable_on_error = true` (PG 16+)

6. **[HIGH] publish_via_partition_root not set**: Partitioned tables publish as individual partition names. Fix: `ALTER PUBLICATION pub SET (publish_via_partition_root = true)`

7. **[HIGH] wal_level not set to logical**: Requires superuser or platform admin role, plus a server restart. On managed services, change via server parameters UI then restart
8. **[CRITICAL] Sequence values not replicated**: Logical replication does NOT replicate sequences. After failover, reset on new primary: `SELECT setval('orders_id_seq', (SELECT max(id) FROM orders) + 1)`

9. **[HIGH] Replica identity on partitioned tables**: In PostgreSQL 15+, declarative-partitioned tables inherit `REPLICA IDENTITY` from the parent for logical replication. In PG 10-14, set `REPLICA IDENTITY` on each child partition individually. Always verify with: `SELECT relname, relreplident FROM pg_class WHERE relname LIKE 'orders%';`

10. **[HIGH] Column-list publications (PG 15+ only)**: `CREATE PUBLICATION pub FOR TABLE t (col1, col2)` works ONLY in PostgreSQL 15+. Earlier versions must replicate all columns. Always state "requires PostgreSQL 15+" when recommending column lists.

## Anti-Hallucination Rules

- Do NOT claim logical replication keeps sequence state synchronized. Inserted row values replicate, but sequence counters do not advance on subscribers. After failover, sequences must be manually reset.
- Do NOT claim DDL changes replicate automatically — they never do in any PostgreSQL version.
- Do NOT assume `wal_level` can be changed without restart.
- Do NOT claim bidirectional replication is natively supported — it requires third-party extensions (e.g., BDR) or application-level conflict handling.
- Do NOT use column-list publication syntax (`FOR TABLE t (col1, col2)`) without explicitly stating it requires PostgreSQL 15+.
- Do NOT claim REPLICA IDENTITY settings always/never inherit to partitions — behavior changed between PG versions. Always verify the target version.
