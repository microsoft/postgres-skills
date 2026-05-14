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
- User asks "what index should I create" or "which index type should I use"
- Query uses JSONB containment (@>), array operators, tsvector, geometric/range types
- EXPLAIN output shows sequential scan on a large table
- User mentions partial indexes, expression indexes, or covering indexes
- Error: "Seq Scan on <table>" in EXPLAIN with high row counts

**Do NOT use when:**
- Query is slow due to configuration (work_mem, shared_buffers, statistics) not missing indexes (use `postgresql/query-performance/`)
- User needs Azure-specific intelligent tuning recommendations (use `azure-postgresql/intelligent-tuning/`)
- Table has fewer than 10,000 rows (seq scan may be optimal)
- User needs EXPLAIN interpretation or planner behavior guidance (use `postgresql/query-performance/`)

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

1. **Missing expression match**: Expression index must exactly match the expression in the query (e.g., `lower(email)` index won't help `UPPER(email)` query)
2. **BRIN on randomly-ordered data**: BRIN only works when physical row order correlates with column values. Check correlation: `SELECT correlation FROM pg_stats WHERE tablename='t' AND attname='col'` (needs > 0.9)
3. **Ignoring index-only scans**: Add `INCLUDE` columns to avoid heap fetches: `CREATE INDEX ON orders(status) INCLUDE (total, created_at)` — PG 12+ covering index
4. **Not detecting unused indexes**: Query `pg_stat_user_indexes` for `idx_scan = 0` to find indexes wasting write amplification and storage
5. **Partial index predicate mismatch**: The WHERE clause in the query must be a superset of the partial index predicate or the planner won't use it
6. **REINDEX without CONCURRENTLY**: `REINDEX INDEX idx` locks the table. Use `REINDEX INDEX CONCURRENTLY idx` (PG 12+) to rebuild without blocking
7. **Multi-column B-tree column order**: Leftmost column must appear in the query's WHERE clause or the index is unusable. Column order matters: put equality filters first, range filters last

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
