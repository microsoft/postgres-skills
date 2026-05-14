---
name: advanced-indexing
description: "B-tree, GIN, GiST, BRIN, partial, and expression index strategies for PostgreSQL"
tags: [postgresql, indexing, performance, gin, gist, brin]
platform_scope: postgresql
activation:
  user_intent:
    - "what index should I create"
    - "which index type should I use"
    - "EXPLAIN shows sequential scan on large table"
    - "how to create a partial index"
    - "expression index or covering index"
    - "index for JSONB or array queries"
  technical_keywords:
    - CREATE INDEX
    - GIN
    - GiST
    - BRIN
    - INCLUDE
    - partial index
    - expression index
    - jsonb_path_ops
    - pg_stat_user_indexes
    - idx_scan
    - REINDEX CONCURRENTLY
    - Seq Scan
  exclusion_conditions:
    - "when query is slow due to configuration (work_mem, shared_buffers, statistics) not missing indexes, use `postgresql/query-performance/` instead"
    - "when user needs Azure-specific intelligent tuning recommendations, use `azure-postgresql/intelligent-tuning/` instead"
    - "when table has fewer than 10,000 rows (seq scan may be optimal), do not use this skill"
    - "when user needs EXPLAIN interpretation or planner behavior guidance, use `postgresql/query-performance/` instead"
  adjacent_skills:
    - "`postgresql/query-performance/`"
    - "`postgresql/jsonb-patterns/`"
---

# Advanced Indexing Strategy

## Instructions

**Step 1: Index type decision tree**

| Query Pattern | Index Type | When NOT to use |
|--------------------------|-----------|---------|
| Equality, range on scalars | B-tree | — |
| JSONB `@>`, arrays, tsvector | GIN | Write-heavy tables (batch updates) |
| JSONB only `@>` (no `?` ops) | GIN (jsonb_path_ops) | Need key-existence queries |
| Range overlap, geometric | GiST | Large result sets |
| Time-ordered append-only | BRIN | `correlation < 0.9` (check `pg_stats`) |

**Step 2: Partial indexes (constant predicates)**

```sql
-- Only indexes 'active' rows — 10x smaller if 90% are inactive
CREATE INDEX idx_orders_active ON orders(created_at)
  WHERE status = 'active';
```

**Step 3: Expression indexes**

```sql
CREATE INDEX idx_users_email_lower ON users(lower(email));
-- Expression must EXACTLY match query predicate
```

### Verify

```sql
-- Confirm index is used
EXPLAIN (ANALYZE, BUFFERS) <your_query>;
-- Look for: "Index Scan" or "Bitmap Index Scan" (not "Seq Scan")

-- Check index size savings (partial vs full)
SELECT pg_size_pretty(pg_relation_size('idx_orders_active'));
```

## Common Mistakes

1. **[HIGH] Missing expression match**: Expression index must exactly match the query expression (`lower(email)` index won't help `UPPER(email)` query)

2. **[HIGH] BRIN on randomly-ordered data**: BRIN only works when physical row order correlates with column values

   ❌ Wrong:
   ```sql
   -- user_id is randomly distributed across heap pages
   CREATE INDEX idx_users_brin ON users USING brin(user_id);
   ```

   ✅ Right:
   ```sql
   -- Check correlation first
   SELECT correlation FROM pg_stats WHERE tablename='users' AND attname='user_id';
   -- Only use BRIN if correlation > 0.9
   CREATE INDEX idx_logs_brin ON logs USING brin(created_at);  -- append-only, correlation ~1.0
   ```

3. **[MEDIUM] Ignoring index-only scans**: Add `INCLUDE` columns to avoid heap fetches: `CREATE INDEX ON orders(status) INCLUDE (total, created_at)` (PG 12+)

4. **[MEDIUM] Not detecting unused indexes**: Query `pg_stat_user_indexes` for `idx_scan = 0` to find indexes wasting write amplification

5. **[HIGH] Partial index predicate mismatch**: Query WHERE must be a superset of the partial index predicate or planner won't use it

6. **[CRITICAL] REINDEX without CONCURRENTLY**: `REINDEX INDEX idx` locks the table for writes

   ❌ Wrong:
   ```sql
   REINDEX INDEX idx_orders_status;  -- ACCESS EXCLUSIVE lock
   ```

   ✅ Right:
   ```sql
   REINDEX INDEX CONCURRENTLY idx_orders_status;  -- PG 12+, no lock
   ```

7. **[HIGH] Multi-column B-tree column order**: Leftmost column must appear in WHERE or index is unusable. Equality filters first, range filters last

8. **[MEDIUM] Index not used after creation**: Run `ANALYZE <table>` to update statistics, then re-check EXPLAIN

9. **[MEDIUM] Index build too slow on large table**: Use `CREATE INDEX CONCURRENTLY` to avoid locking writes

10. **[MEDIUM] Wrong index type error**: GIN/GiST require correct operator class; check `pg_opclass`

11. **[MEDIUM] Parallel index build (PG 11+)**: `CREATE INDEX` uses parallel workers on PG 11+. Tune with `SET max_parallel_maintenance_workers = 4` for faster builds on large tables. Not available on PG 10 and earlier
