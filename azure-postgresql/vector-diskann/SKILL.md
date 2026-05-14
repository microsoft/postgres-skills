---
name: vector-diskann
description: "Azure Database for PostgreSQL vector search with DiskANN and pgvector: index selection, filtered search, distance operations, and quantization"
version: "1.0.0"
tags: [azure, postgresql, vector, diskann, pgvector, hnsw, similarity-search]
execution_mode: mutate
requires_confirmation: false
platform_scope: azure-postgresql
---

# Vector Search with DiskANN

## When to Use

**Trigger when:**
- User asks about vector similarity search on Azure PostgreSQL
- User mentions DiskANN, HNSW, or pgvector index types
- User asks "DiskANN vs HNSW" or which vector index to choose
- User needs filtered vector search (metadata + similarity)
- User asks about distance functions (cosine, L2, inner product)

**Do NOT use when:**
- User needs to generate embeddings (use `azure-postgresql/genai-patterns/`)
- User needs end-to-end RAG pipeline (use `azure-postgresql/genai-patterns/`)
- User asks about full-text search ranking (use `postgresql/full-text-search/`)

**Overlaps with:**
- `azure-postgresql/genai-patterns/` (embeddings stored in vector columns, RAG patterns)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Role: `azure_pg_admin` (required for extension management; never superuser on Flexible Server)
- Extensions: `vector` (pgvector) and `pg_diskann` allowlisted and installed
- MCP `execute_sql` tool or `psql`

## Instructions

**Step 1: Install vector extensions**

```sql
CREATE EXTENSION vector;       -- pgvector for vector type + HNSW
CREATE EXTENSION pg_diskann;   -- DiskANN index support
```

**Step 2: Create table with vector column**

```sql
CREATE TABLE documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content text,
    metadata jsonb,
    embedding vector(1536)  -- dimension matches your model output
);
```

**Step 3: Choose index type**

| Index | Best For | Memory | Build Time | Recall |
|-------|----------|--------|-----------|--------|
| HNSW | < 1M vectors, high recall needed | High (in-memory) | Slow | 95-99% |
| DiskANN | > 1M vectors, cost-sensitive | Low (disk-based) | Fast | 95-98% |
| IVFFlat | Legacy, not recommended | Medium | Fast | 85-95% |

**Step 4: Create DiskANN index**

```sql
-- DiskANN for large-scale, cost-effective vector search
CREATE INDEX idx_docs_embedding_diskann ON documents
    USING diskann (embedding vector_cosine_ops);
```

**Step 5: Create HNSW index (alternative)**

```sql
-- HNSW for smaller datasets with maximum recall
CREATE INDEX idx_docs_embedding_hnsw ON documents
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);
```

**Step 6: Query with similarity search**

```sql
-- Cosine similarity (most common for text embeddings)
SELECT id, content, embedding <=> $1::vector AS distance
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- Filtered vector search (DiskANN supports this efficiently)
SELECT id, content, embedding <=> $1::vector AS distance
FROM documents
WHERE metadata->>'category' = 'technical'
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Distance operators:**

| Operator | Distance | Use Case |
|----------|----------|----------|
| `<=>` | Cosine | Text embeddings (normalized) |
| `<->` | L2 (Euclidean) | Image embeddings |
| `<#>` | Negative inner product | When vectors are pre-normalized |

## Common Mistakes

1. **DiskANN availability**: `pg_diskann` requires Flexible Server. Verify with `SELECT * FROM pg_available_extensions WHERE name = 'pg_diskann'` before using in code
2. **Wrong operator class**: Must match distance operator to class. `vector_cosine_ops` for `<=>`, `vector_l2_ops` for `<->`, `vector_ip_ops` for `<#>`. Mismatched class silently returns wrong ordering
3. **HNSW `ef_search` tuning**: `SET hnsw.ef_search = 200` for query-time recall. Default is 40. Higher = better recall but slower
4. **DiskANN filtered search advantage**: DiskANN handles WHERE clause pre-filtering natively (graph traversal with label filter). HNSW post-filters and may return fewer results than LIMIT. For multi-tenant apps, DiskANN is significantly faster
5. **Missing allowlist entries**: Both `vector` AND `pg_diskann` must be in `azure.extensions` server parameter. Forgetting `pg_diskann` gives `ERROR: access to library "pg_diskann" is not allowed`
6. **Wrong distance operator for use case**: `<=>` (cosine) for normalized text embeddings, `<->` (L2) for image embeddings, `<#>` (negative inner product) for pre-normalized vectors
7. **Index build monitoring**: For large tables, monitor DiskANN build progress: `SELECT * FROM pg_stat_progress_create_index`. Use `CREATE INDEX CONCURRENTLY` to avoid blocking writes

## Verification

```sql
-- Verify index is being used
EXPLAIN (ANALYZE) SELECT id FROM documents
ORDER BY embedding <=> '[0.1,0.2,...]'::vector LIMIT 10;
-- Should show: Index Scan using idx_docs_embedding_diskann

-- Check index size
SELECT pg_size_pretty(pg_relation_size('idx_docs_embedding_diskann'));
```

## Failure Recovery

- **Index not used**: Set `SET enable_seqscan = off` to test. If it works, the planner estimates are wrong. Increase `LIMIT` or run `ANALYZE`
- **Low recall**: For HNSW, increase `hnsw.ef_search` (default 40). For DiskANN, increase search list size
- **Build out of memory (HNSW)**: Increase `maintenance_work_mem` or switch to DiskANN
- **403 / permission denied on CREATE EXTENSION**: Verify your role has `azure_pg_admin`: `SELECT pg_has_role(current_user, 'azure_pg_admin', 'member');` Also verify both `vector` and `pg_diskann` are in `azure.extensions` server parameter
