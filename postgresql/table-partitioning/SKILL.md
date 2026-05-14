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
    - "when user needs Azure-specific partition management, use `azure-postgresql/upgrades-maintenance/` instead"
    - "when random access patterns with no consistent filter column, do not use this skill"
  adjacent_skills:
    - "`postgresql/query-performance/`"
    - "`postgresql/advanced-indexing/`"
---

# Table Partitioning

## Instructions

**Step 1: Choose partition strategy**

| Strategy | Best For | Partition Key Example |
|----------|----------|---------------------|
| RANGE | Time-series, logs, events | `created_at`, `order_date` |
| LIST | Multi-tenant, categories | `tenant_id`, `region` |
| HASH | Even distribution, no natural range | `user_id` |

**Step 2: Create partitioned table**

```sql
-- Range partitioning by month
CREATE TABLE events (
    id bigint GENERATED ALWAYS AS IDENTITY,
    created_at timestamptz NOT NULL,
    payload jsonb
) PARTITION BY RANGE (created_at);

-- Create partitions
CREATE TABLE events_2024_01 PARTITION OF events
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE events_2024_02 PARTITION OF events
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Default partition catches everything else
CREATE TABLE events_default PARTITION OF events DEFAULT;
```

**Step 3: Verify partition pruning**

```sql
EXPLAIN SELECT * FROM events WHERE created_at >= '2024-01-15';
-- Must show: only relevant partitions scanned (not all)
```

**Step 4: Detach old partitions for archival (near-instant)**

```sql
-- Detach instead of DELETE (no bloat, no long locks)
ALTER TABLE events DETACH PARTITION events_2023_01;
-- This acquires ACCESS EXCLUSIVE lock briefly
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

1. **Default partition traps data**: Once rows land in DEFAULT, creating a new partition for that range fails. Pre-create partitions ahead of time. Move trapped rows: `INSERT INTO events_2024_03 SELECT * FROM events_default WHERE created_at >= '2024-03-01' AND created_at < '2024-04-01'; DELETE FROM events_default WHERE ...`
2. **Partition pruning failure with casts**: `WHERE created_at > '2024-01-01'::date` on a `timestamptz` partition key prevents pruning. Match types exactly: `WHERE created_at > '2024-01-01 00:00:00+00'::timestamptz`
3. **Too many partitions**: >200 partitions increase planning time. Keep 50-200 partitions. Merge old monthly partitions into yearly ones
4. **UNIQUE/PK must include partition key**: Cannot create unique index without partition key: `PRIMARY KEY (id, created_at)` not just `PRIMARY KEY (id)`. This also affects foreign keys pointing to partitioned tables
5. **pg_partman automation**: For time-series, `pg_partman` auto-creates/drops partitions. Without it, inserts fail when next period's partition doesn't exist. Setup: `CREATE EXTENSION pg_partman; SELECT partman.create_parent('public.events', 'created_at', 'native', 'monthly')`
6. **publish_via_partition_root for replication**: Logical replication requires `ALTER PUBLICATION pub SET (publish_via_partition_root = true)` or subscriber sees individual partition names instead of parent table
7. **`DETACH PARTITION CONCURRENTLY`**: Available in PostgreSQL 14+. For PG13 and earlier, `DETACH PARTITION` takes an `ACCESS EXCLUSIVE` lock. Plan a maintenance window for older versions
8. **Insert fails "no partition"**: Add a DEFAULT partition or create the missing range partition
9. **Cannot detach concurrently on older PG**: On PostgreSQL < 14, use `ALTER TABLE ... DETACH PARTITION` (acquires brief ACCESS EXCLUSIVE lock). On 14+, CONCURRENTLY option is available but ensure session stays connected until completion
10. **Wrong partition boundaries**: Attach a new partition with correct bounds, migrate rows, detach wrong one
