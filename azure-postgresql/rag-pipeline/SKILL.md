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

1. **In-database embedding for query vector**: Use `azure_openai.create_embeddings('ada-002', user_question)::vector(1536)` directly in the search query instead of calling an external API. Eliminates one network hop and simplifies the pipeline
2. **Hybrid search with RRF scoring pattern**: `WITH vector_results AS (SELECT id, 1.0/(60 + rank) AS score FROM documents ORDER BY embedding <=> query_vec LIMIT 20), text_results AS (SELECT id, 1.0/(60 + rank) AS score FROM documents WHERE to_tsvector('english', content) @@ websearch_to_tsquery('english', query) LIMIT 20) SELECT id, sum(score) AS rrf_score FROM (SELECT * FROM vector_results UNION ALL SELECT * FROM text_results) combined GROUP BY id ORDER BY rrf_score DESC LIMIT 5`
3. **DiskANN pre-filtering for multi-tenant RAG**: `SELECT id, content FROM documents WHERE tenant_id = $1 ORDER BY embedding <=> $2 LIMIT 5` — DiskANN handles the WHERE clause pre-filter natively. HNSW would post-filter and may return fewer than 5 results
4. **Chunk size optimization**: 256-512 tokens per chunk with 50-token overlap. Larger chunks dilute embedding signal. Smaller chunks lose context. Store `chunk_index` and `document_id` to reconstruct full context for the LLM
5. **Query embedding isolation**: Embed ONLY the user's actual question. Strip system prompts, chat history, and instructions before embedding. These add noise and reduce retrieval quality
6. **Azure AI Search hybrid fallback**: For >100M documents, use PostgreSQL for structured/filtered search and Azure AI Search for full-text. Connect via `azure_ai` extension: `SELECT azure_ai.invoke('search-endpoint', jsonb_build_object('search', query, 'filter', tenant_filter))`
7. **Context window management**: Return 3-5 chunks (not 20). Total context for LLM = system prompt + retrieved chunks + user question. Budget: ~2000 tokens for chunks leaves room for system prompt and response. Use `length(content)/4` to estimate tokens
8. **Reranking with AI functions**: After initial retrieval of top-20, rerank with: `SELECT id, content, azure_openai.create('gpt4', 'Score relevance 0-10', content || ' QUERY: ' || user_question)::int AS relevance FROM candidates ORDER BY relevance DESC LIMIT 5`

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
