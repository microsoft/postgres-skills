---
name: table-partitioning
description: "PostgreSQL native table partitioning with range, list, and hash strategies including partition pruning"
version: "1.0.0"
tags: [postgresql, partitioning, range, list, hash, pruning]
execution_mode: mutate
requires_confirmation: false
platform_scope: postgresql
---

# Table Partitioning

## When to Use

**Trigger when:**
- User has a table growing beyond 50-100 million rows
- Queries filter by date range, tenant ID, or category
- User asks "how to partition" or "archiving old data"
- Bulk DELETE of old data causes bloat and long locks
- VACUUM runs too long on large tables

**Do NOT use when:**
- Table is small (< 10M rows) and performs fine
- User needs Azure-specific partition management (use `azure-postgresql/upgrades-maintenance/`)
- Random access patterns with no consistent filter column

**Overlaps with:**
- `postgresql/query-performance/` (partition pruning improves query speed)
- `postgresql/advanced-indexing/` (indexes on partitioned tables)

## Prerequisites

- PostgreSQL 12+ (for declarative partitioning with all features)
- `psql` or MCP `execute_sql` tool

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
ALTER TABLE events DETACH PARTITION events_2023_01 CONCURRENTLY;
-- CONCURRENTLY avoids blocking other queries (PostgreSQL 14+)
```

## Common Mistakes

1. **No default partition**: Inserts with values outside defined ranges fail with ERROR
2. **Partition key not in WHERE**: Query touches all partitions (no pruning), slower than unpartitioned
3. **Too many partitions**: Hundreds of partitions increase planning time. Target 50-200 max
4. **Missing indexes on partitions**: Create indexes on the parent table; PostgreSQL propagates to children

## Verification

```sql
-- Confirm partitions exist
SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'events'::regclass;

-- Confirm pruning works in queries
EXPLAIN (COSTS OFF) SELECT * FROM events WHERE created_at = '2024-01-15';
-- Look for: "Partitions selected: 1" (not all)
```

## Failure Recovery

- **Insert fails "no partition"**: Add a DEFAULT partition or create the missing range partition
- **Cannot detach concurrently**: On PostgreSQL < 14, use `DETACH PARTITION` without CONCURRENTLY (acquires brief lock)
- **Wrong partition boundaries**: Attach a new partition with correct bounds, migrate rows, detach wrong one
