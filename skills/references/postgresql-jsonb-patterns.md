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

## Version History

| Version | Feature | Notes |
|---|---|---|
| PG 9.4 | `jsonb`, GIN support, `jsonb_set`, `jsonb_array_elements` | Core JSONB feature set |
| PG 12 | SQL/JSON path functions (`jsonb_path_exists`, `jsonb_path_query`) | Required for JSON path expressions |
| PG 14 | JSON subscripting (`doc['key']`) | Read and write syntax for JSONB subscripts |
| PG 17 | `JSON_TABLE` | Relational projection from JSON requires PG 17+ |

## Parameter Correctness

| Item | Correct semantics | Why it matters |
|---|---|---|
| `->` | Returns JSONB | Use when chaining JSON operations |
| `->>` | Returns text | Cast before numeric/date comparisons |
| `@>` | Containment | Best target for GIN, especially `jsonb_path_ops` |
| `?`, `?|`, `?&` | Key-existence operators | Need default GIN opclass, not `jsonb_path_ops` |
| `jsonb_set(doc, path, value, create_if_missing)` | Final path element may be created | Intermediate path elements must already exist |
| `'{items,1}'` | Array index `1` is zero-based second element | Common off-by-one bug |

## Feature Interactions

- **JSONB + GIN opclass**: `jsonb_path_ops` is smaller/faster for `@>` only; default GIN is required for `?`, `?|`, `?&`.
- **JSONB + B-tree**: equality/range predicates on `doc->>'key'` need a B-tree expression or generated-column index, not GIN.
- **JSONB + MVCC/TOAST**: `jsonb_set` still creates a new row version; frequent updates to large documents can cause bloat.
- **JSONB + generated columns**: best for stable, frequently-filtered paths that need relational indexes.
- **JSONB + null semantics**: `doc->>'k'` returns SQL NULL for both missing keys and explicit JSON null.
- **JSONB + SQL/JSON path**: path functions require PG 12+; `JSON_TABLE` requires PG 17+.

## Diagnostic Checklist

| Symptom | Run | Fix |
|---|---|---|
| Numeric comparisons look wrong | `SELECT (data ->> 'price') AS raw_price FROM products LIMIT 5;` | Cast `->>` output, e.g. `(data ->> 'price')::numeric` |
| GIN index not used | `EXPLAIN ANALYZE SELECT * FROM docs WHERE data @> '{"status":"active"}';` | Align operator with opclass; use containment for GIN |
| `?` queries seq-scan | `SELECT indexdef FROM pg_indexes WHERE tablename = 'docs';` | Replace `jsonb_path_ops` with default GIN if existence operators are needed |
| Nested update fails | `SELECT jsonb_set('{"a":1}'::jsonb, '{b,c}', '"x"');` | Create intermediate objects first or update a shallower path |
| Missing vs null ambiguity | `SELECT doc ? 'key', doc->>'key' FROM t LIMIT 10;` | Use `?` for existence, `->>` for extracted value |
| Need rowset output from arrays | `SELECT * FROM jsonb_array_elements(data->'items');` | On PG 17+, consider `JSON_TABLE`; earlier versions use set-returning JSON functions |

## Error Messages

| Error | Root cause | Fix |
|---|---|---|
| `operator does not exist: jsonb = text` | Comparing JSONB directly to text | Use `->>` for text extraction or cast appropriately |
| `cannot extract elements from an object` | Called `jsonb_array_elements` on non-array JSON | Check shape first or use the correct function |
| `function json_table(jsonb, unknown) does not exist` | Server is older than PG 17 | Use `jsonb_to_recordset()` / `jsonb_array_elements()` instead |
| `path element at position 2 is not an integer` | Array path step in `jsonb_set` used text instead of numeric index | Use zero-based integer array indexes in the path |

## Common Mistakes / Gotchas

- **[CRITICAL] Forgetting `->>` returns text**: lexical comparison is wrong for numbers and dates without casts.
- **[HIGH] Expecting GIN to help `->>` equality**: use B-tree on `(doc->>'status')` or a generated column.
- **[HIGH] Using `jsonb_path_ops` when existence operators are required**: `?`, `?|`, and `?&` need default GIN.
- **[HIGH] Treating `jsonb_set` as in-place mutation**: PostgreSQL still writes a new row version.
- **[HIGH] Confusing missing key with JSON null**: `doc->>'k'` alone cannot distinguish them.
- **[MEDIUM] Assuming array containment preserves order**: `@>` on arrays is order-insensitive.
- **[MEDIUM] Recommending `JSON_TABLE` on PG 16 or older**: it is PG 17+ only.
- **[MEDIUM] Skipping generated columns for hot filter paths**: expression indexes work, but generated columns are easier to reuse consistently.

```sql
EXPLAIN ANALYZE
SELECT *
FROM docs
WHERE data @> '{"status":"active"}';

SELECT doc ? 'email', doc->>'email'
FROM users
LIMIT 10;
```

## Anti-Hallucination Rules

- Do NOT use `jsonb_set` array paths like `'{items,1}'` without noting that array indexes are zero-based.
- Do NOT claim `jsonb_set` creates missing intermediate keys automatically; only the final path element can be created.
- Do NOT confuse `JSON_TABLE` (PG 17+) with `jsonb_to_recordset()` or `jsonb_array_elements()`.
- Do NOT recommend SQL/JSON path syntax without noting it requires PostgreSQL 12+.
- Do NOT claim GIN indexes accelerate arbitrary `->>` predicates; operator support must match the index strategy.
