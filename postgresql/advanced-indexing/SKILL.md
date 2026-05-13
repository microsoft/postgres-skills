---
name: advanced-indexing
description: "B-tree, GIN, GiST, BRIN, partial, and expression index strategies for PostgreSQL"
version: "1.0.0"
tags: [postgresql, indexing, performance, gin, gist, brin]
execution_mode: mutate
requires_confirmation: false
platform_scope: postgresql
---

# Advanced Indexing Strategy

## When to Use

**Trigger when:**
- User asks "what index should I create" or "why is my query slow"
- Query uses JSONB containment (@>), array operators, tsvector, geometric/range types
- EXPLAIN output shows sequential scan on a large table
- User mentions partial indexes, expression indexes, or covering indexes
- Error: "Seq Scan on <table>" in EXPLAIN with high row counts

**Do NOT use when:**
- Query is slow due to configuration (work_mem, shared_buffers) not missing indexes
- User needs Azure-specific intelligent tuning recommendations
- Table has fewer than 10,000 rows (seq scan may be optimal)

**Overlaps with:**
- `postgresql/query-performance/` (EXPLAIN analysis may reveal missing index)
- `postgresql/jsonb-patterns/` (GIN indexes on JSONB columns)

## Prerequisites

- `psql` or MCP `execute_sql` tool
- PostgreSQL 12+ (for covering indexes with INCLUDE)
- Access to `pg_stat_user_indexes` for usage analysis

## Instructions

**Step 1: Identify the correct index type**

| Data Type / Query Pattern | Index Type | Example |
|--------------------------|-----------|---------|
| Equality, range on scalars | B-tree (default) | `CREATE INDEX ON orders(created_at)` |
| JSONB containment (@>), arrays | GIN | `CREATE INDEX ON docs USING gin(data)` |
| JSONB with only @> queries | GIN (jsonb_path_ops) | `CREATE INDEX ON docs USING gin(data jsonb_path_ops)` |
| Geometric, range overlap | GiST | `CREATE INDEX ON geo USING gist(location)` |
| Time-ordered append-only | BRIN | `CREATE INDEX ON logs USING brin(created_at)` |
| Full-text search (tsvector) | GIN | `CREATE INDEX ON posts USING gin(search_vector)` |

**Step 2: Partial indexes for filtered queries**

If the query always includes a constant predicate:

```sql
-- Query: SELECT * FROM orders WHERE status = 'active' AND created_at > ...
CREATE INDEX idx_orders_active ON orders(created_at)
  WHERE status = 'active';
```

**Step 3: Expression indexes for computed predicates**

```sql
-- Query: SELECT * FROM users WHERE lower(email) = '...'
CREATE INDEX idx_users_email_lower ON users(lower(email));
```

## Common Mistakes

1. **B-tree for everything**: Agents default to B-tree even for JSONB/array containment queries where GIN is required
2. **Missing expression match**: Expression index must exactly match the expression in the query (e.g., `lower(email)` index won't help `UPPER(email)` query)
3. **Full-table index when partial suffices**: Creates unnecessary write overhead and storage
4. **BRIN on randomly-ordered data**: BRIN only works when physical row order correlates with column values

## Verification

```sql
-- Confirm index is used
EXPLAIN (ANALYZE, BUFFERS) <your_query>;
-- Look for: "Index Scan" or "Bitmap Index Scan" (not "Seq Scan")

-- Check index size savings (partial vs full)
SELECT pg_size_pretty(pg_relation_size('idx_orders_active'));
```

## Failure Recovery

- **Index not used**: Run `ANALYZE <table>` to update statistics, then re-check EXPLAIN
- **Permission denied**: Verify role has CREATE privilege on the schema
- **Index build too slow on large table**: Use `CREATE INDEX CONCURRENTLY` to avoid locking writes
- **Wrong index type error**: GIN/GiST require the correct operator class; check `pg_opclass` for available classes
