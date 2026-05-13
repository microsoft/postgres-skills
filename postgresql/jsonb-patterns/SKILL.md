---
name: jsonb-patterns
description: "JSONB operator selection, GIN indexing with jsonb_path_ops, and in-place update patterns for PostgreSQL"
version: "1.0.0"
tags: [postgresql, jsonb, json, gin, operators]
execution_mode: mutate
requires_confirmation: false
platform_scope: postgresql
---

# JSONB Patterns & Optimization

## When to Use

**Trigger when:**
- User stores or queries JSON/JSONB columns
- Query uses `->`, `->>`, `@>`, `#>`, `jsonb_path_query()` operators
- User asks about JSONB indexing or "how to query nested JSON"
- Error: type mismatch comparing JSONB values (string vs numeric)
- User mentions `jsonb_set()`, document updates, or schema-less design

**Do NOT use when:**
- Data is relational and should use normalized tables
- User needs full-text search on JSON text values (use `postgresql/full-text-search/`)
- JSON is only stored/retrieved whole (no querying needed)

**Overlaps with:**
- `postgresql/advanced-indexing/` (GIN index creation details)
- `postgresql/full-text-search/` (searching text within JSON fields)

## Prerequisites

- PostgreSQL 12+ (jsonpath support)
- `psql` or MCP `execute_sql` tool

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

## Common Mistakes

1. **`->` vs `->>`**: Using `->` in WHERE with text comparison fails silently (compares jsonb, not text)
2. **Missing type cast**: `(data ->> 'price') > '9'` does lexical comparison, not numeric
3. **B-tree index on JSONB**: B-tree cannot index JSONB containment; use GIN
4. **Full-document replacement**: Using `UPDATE SET data = <entire_json>` instead of `jsonb_set()` for single-field changes

## Verification

```sql
-- Confirm GIN index is used for containment
EXPLAIN SELECT * FROM docs WHERE data @> '{"status":"active"}';
-- Should show: Bitmap Index Scan on idx_data_gin

-- Verify jsonb_path_ops works for your query pattern
EXPLAIN SELECT * FROM docs WHERE data @> '{"nested":{"key":"val"}}';
```

## Failure Recovery

- **Index not used for `->>`**: GIN indexes only support `@>`, `?`, `?|`, `?&`. For `->>` equality, create a B-tree expression index: `CREATE INDEX ON docs((data ->> 'status'))`
- **jsonb_path_ops too restrictive**: Switch to default GIN operator class if you need `?` (key existence) queries
- **Large JSONB documents slow**: Consider partial indexes on frequently-queried paths
