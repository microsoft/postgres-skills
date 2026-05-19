---
name: genai-patterns
description: Generate vector embeddings (in-database via azure_ai OR external via app + pgvector) and build RAG pipelines with hybrid search on Azure Database for PostgreSQL.
tags: [azure, postgresql, embeddings, vector, pgvector, rag, hybrid-search, RRF, azure-openai, genai]
activation:
 user_intent:
 - generate embeddings for my table
 - build a RAG pipeline
 - combine vector search with keyword search
 - store embeddings from my application
 - hybrid search with reciprocal rank fusion
 - semantic search on my PostgreSQL data
 - embed user query in SQL and search similar documents
 technical_keywords:
 - create_embeddings
 - embedding
 - RAG
 - hybrid search
 - RRF
 - tsvector
 - vector similarity
 - pgvector
 - azure_openai.create_embeddings
 - vector(1536)
 - reciprocal rank fusion
 - semantic search
 exclusion_conditions:
 - "when user needs vector indexing or DiskANN/HNSW tuning only, use `azure-postgresql/vector-diskann/` instead"
 - "when user needs text generation / classification / extraction, use `azure-postgresql/azure-ai/` instead"
 adjacent_skills:
 - "`azure-postgresql/azure-ai/`"
 - "`azure-postgresql/vector-diskann/`"
---

## Key Facts (what models get wrong)

| Fact | Detail |
|------|--------|
| Dimension match required | Column `vector(N)` MUST match model output (1536 for 3-small, 3072 for 3-large) |
| Operator/index pairing | `<=>` needs `vector_cosine_ops`, `<->` needs `vector_l2_ops`. Mismatch = no index use |
| azure_ai is single-row | `azure_openai.create_embeddings` processes ONE text per call. Loop in SQL required |
| DiskANN is Azure-only | Not available on self-hosted PG or Burstable tier |
| Max dimensions | 16000 on Azure Flexible Server |
| Rate limits shared | azure_ai calls share quota with your Azure OpenAI deployment (429 errors on batch) |
| Extension prerequisite | `CREATE EXTENSION vector;` THEN `CREATE EXTENSION azure_ai;` (order matters) |

## Path Decision: In-database vs External Embeddings

**Path A — In-database (azure_ai extension):** SQL-only workflows, batch processing via Azure OpenAI.

**Path B — External (app-side):** App generates embeddings using any OpenAI-compatible SDK, then stores them via INSERT.

| Factor | Path A: In-database (azure_ai) | Path B: External (app-side) |
|--------|----------------------|---------------------|
| Best for | SQL-only workflows, batch processing | App with existing OpenAI SDK |
| Models available | Azure OpenAI only | Any embedding model |
| Batching | Loop in SQL with `pg_sleep` | App controls batch size |
| Chunking | Limited (SQL string ops) | Full (NLP libraries) |
| Rate limit control | Server-level quota | App-level quota |

## Index Decision: DiskANN vs HNSW

| Factor | DiskANN | HNSW |
|--------|---------|------|
| Scale | >1M rows | <1M rows |
| Memory | Disk-based (lower RAM) | In-memory (higher RAM) |
| Portability | Azure-only | Any PostgreSQL with pgvector |
| Build time | Faster for large datasets | Slower at scale |

## Hybrid Search Pattern (vector + FTS)

Key formula: **Reciprocal Rank Fusion (RRF)**

    rrf_score = 1/(60 + vector_rank) + 1/(60 + fts_rank)

Requirements: GIN index on tsvector column + vector index on embedding column.

## Critical Gotchas

1. **"type vector does not exist"**: `CREATE EXTENSION vector;` first. On Azure, add to allowlist
2. **"azure_openai.create_embeddings does not exist"**: azure_ai not installed/configured
3. **Silent truncation**: Models truncate beyond token limit without error. Pre-chunk (500-1000 tokens)
4. **Context window budget**: 80% for retrieved context, 20% for response
5. **No batch input**: azure_openai.create_embeddings takes single text, not array
6. **Operator mismatch**: Index with `vector_cosine_ops` but query with `<->` (L2) = sequential scan

## Anti-Hallucination Rules

- azure_openai.create_embeddings does NOT accept array/batch input
- DiskANN does NOT work on self-hosted PostgreSQL
- Cannot use non-Azure-OpenAI models with azure_ai extension
- azure_ai requires explicit endpoint configuration (not auto-discovered)

## SQL Examples

**Path B: Store externally generated embeddings**

```sql no-execute
-- Table with vector column — dimension must match your model output
CREATE TABLE documents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content text NOT NULL,
    embedding vector(1536)  -- 1536 for text-embedding-3-small
);

-- Insert with app-generated embedding (Path B: app calls OpenAI SDK)
INSERT INTO documents (content, embedding)
VALUES ($1, $2::vector);  -- $2 is float array from your embedding model
```

**Cosine similarity search**

```sql no-execute
-- Find top-10 most similar documents using cosine distance
SELECT id, content, 1 - (embedding <=> $1) AS similarity
FROM documents
ORDER BY embedding <=> $1
LIMIT 10;
```

## References
- [Generate embeddings with azure_ai](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-openai)
- [Semantic search](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-semantic-search)
