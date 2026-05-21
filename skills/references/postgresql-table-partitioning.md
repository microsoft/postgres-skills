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

> **Response focus:** Prioritize pruning failures, DEFAULT partition traps, version-gated DDL, and uniqueness rules. Skip basic partitioning primers.

## Version History

| Version | Feature | Notes |
|---------|---------|-------|
| PG 10 | Declarative RANGE and LIST partitioning | First native partitioned tables |
| PG 11 | HASH partitioning, DEFAULT partition, execution-time pruning | Major usability jump |
| PG 12 | Foreign keys to and from partitioned tables | Removes a major adoption blocker |
| PG 14 | `DETACH PARTITION ... CONCURRENTLY` | Lower-impact archival detach |

## Parameter Correctness

| Setting | Default | Correct use | Gotcha |
|---------|---------|-------------|--------|
| `enable_partition_pruning` | `on` | Leave on unless testing | Turning it off defeats the whole design |
| `enable_partitionwise_join` | `off` | Enable only when matching partitions help joins | Not automatic |
| `enable_partitionwise_aggregate` | `off` | Enable for aligned aggregation workloads | Can increase planning work |
| `publish_via_partition_root` | `false` on publication | Set `true` for logical replication through parent name | Subscriber otherwise sees child table names |

## Feature Interactions

- **Partitioning + unique constraints**: `PRIMARY KEY` and `UNIQUE` must include all partition key columns.
- **Partitioning + foreign keys**: Referencing or referenced partitioned tables needs PG 12+.
- **Partitioning + logical replication**: Set `publish_via_partition_root = true` if consumers expect the parent table name.
- **Partitioning + ORMs**: Queries that omit the partition key often scan every partition.
- **Partitioning + prepared statements**: Cast mismatches or generic plans can weaken pruning.
- **Partitioning + DEFAULT**: DEFAULT keeps inserts alive but blocks later partition creation until you move trapped rows.

## Diagnostic Checklist

| Symptom | Run | Look for | Fix |
|---------|-----|----------|-----|
| Query scans all partitions | `EXPLAIN (COSTS OFF) SELECT ... WHERE created_at >= TIMESTAMPTZ '2024-01-01' AND created_at < TIMESTAMPTZ '2024-02-01';` | `Subplans Removed` missing or `0` | Use typed predicates on partition key |
| Need partition inventory | `SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'events'::regclass;` | Missing future partition or DEFAULT | Pre-create next partitions |
| Attach fails | `SELECT count(*) FROM events_default WHERE created_at >= '2024-03-01' AND created_at < '2024-04-01';` | Rows trapped in DEFAULT | Move rows out, then attach or create |
| Old partition detach blocks traffic | `SELECT version();` | PG 14 or newer determines `CONCURRENTLY` support | Use `DETACH ... CONCURRENTLY` on PG 14+ |

```sql
-- Prove pruning works
EXPLAIN (COSTS OFF)
SELECT *
FROM events
WHERE created_at >= TIMESTAMPTZ '2024-01-01'
  AND created_at < TIMESTAMPTZ '2024-02-01';
```

## Error Messages

| Error | Root cause | Fix |
|-------|------------|-----|
| `no partition of relation "events" found for row` | No matching partition and no usable DEFAULT | Add partition or DEFAULT; fix bounds |
| `unique constraint on partitioned table must include all partitioning columns` | PK or UNIQUE omits partition key | Include partition key columns in constraint |
| `updated partition constraint for default partition "events_default" would be violated by some row` | DEFAULT already contains rows for the new range | Move rows out of DEFAULT first |

## Common Mistakes / Gotchas

- **Use hash partitioning for time-series**: Range partitioning prunes by date; hash does not.
- **Assume pruning survived a cast**: `date` literals against `timestamptz` keys often break pruning.
- **Create hundreds of partitions by default**: Planning cost rises fast. Keep count deliberate.
- **Expect `DROP PARTITION` syntax**: PostgreSQL uses `DETACH PARTITION`, then `DROP TABLE`.
- **Assume uniqueness is global without the key**: PostgreSQL will reject it.
- **Rely on DEFAULT forever**: It is a safety net, not the steady-state design.

```sql
-- PG 14+
ALTER TABLE events DETACH PARTITION events_2023_01 CONCURRENTLY;

-- Minimal gotcha example: uniqueness must include partition key
ALTER TABLE events
    ADD PRIMARY KEY (id, created_at);
```

## Anti-Hallucination Rules

- Do not claim `DETACH PARTITION CONCURRENTLY` works before PG 14.
- Do not claim global uniqueness works without including the partition key.
- Do not invent non-existent syntax such as `DROP PARTITION` or `MERGE PARTITIONS`.
- Do not recommend partitioning when queries do not filter on a stable key.
- Do not claim PG 11 or earlier supports foreign keys to and from partitioned tables like PG 12+.
