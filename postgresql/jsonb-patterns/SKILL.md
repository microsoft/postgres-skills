---
name: jsonb-patterns
description: "JSONB operator selection, GIN indexing with jsonb_path_ops, and in-place update patterns for PostgreSQL"
tags: [postgresql, jsonb, json, gin, operators]
platform_scope: postgresql
activation:
  user_intent:
    - "how to query JSONB columns"
    - "which JSONB operator should I use"
    - "index JSONB for containment queries"
    - "update nested JSON fields in place"
    - "type mismatch comparing JSONB values"
    - "schema-less design with JSONB"
  technical_keywords:
    - "->"
    - "->>"
    - "@>"
    - "#>"
    - jsonb_path_query
    - jsonb_set
    - jsonb_path_ops
    - GIN
    - TOAST
    - "data['key']"
    - "GENERATED ALWAYS AS"
  exclusion_conditions:
    - "when data is relational and should use normalized tables, do not use this skill"
    - "when user needs full-text search on JSON text values, use `postgresql/full-text-search/` instead"
    - "when JSON is only stored/retrieved whole (no querying needed), do not use this skill"
  adjacent_skills:
    - "`postgresql/advanced-indexing/`"
    - "`postgresql/full-text-search/`"
---

# JSONB Patterns & Optimization

## Instructions

**Step 1: Choose the correct operator**

| Need | Operator | Returns | Example |
|------|----------|---------|---------|
| Extract JSON object | `->` | jsonb | `data -> 'address'` |
| Extract as text | `->>` | text | `data ->> 'name'` |
| Containment check | `@>` | boolean | `data @> '{"type":"premium"}'` |
| Path query | `jsonb_path_query()` | setof jsonb | `jsonb_path_query(data, '$.items[*].price')` |

**Step 2: Fix type casting for comparisons**

```sql
-- WRONG: string comparison ('30' > '100' is TRUE lexically)
WHERE data ->> 'age' > '30'

-- CORRECT: explicit cast
WHERE (data ->> 'age')::int > 30
```

**Step 3: Index with GIN**

```sql
-- General JSONB queries (supports @>, ?, ?|, ?& operators)
CREATE INDEX idx_data_gin ON docs USING gin(data);

-- Only @> containment queries (2-3x smaller index)
CREATE INDEX idx_data_pathops ON docs USING gin(data jsonb_path_ops);
```

**Step 4: In-place updates (avoid read-modify-write)**

```sql
-- Update a nested field
UPDATE users SET profile = jsonb_set(profile, '{address,city}', '"Seattle"')
WHERE id = 1;

-- Merge top-level keys
UPDATE users SET profile = profile || '{"verified": true}'
WHERE id = 1;
```

### Verify

```sql
-- Confirm GIN index is used for containment
EXPLAIN SELECT * FROM docs WHERE data @> '{"status":"active"}';
-- Should show: Bitmap Index Scan on idx_data_gin

-- Verify jsonb_path_ops works for your query pattern
EXPLAIN SELECT * FROM docs WHERE data @> '{"nested":{"key":"val"}}';
```

## Common Mistakes

1. **Missing type cast**: `(data ->> 'price') > '9'` does lexical comparison. Always cast: `(data ->> 'price')::numeric > 9`
2. **Full-document replacement**: `UPDATE SET data = <entire_json>` rewrites the entire TOAST tuple. Use `jsonb_set()` or `||` for partial updates
3. **jsonb_path_ops vs default GIN**: `jsonb_path_ops` is 2-3x smaller but only supports `@>`. Use default GIN if you need `?`, `?|`, `?&`
4. **Generated column for indexed expressions**: Instead of expression index, use `GENERATED ALWAYS AS (data ->> 'status') STORED` + B-tree — survives `pg_dump` and visible in `\d`
5. **JSONB subscript syntax (PG 14+)**: `data['address']['city']` replaces `data -> 'address' -> 'city'` and supports UPDATE: `UPDATE t SET data['score'] = '42'`
6. **Toast compression (PG 14+)**: Large JSONB benefits from `ALTER TABLE t ALTER COLUMN data SET COMPRESSION lz4` — 2x faster vs pglz default
7. **GIN index not used for `->>` queries**: GIN indexes only support `@>`, `?`, `?|`, `?&`. For `->>` equality, create a B-tree expression index: `CREATE INDEX ON docs((data ->> 'status'))`
8. **jsonb_path_ops too restrictive**: Switch to default GIN operator class if you need `?` (key existence) queries
9. **Large JSONB documents slow**: Consider partial indexes on frequently-queried paths
