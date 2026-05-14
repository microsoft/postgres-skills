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
  exclusion_conditions:
    - "when user needs vector indexing or DiskANN/HNSW tuning only, use `azure-postgresql/vector-diskann/` instead"
    - "when user needs text generation / classification / extraction, use `azure-postgresql/azure-ai/` instead"
    - "when user needs full-text search without vectors, use `postgresql/full-text-search/` instead"
  adjacent_skills:
    - "`azure-postgresql/azure-ai/`"
    - "`azure-postgresql/vector-diskann/`"
    - "`postgresql/full-text-search/`"
---

## Prerequisites
- `vector` extension enabled (`CREATE EXTENSION vector;`)
- For **in-database embeddings**: `azure_ai` extension configured (see `azure-postgresql/azure-ai/`)
- For **external embeddings**: Application with access to an embedding API (Azure OpenAI, OpenAI, Cohere, etc.)
- Azure OpenAI embedding model deployed (e.g., `text-embedding-3-small` — 1536 dimensions)

## Instructions

### Path A — In-database embeddings (azure_ai)

Generate embeddings directly in SQL without leaving the database.

```sql
-- Add vector column
ALTER TABLE documents ADD COLUMN embedding vector(1536);

-- Generate embeddings in batches
DO $$
DECLARE batch_size INT := 100;
DECLARE total_rows INT;
BEGIN
  SELECT count(*) INTO total_rows FROM documents WHERE embedding IS NULL;
  FOR i IN 0..ceil(total_rows::float / batch_size)::int - 1 LOOP
    UPDATE documents
    SET embedding = azure_openai.create_embeddings(
      '<embedding_deployment>',
      content
    )::vector
    WHERE id IN (
      SELECT id FROM documents WHERE embedding IS NULL LIMIT batch_size
    );
    PERFORM pg_sleep(1);  -- rate limit pause
    COMMIT;
  END LOOP;
END $$;
```

### Path B — External embeddings (app + pgvector)

Generate embeddings in your application and store them in PostgreSQL.

```sql
-- Add vector column (match your model's dimensions)
ALTER TABLE documents ADD COLUMN embedding vector(1536);
```

**Python example (Azure OpenAI SDK):**
```python
from openai import AzureOpenAI
import psycopg

client = AzureOpenAI(
    azure_endpoint="https://<resource>.openai.azure.com",
    api_version="2024-06-01"
)

with psycopg.connect(conninfo) as conn:
    rows = conn.execute("SELECT id, content FROM documents WHERE embedding IS NULL LIMIT 100").fetchall()
    for row_id, content in rows:
        resp = client.embeddings.create(input=content, model="text-embedding-3-small")
        vec = resp.data[0].embedding
        conn.execute("UPDATE documents SET embedding = %s WHERE id = %s", (str(vec), row_id))
    conn.commit()
```

**Node.js example:**
```javascript
const { AzureOpenAI } = require("openai");
const { Client } = require("pg");
const client = new AzureOpenAI({ endpoint, apiKey, apiVersion: "2024-06-01" });
// Similar pattern: fetch rows → generate embedding → UPDATE with vector literal
```

### Step 2 — Create vector index

```sql
-- DiskANN (recommended for Azure PostgreSQL, large datasets)
CREATE INDEX ON documents USING diskann (embedding vector_cosine_ops);

-- OR HNSW (good for < 1M rows, higher memory)
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
```

See `azure-postgresql/vector-diskann/` for detailed index tuning.

### Step 3 — Hybrid search (vector + FTS) with RRF

Combine vector similarity with keyword matching for best retrieval quality.

```sql
-- Prerequisite: add tsvector column for FTS
ALTER TABLE documents ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX ON documents USING gin(tsv);

-- Hybrid search with Reciprocal Rank Fusion
WITH vector_results AS (
  SELECT id, content,
    ROW_NUMBER() OVER (ORDER BY embedding <=> azure_openai.create_embeddings('<deployment>', $query)::vector) AS vrank
  FROM documents
  ORDER BY embedding <=> azure_openai.create_embeddings('<deployment>', $query)::vector
  LIMIT 20
),
fts_results AS (
  SELECT id, content,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, query) DESC) AS frank
  FROM documents, plainto_tsquery('english', $query) query
  WHERE tsv @@ query
  LIMIT 20
)
SELECT COALESCE(v.id, f.id) AS id,
  COALESCE(v.content, f.content) AS content,
  COALESCE(1.0/(60 + v.vrank), 0) + COALESCE(1.0/(60 + f.frank), 0) AS rrf_score
FROM vector_results v
FULL OUTER JOIN fts_results f ON v.id = f.id
ORDER BY rrf_score DESC
LIMIT 10;
```

