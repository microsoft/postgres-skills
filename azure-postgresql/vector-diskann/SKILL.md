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
- User needs to generate embeddings (use `azure-postgresql/embeddings-azure-ai/`)
- User needs end-to-end RAG pipeline (use `azure-postgresql/rag-pipeline/`)
- User asks about full-text search ranking (use `postgresql/full-text-search/`)

**Overlaps with:**
- `azure-postgresql/embeddings-azure-ai/` (embeddings stored in vector columns)
- `azure-postgresql/rag-pipeline/` (vector search is one component of RAG)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
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

1. **DiskANN `search_type` misunderstanding**: `CREATE INDEX ... USING diskann (...) WITH (search_type = 'query')` optimizes for search latency. Use `search_type = 'build'` only during bulk ingestion, then `REINDEX` with `query` mode for production reads
2. **DiskANN `max_neighbors` too high**: Default 32 works for most cases. Setting > 64 increases build time exponentially with marginal recall improvement. Use `WITH (max_neighbors = 48)` only for 99%+ recall requirements
3. **Quantization not enabled at scale**: For > 5M vectors, enable scalar quantization: `CREATE INDEX ... USING diskann (embedding vector_cosine_ops) WITH (quantizer = 'sq8')` reduces storage by 4x with < 2% recall loss
4. **HNSW `ef_search` vs DiskANN `search_list_size`**: HNSW uses `SET hnsw.ef_search = 200`. DiskANN uses `SET diskann.search_list_size = 100`. Different GUCs for different index types
5. **No filtered index strategy**: DiskANN handles pre-filtering natively (scans label list before graph traversal). HNSW requires post-filtering which returns fewer results. For multi-tenant apps, DiskANN with `WHERE tenant_id = X` is 10x faster
6. **Upgrading from HNSW to DiskANN**: Drop HNSW index, `CREATE EXTENSION pg_diskann`, add to allowlist, then `CREATE INDEX CONCURRENTLY ... USING diskann`. Monitor `pg_stat_progress_create_index` for build progress on large tables
7. **Wrong distance operator for use case**: `<=>` (cosine) for text embeddings, `<->` (L2) for image embeddings, `<#>` (inner product) for pre-normalized vectors. Mismatching operator and operator class silently returns wrong results
8. **Not monitoring index build progress**: DiskANN on 10M+ vectors takes hours. Check `SELECT * FROM pg_stat_progress_create_index` for `tuples_done` vs `tuples_total`
9. **Missing `pg_diskann` in allowlist**: Both `vector` AND `pg_diskann` must be in `azure.extensions`. Forgetting `pg_diskann` gives `ERROR: access to library "pg_diskann" is not allowed`

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
