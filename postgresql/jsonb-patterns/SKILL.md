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

**Step 1: GIN indexing strategies**

```sql
-- General queries (@>, ?, ?|, ?& operators)
CREATE INDEX idx_data_gin ON docs USING gin(data);

-- Only @> containment (2-3x smaller index, faster writes)
CREATE INDEX idx_data_pathops ON docs USING gin(data jsonb_path_ops);
```

**Decision**: Use `jsonb_path_ops` when all queries are `@>` containment. Use default GIN if you need `?` (key existence), `?|`, or `?&`.

**Step 2: Type casting — critical for correctness**

```sql
-- WRONG: lexical comparison ('9' > '100' is TRUE)
WHERE (data ->> 'price') > '9'

-- CORRECT: numeric cast
WHERE (data ->> 'price')::numeric > 9
```

**Step 3: Partial indexes on JSONB paths**

```sql
-- Index only active documents (small + fast)
CREATE INDEX idx_active_docs ON docs USING gin(data jsonb_path_ops)
    WHERE data @> '{"status":"active"}';
```

**Step 4: In-place updates (avoid full-document rewrite)**

```sql
UPDATE users SET profile = jsonb_set(profile, '{address,city}', '"Seattle"')
WHERE id = 1;

-- Merge top-level keys
UPDATE users SET profile = profile || '{"verified": true}' WHERE id = 1;
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

1. **[CRITICAL] Missing type cast**: `->>` returns text; comparisons are lexical without cast

   ❌ Wrong:
   ```sql
   SELECT * FROM products WHERE (data ->> 'price') > '9';
   -- Returns wrong results: '9' > '100' is TRUE lexically
   ```

   ✅ Right:
   ```sql
   SELECT * FROM products WHERE (data ->> 'price')::numeric > 9;
   ```

2. **[HIGH] Full-document replacement**: Rewrites entire TOAST tuple

   ❌ Wrong:
   ```sql
   UPDATE users SET profile = '{"name":"Jo","city":"NYC","verified":true}'
   WHERE id = 1;  -- rewrites entire JSONB even if only city changed
   ```

   ✅ Right:
   ```sql
   UPDATE users SET profile = jsonb_set(profile, '{city}', '"NYC"')
   WHERE id = 1;  -- partial update, no full rewrite
   ```

3. **[HIGH] jsonb_path_ops vs default GIN**: `jsonb_path_ops` is 2-3x smaller but ONLY supports `@>`

   ❌ Wrong:
   ```sql
   CREATE INDEX ON docs USING gin(data jsonb_path_ops);
   -- Then query: SELECT * FROM docs WHERE data ? 'email';  -- index NOT used!
   ```

   ✅ Right:
   ```sql
   -- Use default GIN if you need ?, ?|, ?& operators
   CREATE INDEX ON docs USING gin(data);
   -- Or use jsonb_path_ops only when ALL queries use @> containment
   ```

4. **[MEDIUM] Generated column for indexed expressions**: Instead of expression index, use `GENERATED ALWAYS AS (data ->> 'status') STORED` + B-tree — survives `pg_dump`

5. **[MEDIUM] JSONB subscript syntax (PG 14+)**: `data['address']['city']` replaces `data -> 'address' -> 'city'` and supports UPDATE

6. **[MEDIUM] Toast compression (PG 14+)**: Large JSONB benefits from `ALTER TABLE t ALTER COLUMN data SET COMPRESSION lz4` — 2x faster

7. **[HIGH] GIN index not used for `->>` queries**: GIN only supports `@>`, `?`, `?|`, `?&`

   ❌ Wrong:
   ```sql
   -- GIN index exists but ->> query does seq scan
   SELECT * FROM docs WHERE data ->> 'status' = 'active';
   ```

   ✅ Right:
   ```sql
   -- Create B-tree expression index for ->> equality
   CREATE INDEX ON docs((data ->> 'status'));
   ```

8. **[MEDIUM] jsonb_path_ops too restrictive**: Switch to default GIN if you need `?` key-existence queries

9. **[MEDIUM] Large JSONB documents slow**: Use partial indexes on frequently-queried paths

10. **[MEDIUM] `json_table()` (PG 17+ only)**: `SELECT * FROM json_table(data, '$.items[*]' COLUMNS (...))` is PG 17+ only. On PG 16 and earlier, use `jsonb_to_recordset()` or `jsonb_array_elements()` for similar functionality
