---
name: table-partitioning
description: "PostgreSQL native table partitioning with range, list, and hash strategies including partition pruning"
tags: [postgresql, partitioning, range, list, hash, pruning]
platform_scope: postgresql
activation:
  user_intent:
    - "how to partition a large table"
    - "table growing beyond 50-100 million rows"
    - "archiving old data without bloat"
    - "bulk DELETE causes bloat and long locks"
    - "VACUUM runs too long on large tables"
    - "queries filter by date range or tenant ID"
  technical_keywords:
    - PARTITION BY RANGE
    - PARTITION BY LIST
    - PARTITION BY HASH
    - CREATE TABLE PARTITION OF
    - DETACH PARTITION
    - partition pruning
    - pg_partman
    - publish_via_partition_root
    - DEFAULT partition
  exclusion_conditions:
    - "when table is small (< 10M rows) and performs fine, do not use this skill"
    - "when random access patterns with no consistent filter column, do not use this skill"
  adjacent_skills:
    - "`postgresql/query-performance/`"
    - "`postgresql/advanced-indexing/`"
---

# Table Partitioning

> **Response focus:** Prioritize partition pruning failures, PK-must-include-partition-key, DEFAULT partition traps, and version-gated DETACH CONCURRENTLY. Avoid explaining basic partitioning concepts or strategy selection unless asked.

## What LLMs Get Wrong

1. PostgreSQL does **not** support `DROP PARTITION`. Use `ALTER TABLE ... DETACH PARTITION`, then `DROP TABLE` on the detached child.
2. Hash partitioning is usually the wrong fit for time-series workloads because it cannot prune by date range.
3. Partitioning is not for every large table. Without a consistent filter predicate on the partition key, you pay extra planning cost and get little or no pruning benefit.
4. Partition-wise aggregation is **not** always on. `enable_partitionwise_aggregate = off` by default.

## Proving Pruning Works

```sql
EXPLAIN (COSTS OFF)
SELECT *
FROM events
WHERE created_at >= TIMESTAMPTZ '2024-01-01'
  AND created_at < TIMESTAMPTZ '2024-02-01';
```

```text
->  Append
      Subplans Removed: 11    ← pruned at plan time
      ->  Seq Scan on events_2024_01
```

If you see `Subplans Removed: 0` or no pruning mention at all, pruning failed.

## Instructions

**Step 1: Strategy selection**

| Strategy | Best For | Partition Key |
|----------|----------|---------------------|
| RANGE | Time-series, logs | `created_at` |
| LIST | Multi-tenant | `tenant_id` |
| HASH | Even distribution | `user_id` |

**Step 2: Verify partition pruning works**

```sql
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE created_at >= TIMESTAMPTZ '2024-01-15';
-- Must show pruning evidence such as "Subplans Removed" in the Append node
-- If pruning fails: check type mismatch on partition key
```

**Step 3: Detach for archival (PG 14+ CONCURRENTLY)**

```sql
-- PG 14+: non-blocking detach
ALTER TABLE events DETACH PARTITION events_2023_01 CONCURRENTLY;

-- PG 13 and earlier: brief ACCESS EXCLUSIVE lock
ALTER TABLE events DETACH PARTITION events_2023_01;
```

**Step 4: Always create DEFAULT partition**

```sql
CREATE TABLE events_default PARTITION OF events DEFAULT;
-- Without this, inserts fail when no matching partition exists
```

### Verify

```sql
-- Confirm partitions exist
SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'events'::regclass;

-- Confirm pruning works in queries
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE created_at = TIMESTAMPTZ '2024-01-15 00:00:00+00';
-- Look for pruning evidence such as "Subplans Removed"
```

## Common Mistakes

1. **[CRITICAL] Default partition traps data**: Once rows land in DEFAULT, creating a new partition for that range fails. Pre-create partitions ahead of time.

   ❌ Wrong:
   ```sql
   -- Rows for March already in DEFAULT partition
   CREATE TABLE events_2024_03 PARTITION OF events
       FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');
   -- ERROR: updated partition constraint for default would be violated
   ```

   ✅ Right:
   ```sql
   -- Move trapped rows first, then create partition
   INSERT INTO events_2024_03 SELECT * FROM events_default
       WHERE created_at >= '2024-03-01' AND created_at < '2024-04-01';
   DELETE FROM events_default
       WHERE created_at >= '2024-03-01' AND created_at < '2024-04-01';
   -- Or: pre-create partitions with pg_partman before data arrives
   ```

2. **[HIGH] Partition pruning failure with casts**: Type mismatch prevents pruning.

   ❌ Wrong:
   ```sql no-execute
   -- timestamptz partition key but date literal
   WHERE created_at > '2024-01-01'::date  -- scans ALL partitions
   ```

   ✅ Right:
   ```sql no-execute
   WHERE created_at > '2024-01-01 00:00:00+00'::timestamptz  -- prunes correctly
   ```

3. **[MEDIUM] Too many partitions**: >200 partitions increase planning time. Keep roughly 50-200 and merge old monthly partitions into yearly ones.

4. **[HIGH] UNIQUE/PK must include partition key**: Cannot create a unique index without the partition key.

   ❌ Wrong:
   ```sql no-execute
   PRIMARY KEY (id)  -- ERROR: unique constraint must include partition key
   ```

   ✅ Right:
   ```sql no-execute
   PRIMARY KEY (id, created_at)  -- partition key included
   ```

5. **[HIGH] pg_partman automation**: Without it, inserts fail when the next period's partition does not exist. Setup: `CREATE EXTENSION pg_partman; SELECT partman.create_parent('public.events', 'created_at', 'native', 'monthly')`

6. **[HIGH] ORM queries miss the partition key**: Django and SQLAlchemy often emit `SELECT * FROM events WHERE id = 123`; without a date filter, PostgreSQL scans every partition. Fix: include the partition key in application queries and use composite lookups such as `(id, created_at)`.

7. **[HIGH] publish_via_partition_root for replication**: `ALTER PUBLICATION pub SET (publish_via_partition_root = true)` or subscribers see individual partition names.

8. **[MEDIUM] Version and boundary gotchas**: `DETACH PARTITION CONCURRENTLY` is PG 14+ only; on older versions expect a brief `ACCESS EXCLUSIVE` lock. Wrong partition bounds or missing future partitions cause "no partition" insert failures and awkward data moves.

9. **[MEDIUM] Planner and version assumptions**: Partition-wise joins require `enable_partitionwise_join = on`; foreign keys referencing partitioned tables are version-specific (PG 12+ for references to partitioned tables). Global uniqueness still requires including the partition key or enforcing it in the app.

## Anti-Hallucination Rules

- Do NOT claim foreign keys can reference partitioned tables directly on PG < 12. PG 12+ supports FKs referencing partitioned tables.
- Do NOT claim UNIQUE indexes work without including the partition key — this is a hard PostgreSQL constraint.
- Do NOT invent partition management syntax that doesn't exist (e.g., `ALTER TABLE MERGE PARTITIONS` is not standard PostgreSQL).
- Do NOT claim `DETACH PARTITION CONCURRENTLY` works on PG < 14.
- Do NOT recommend partitioning tables with fewer than 10M rows unless there is a clear data lifecycle reason (archival, TTL).
