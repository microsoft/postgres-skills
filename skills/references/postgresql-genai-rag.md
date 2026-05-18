---
name: postgresql-genai-rag
description: "Build RAG pipelines and semantic search on any PostgreSQL with pgvector — embedding storage, hybrid search, reciprocal rank fusion."
tags: [postgresql, rag, embeddings, vector, hybrid-search, semantic-search, pgvector]
platform_scope: postgresql
---

# GenAI / RAG Patterns with pgvector

## Prerequisites

- PostgreSQL 13+ with `vector` extension
- An embedding API (OpenAI, Cohere, HuggingFace, local model, etc.)
- For hybrid search: full-text search setup (tsvector/tsquery)

## RAG Architecture (Application-Driven)

```
User Query → App generates embedding → PostgreSQL vector search → Top-K docs → LLM prompt → Response
```

**Step 1: Schema for RAG**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_base (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),
    content_tsvector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

-- Vector index for similarity search
CREATE INDEX ON knowledge_base USING hnsw (embedding vector_cosine_ops);

-- GIN index for full-text search
CREATE INDEX ON knowledge_base USING gin (content_tsvector);
```

**Step 2: Insert with embeddings from your application**

```sql
INSERT INTO knowledge_base (content, metadata, embedding)
VALUES ($1, $2::jsonb, $3::vector);
```

Your application calls the embedding API (e.g., OpenAI `text-embedding-3-small`) and passes the vector to PostgreSQL.

**Step 3: Semantic search (vector only)**

```sql
SELECT id, content, metadata,
       embedding <=> $1::vector AS distance
FROM knowledge_base
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

**Step 4: Hybrid search with Reciprocal Rank Fusion (RRF)**

Combine vector similarity with full-text relevance for better retrieval:

```sql
WITH vector_results AS (
    SELECT id, content, metadata,
           ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS vector_rank
    FROM knowledge_base
    ORDER BY embedding <=> $1::vector
    LIMIT 20
),
text_results AS (
    SELECT id, content, metadata,
           ROW_NUMBER() OVER (ORDER BY ts_rank(content_tsvector, websearch_to_tsquery('english', $2)) DESC) AS text_rank
    FROM knowledge_base
    WHERE content_tsvector @@ websearch_to_tsquery('english', $2)
    LIMIT 20
)
SELECT COALESCE(v.id, t.id) AS id,
       COALESCE(v.content, t.content) AS content,
       COALESCE(v.metadata, t.metadata) AS metadata,
       COALESCE(1.0 / (60 + v.vector_rank), 0) +
       COALESCE(1.0 / (60 + t.text_rank), 0) AS rrf_score
FROM vector_results v
FULL OUTER JOIN text_results t ON v.id = t.id
ORDER BY rrf_score DESC
LIMIT 10;
```

The constant `60` in RRF is the standard smoothing factor (k=60). Adjust based on result distribution.

## Chunking Strategy

| Content type | Chunk size | Overlap |
|---|---|---|
| Documentation | 500–1000 tokens | 50–100 tokens |
| Code | Per function/class | None |
| Conversations | Per message or turn | 1 preceding message |
| Tables/structured | Per row or logical group | None |

## Common Mistakes

1. **[CRITICAL] No index on vector column**: Every similarity query becomes a full table scan
2. **[HIGH] Embedding dimension mismatch**: Column dimension must match model output exactly
3. **[HIGH] Skipping hybrid search**: Pure vector search misses keyword-exact matches; pure text search misses semantic similarity. Combine both for best retrieval.
4. **[MEDIUM] Not chunking large documents**: Embedding a 10K-word doc loses detail. Chunk to 500–1000 tokens with overlap.
5. **[MEDIUM] Stale embeddings**: If content updates, embeddings must be regenerated. Use triggers or batch jobs.

## When to use Azure-specific features

- **azure_ai extension** (in-database embeddings without app roundtrip): See `azure-postgresql-genai-patterns` (requires Azure connection)
- **DiskANN indexes** (faster filtered search at scale): See `azure-postgresql-vector-diskann` (requires Azure connection)

## References

- [pgvector documentation](https://github.com/pgvector/pgvector)
- [Reciprocal Rank Fusion paper](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
