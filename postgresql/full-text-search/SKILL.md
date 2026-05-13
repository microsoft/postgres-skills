---
name: full-text-search
description: "PostgreSQL native full-text search with tsvector, tsquery, GIN indexes, and ranking functions"
version: "1.0.0"
tags: [postgresql, full-text-search, tsvector, tsquery, gin, ranking]
execution_mode: mutate
requires_confirmation: false
platform_scope: postgresql
---

# Full-Text Search

## When to Use

**Trigger when:**
- User asks about "search" or "text search" in PostgreSQL
- User mentions `tsvector`, `tsquery`, `to_tsvector`, `ts_rank`
- User wants to replace LIKE/ILIKE with ranked search
- User needs language-aware stemming, stop words, or phrase search
- User asks "how to rank search results by relevance"

**Do NOT use when:**
- User needs vector similarity search (use `azure-postgresql/vector-diskann/`)
- Exact substring matching is sufficient (use `LIKE` or trigram `pg_trgm`)
- User needs Azure hybrid search combining FTS + vectors (use `azure-postgresql/rag-pipeline/`)

**Overlaps with:**
- `postgresql/advanced-indexing/` (GIN index on tsvector column)
- `azure-postgresql/rag-pipeline/` (hybrid search combines FTS with vector)

## Prerequisites

- PostgreSQL 12+ (phrase search, websearch_to_tsquery)
- `psql` or MCP `execute_sql` tool

## Instructions

**Step 1: Add a stored tsvector column (recommended for performance)**

```sql
ALTER TABLE articles ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'B')
    ) STORED;

CREATE INDEX idx_articles_search ON articles USING gin(search_vector);
```

**Step 2: Query with ranking**

```sql
SELECT title, ts_rank(search_vector, query) AS rank
FROM articles, websearch_to_tsquery('english', 'postgresql performance') AS query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 10;
```

**Step 3: Choose the right tsquery function**

| Function | Input | Use Case |
|----------|-------|----------|
| `plainto_tsquery` | plain text | Simple keyword search |
| `websearch_to_tsquery` | Google-like syntax | User-facing search box |
| `phraseto_tsquery` | exact phrase | "exact phrase" matching |
| `to_tsquery` | operators (& \| !) | Advanced boolean search |

## Common Mistakes

1. **LIKE instead of FTS**: `WHERE body LIKE '%search%'` cannot use indexes efficiently and has no ranking
2. **Missing language config**: `to_tsvector(body)` uses `default_text_search_config`. Specify language explicitly: `to_tsvector('english', body)`
3. **No stored column**: Computing `to_tsvector()` on every query is expensive. Use a generated stored column + GIN index
4. **Wrong weight assignment**: Weight 'A' = highest relevance. Put title in 'A', body in 'B', metadata in 'C'

## Verification

```sql
-- Confirm GIN index is used
EXPLAIN SELECT * FROM articles WHERE search_vector @@ to_tsquery('postgresql');
-- Should show: Bitmap Index Scan on idx_articles_search

-- Test ranking returns relevant results first
SELECT title, ts_rank(search_vector, to_tsquery('performance & tuning')) AS rank
FROM articles WHERE search_vector @@ to_tsquery('performance & tuning')
ORDER BY rank DESC LIMIT 5;
```

## Failure Recovery

- **Zero results**: Check language config matches content language. `SELECT to_tsvector('english', 'running')` should stem to `run`
- **Index not used**: Ensure query uses `@@` operator against the indexed tsvector column, not a function call
- **Slow on updates**: GIN index updates are batched. For write-heavy tables, tune `gin_pending_list_limit`