### Step 4 — RAG: Format context for LLM

```sql
-- After retrieval, format context for the generation step
SELECT azure_openai.create(
  '<gpt_deployment>',
  'Answer based only on the provided context. If unsure, say so.',
  'Context:\n' || string_agg(content, E'\n---\n') || E'\n\nQuestion: ' || $query
) AS answer
FROM (
  -- ... hybrid search subquery from Step 3 ...
) top_docs;
```

### Verify

```sql
-- Verify embeddings exist
SELECT id, embedding IS NOT NULL AS has_embedding, array_length(embedding::float[], 1) AS dims
FROM documents LIMIT 5;

-- Test vector search
SELECT id, content, embedding <=> '[0.1, 0.2, ...]'::vector AS distance
FROM documents ORDER BY distance LIMIT 3;

-- Test hybrid search (should return results from both vector and FTS paths)
```

## Common Mistakes

1. **[CRITICAL] Dimension mismatch**: `text-embedding-3-small` = 1536, `text-embedding-3-large` = 3072, `text-embedding-ada-002` = 1536. Column `vector(N)` must match model output.

   ❌ Wrong:
   ```sql
   ALTER TABLE documents ADD COLUMN embedding vector(1536);
   -- Then insert text-embedding-3-large output (3072 dims)
   -- ERROR: expected 1536 dimensions, not 3072
   ```

   ✅ Right:
   ```sql
   -- Match column dimension to your model's output
   ALTER TABLE documents ADD COLUMN embedding vector(3072);  -- for text-embedding-3-large
   ```

2. **[HIGH] Silent truncation**: Models truncate input beyond their token limit without error. Pre-chunk long documents (500-1000 tokens per chunk recommended).
3. **[CRITICAL] Mixing distance operators**: `<=>` (cosine), `<->` (L2), `<#>` (inner product). Use `<=>` for normalized embeddings (most common). Index must match: `vector_cosine_ops` for `<=>`.

   ❌ Wrong:
   ```sql
   CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops);
   -- Then query with L2 distance — index is NOT used
   SELECT * FROM docs ORDER BY embedding <-> $1::vector LIMIT 10;
   ```

   ✅ Right:
   ```sql
   CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops);
   -- Query with matching cosine operator
   SELECT * FROM docs ORDER BY embedding <=> $1::vector LIMIT 10;
   ```

4. **[HIGH] Forgetting FTS index for hybrid search**: Without `GIN` index on `tsvector`, keyword search degrades to sequential scan.
5. **[HIGH] Context window overflow**: GPT-4o supports ~128K tokens. Budget: 80% for context, 20% for response. Track token count when aggregating retrieved chunks.
6. **[MEDIUM] External vs in-database choice**: Use in-database (Path A) when data lives in PostgreSQL and you want SQL-only workflows. Use external (Path B) when your app already calls an embedding API or you need non-Azure embedding models.
7. **[CRITICAL] "type vector does not exist"**: Run `CREATE EXTENSION vector;` first. On Azure, ensure `vector` is in the extension allowlist (see `azure-postgresql/extension-lifecycle/`).

   ❌ Wrong:
   ```sql
   ALTER TABLE docs ADD COLUMN embedding vector(1536);
   -- ERROR: type "vector" does not exist
   ```

   ✅ Right:
   ```sql
   CREATE EXTENSION vector;
   ALTER TABLE docs ADD COLUMN embedding vector(1536);
   ```

8. **[CRITICAL] "azure_openai.create_embeddings does not exist"**: azure_ai extension not installed or not configured. See `azure-postgresql/azure-ai/`.
9. **[HIGH] Dimension error on INSERT/UPDATE**: Column declared as `vector(1536)` but embedding has different length. Check model dimensions.
10. **[HIGH] Hybrid search returns no FTS results**: Verify `tsvector` column is populated and `GIN` index exists.

## References
- [Generate vector embeddings with azure_ai](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-openai#generate-embeddings)
- [Recommendation system using pgvector](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-recommendation-system)
- [Semantic search with Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-semantic-search)
