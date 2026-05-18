---
name: postgresql-vector-search
description: "Vector similarity search with pgvector on any PostgreSQL — HNSW indexes, distance operators, and embedding storage."
tags: [postgresql, vector, pgvector, hnsw, similarity-search, embeddings]
platform_scope: postgresql
---

# Vector Search with pgvector

## Prerequisites

- PostgreSQL 13+ (pgvector requires PG13 minimum)
- Extension: `vector` installed (`CREATE EXTENSION vector;`)

## Instructions

**Step 1: Install pgvector**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**Step 2: Create table with vector column**

```sql
CREATE TABLE documents (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(1536)  -- dimension must match your model
);
```

**Step 3: Insert embeddings**

```sql
INSERT INTO documents (content, embedding)
VALUES ('Your text here', '[0.1, 0.2, ...]'::vector);
```

**Step 4: Create HNSW index**

```sql
CREATE INDEX ON documents
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);
```

Index parameter guidance:
- `m` (default 16): Higher = better recall, more memory. Range: 8–64.
- `ef_construction` (default 64): Higher = better index quality, slower build. Range: 64–512.

**Step 5: Query nearest neighbors**

```sql
SELECT id, content, embedding <=> $1::vector AS distance
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

## Distance Operators

| Operator | Metric | Use when |
|----------|--------|----------|
| `<=>` | Cosine distance | Text embeddings (normalized) — most common |
| `<->` | L2 (Euclidean) | Image embeddings, spatial data |
| `<#>` | Negative inner product | Pre-normalized vectors, max similarity |

## Query-time tuning

```sql
-- Increase search scope for better recall (default: 40)
SET hnsw.ef_search = 200;
```

Higher `ef_search` = better recall but slower queries. Start at 100, increase if recall is insufficient.

## Common Mistakes

1. **[CRITICAL] Forgetting to create an index**: Without HNSW, queries do sequential scan — O(n) on every query
2. **[HIGH] Wrong distance operator**: Use `<=>` for normalized text embeddings (OpenAI, Cohere), `<->` for unnormalized
3. **[HIGH] Dimension mismatch**: Vector column dimension must exactly match your embedding model output
4. **[MEDIUM] Not running ANALYZE after bulk insert**: The planner needs statistics to choose index scan over seq scan
5. **[HIGH] Index not used**: If query returns too many rows or table is small, planner may prefer seq scan. Test with `SET enable_seqscan = off;` then run `ANALYZE`

## When to use this vs Azure DiskANN

- **Any PostgreSQL (self-hosted, RDS, Cloud SQL)**: Use HNSW (this reference)
- **Azure Database for PostgreSQL with DiskANN**: DiskANN offers better filtered search and lower memory. See `azure-postgresql-vector-diskann` reference (requires Azure connection)

## References

- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [pgvector docs](https://github.com/pgvector/pgvector#readme)
