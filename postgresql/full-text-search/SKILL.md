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
- User needs Azure hybrid search combining FTS + vectors (use `azure-postgresql/genai-patterns/`)

**Overlaps with:**
- `postgresql/advanced-indexing/` (GIN index on tsvector column)
- `azure-postgresql/genai-patterns/` (hybrid search combines FTS with vector)

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

1. **`websearch_to_tsquery` not used for user input**: `to_tsquery` throws syntax errors on user input with special chars. Use `websearch_to_tsquery('english', user_input)` which handles Google-like syntax
2. **Phrase search proximity**: `phraseto_tsquery('big data')` requires adjacent. Use distance operator: `to_tsquery('big <2> data')` allows one word between
3. **No hybrid FTS + trigram for typo tolerance**: FTS requires exact stemmed matches. Combine with `pg_trgm` for fuzzy: `WHERE search_vector @@ q OR similarity(title, input) > 0.3`
4. **Multilingual content in single config**: Using 'english' config on French content strips wrong stop words. Use `'simple'` for mixed-language
5. **ts_headline performance**: `ts_headline` rescans full document text. For large docs, highlight a stored summary column instead

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
- **Missing extension**: `pg_trgm` for fuzzy/trigram search: `CREATE EXTENSION IF NOT EXISTS pg_trgm;` If unavailable on managed service, use native `tsvector/tsquery` only
- **Permission denied on CREATE INDEX**: Requires table ownership or `CREATE` privilege on schema. On Azure, verify you have `azure_pg_admin` role
- **Unsupported PG version**: `websearch_to_tsquery()` requires PostgreSQL 11+. For older versions, use `plainto_tsquery()` or `to_tsquery()` with manual AND/OR syntax
