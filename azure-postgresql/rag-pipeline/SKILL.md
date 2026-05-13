---
name: rag-pipeline
description: "Build end-to-end RAG pipelines on Azure Database for PostgreSQL: hybrid search combining vector similarity with full-text search, reciprocal rank fusion, and retrieval patterns"
version: "1.0.0"
tags: [azure, postgresql, rag, hybrid-search, rrf, retrieval, vector, full-text]
execution_mode: mutate
requires_confirmation: false
platform_scope: azure-postgresql
---

# RAG Pipeline

## When to Use

**Trigger when:**
- User asks about RAG (Retrieval-Augmented Generation) with PostgreSQL
- User asks about hybrid search combining vector + full-text search
- User mentions "reciprocal rank fusion" or RRF
- User wants to retrieve context for an LLM from a PostgreSQL database
- User asks how to combine semantic search with keyword search

**Do NOT use when:**
- User only needs vector similarity search (use `azure-postgresql/vector-diskann/`)
- User only needs full-text search without vectors (use `postgresql/full-text-search/`)
- User needs to generate embeddings (use `azure-postgresql/embeddings-azure-ai/`)
- User needs to call LLM for generation (use `azure-postgresql/ai-functions/`)

**Overlaps with:**
- `azure-postgresql/vector-diskann/` (vector search is one component)
- `postgresql/full-text-search/` (FTS is one component)
- `azure-postgresql/embeddings-azure-ai/` (embedding generation feeds RAG)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Extensions: `vector`, `pg_diskann` (or HNSW), `azure_ai`
- Table with both `tsvector` column and `vector` embedding column
- MCP `execute_sql` tool or `psql`

## Instructions

**Step 1: Prepare table with both search modalities**

```sql
CREATE TABLE knowledge_base (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title text,
    content text,
    metadata jsonb,
    embedding vector(1536),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
        setweight(to_tsvector('english', coalesce(content,'')), 'B')
    ) STORED
);

-- Create both indexes
CREATE INDEX idx_kb_embedding ON knowledge_base USING diskann (embedding vector_cosine_ops);
CREATE INDEX idx_kb_search ON knowledge_base USING gin (search_vector);
```

**Step 2: Hybrid search with Reciprocal Rank Fusion (RRF)**

```sql
WITH vector_results AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank_v
    FROM knowledge_base
    ORDER BY embedding <=> $1::vector
    LIMIT 20
),
text_results AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, query) DESC) AS rank_t
    FROM knowledge_base, websearch_to_tsquery('english', $2) AS query
    WHERE search_vector @@ query
    LIMIT 20
)
SELECT kb.id, kb.title, kb.content,
    COALESCE(1.0/(60 + v.rank_v), 0) + COALESCE(1.0/(60 + t.rank_t), 0) AS rrf_score
FROM knowledge_base kb
LEFT JOIN vector_results v ON kb.id = v.id
LEFT JOIN text_results t ON kb.id = t.id
WHERE v.id IS NOT NULL OR t.id IS NOT NULL
ORDER BY rrf_score DESC
LIMIT 5;
```

**Step 3: Add metadata filtering**

```sql
-- Add WHERE clause to both CTEs for metadata-filtered RAG
WHERE metadata->>'department' = 'engineering'
```

**Step 4: Format context for LLM**

```sql
-- Concatenate top results into a context string
SELECT string_agg(
    format('## %s\n%s', title, content),
    E'\n\n'
    ORDER BY rrf_score DESC
) AS context
FROM (/* hybrid search query above */) ranked
LIMIT 5;
```

## Common Mistakes

1. **Vector-only search**: Pure vector search misses exact keyword matches. Hybrid search with RRF consistently outperforms single-modality
2. **RRF constant too low**: The constant `k=60` in `1/(k+rank)` controls rank smoothing. Lower k amplifies top-rank differences. Default 60 works well for most cases
3. **Mismatched query**: Vector query uses the embedding of the user question. Text query uses the raw text. Both must be derived from the same user input
4. **Too many results**: Returning 20+ chunks to an LLM wastes tokens and adds noise. Return 3-5 highly relevant chunks
5. **403/PermissionDenied**: Ensure `azure_ai` extension is configured for embedding the query
6. **Chunking too large**: Chunks > 512 tokens dilute embedding quality. Split content into 256-512 token chunks with 50-token overlap for best retrieval
7. **No metadata filtering**: Always include a WHERE clause for tenant/category before vector search. DiskANN handles pre-filtering efficiently; HNSW requires post-filtering
8. **Embedding the entire user prompt**: Strip system instructions and chat history. Embed only the user's actual question for query vector
9. **Not using azure_ai.create_embeddings in SQL**: Calling an external API to get query embeddings adds latency. Use the in-database function for single-query embedding at search time

## Verification

```sql
-- Test hybrid search returns results from both modalities
WITH vector_results AS (...), text_results AS (...)
SELECT
    (SELECT count(*) FROM vector_results) AS vector_hits,
    (SELECT count(*) FROM text_results) AS text_hits;

-- Verify RRF scores are reasonable (> 0)
-- Top result should have score from BOTH modalities when query is clear
```

## Failure Recovery

- **Zero results from text search**: Check tsvector language matches content language. Try `plainto_tsquery` instead of `websearch_to_tsquery`
- **Zero results from vector search**: Verify embeddings exist (not NULL) and embedding dimension matches query vector
- **Low relevance**: Increase the LIMIT in each CTE (retrieve more candidates) then still return top 5 after RRF
