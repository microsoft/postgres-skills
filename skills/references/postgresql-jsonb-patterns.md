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
    - "SQL/JSON path expression for JSONB"
    - "jsonb subscript syntax"
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
    - jsonb_path_exists
    - jsonb_to_recordset
    - jsonb_array_elements
    - json_table
  exclusion_conditions:
    - "when data is relational and should use normalized tables, do not use this skill"
    - "when user needs full-text search on JSON text values, use `postgresql/full-text-search/` instead"
    - "when JSON is only stored/retrieved whole (no querying needed), do not use this skill"
  adjacent_skills:
    - "`postgresql/advanced-indexing/`"
    - "`postgresql/full-text-search/`"
---

# JSONB Patterns & Optimization

## When to use this skill

Use for production PostgreSQL issues involving:
- GIN index strategy selection (jsonb_path_ops vs default)
- Type casting pitfalls with `->>` operator
- In-place update patterns (jsonb_set vs full-doc replacement)
- Version-gated features (subscripts PG14+, json_table PG17+)
- GIN index not being used for `->>` queries

Avoid explaining basic JSONB operators (`->`, `->>`, `@>`) unless the user asks for a runnable example or is a beginner.

## Response focus

Prioritize indexing mismatches, type casting traps, and version-gated syntax. The base model knows basic JSONB operators well.

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
