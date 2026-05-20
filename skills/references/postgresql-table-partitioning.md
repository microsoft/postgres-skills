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

## Instructions

**Step 1: Strategy selection**

| Strategy | Best For | Partition Key |
|----------|----------|---------------------|
| RANGE | Time-series, logs | `created_at` |
| LIST | Multi-tenant | `tenant_id` |
| HASH | Even distribution | `user_id` |

**Step 2: Verify partition pruning works**

```sql
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE created_at >= '2024-01-15';
-- Must show: "Partitions selected: 1" (not all)
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
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE created_at = '2024-01-15';
-- Look for: "Partitions selected: 1" (not all)
```

## Common Mistakes

1. **[CRITICAL] Default partition traps data**: Once rows land in DEFAULT, creating a new partition for that range fails. Pre-create partitions ahead of time

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

2. **[HIGH] Partition pruning failure with casts**: Type mismatch prevents pruning

   ❌ Wrong:
   ```sql
   -- timestamptz partition key but date literal
   WHERE created_at > '2024-01-01'::date  -- scans ALL partitions
   ```

   ✅ Right:
   ```sql
   WHERE created_at > '2024-01-01 00:00:00+00'::timestamptz  -- prunes correctly
   ```

3. **[MEDIUM] Too many partitions**: >200 partitions increase planning time. Keep 50-200. Merge old monthly into yearly

4. **[HIGH] UNIQUE/PK must include partition key**: Cannot create unique index without partition key

   ❌ Wrong:
   ```sql
   PRIMARY KEY (id)  -- ERROR: unique constraint must include partition key
   ```

   ✅ Right:
   ```sql
   PRIMARY KEY (id, created_at)  -- partition key included
   ```

5. **[HIGH] pg_partman automation**: Without it, inserts fail when next period's partition doesn't exist. Setup: `CREATE EXTENSION pg_partman; SELECT partman.create_parent('public.events', 'created_at', 'native', 'monthly')`

6. **[HIGH] publish_via_partition_root for replication**: `ALTER PUBLICATION pub SET (publish_via_partition_root = true)` or subscriber sees individual partition names

7. **[MEDIUM] `DETACH PARTITION CONCURRENTLY`**: PG 14+ only. On PG 13 and earlier, plan a maintenance window (ACCESS EXCLUSIVE lock)

8. **[MEDIUM] Insert fails "no partition"**: Add DEFAULT partition or create the missing range partition

9. **[MEDIUM] Cannot detach concurrently on older PG**: On PG < 14, brief ACCESS EXCLUSIVE lock. On 14+, session must stay connected until completion

10. **[MEDIUM] Wrong partition boundaries**: Attach new partition with correct bounds, migrate rows, detach wrong one

11. **[MEDIUM] Partition pruning in JOINs (PG 12+)**: PG 12+ enables partition-wise joins (`enable_partitionwise_join = on`). On PG 11, joins scan all partitions even when only one matches. Enable explicitly: `SET enable_partitionwise_join = on` (off by default due to planning cost)
12. **[HIGH] Global uniqueness impossible**: Unique/PK constraints on partitioned tables must include the partition key. `UNIQUE(email)` needs `UNIQUE(email, partition_key)` or app-level enforcement
13. **[HIGH] Partition count explosion / planning latency**: 1000+ partitions slow planning because every partition must be considered. Keep roughly 100-200 or use coarser ranges
14. **[MEDIUM] Foreign keys referencing partitioned tables**: Support is version-specific: references to partitioned tables need PG 12+, and FK from partitioned to regular tables needs PG 11+

## Anti-Hallucination Rules

- Do NOT claim foreign keys can reference partitioned tables directly on PG < 12. PG 12+ supports FKs referencing partitioned tables.
- Do NOT claim UNIQUE indexes work without including the partition key — this is a hard PostgreSQL constraint.
- Do NOT invent partition management syntax that doesn't exist (e.g., `ALTER TABLE MERGE PARTITIONS` is not standard PostgreSQL).
- Do NOT claim `DETACH PARTITION CONCURRENTLY` works on PG < 14.
- Do NOT recommend partitioning tables with fewer than 10M rows unless there is a clear data lifecycle reason (archival, TTL).
