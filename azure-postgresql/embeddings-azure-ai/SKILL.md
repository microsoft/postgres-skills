---
name: embeddings-azure-ai
description: "Generate vector embeddings using azure_ai extension with Azure OpenAI: single and batch embedding creation within PostgreSQL"
version: "1.0.0"
tags: [azure, postgresql, embeddings, azure-openai, azure-ai, vector]
execution_mode: mutate
requires_confirmation: false
platform_scope: azure-postgresql
---

# Embeddings with Azure AI

## When to Use

**Trigger when:**
- User asks how to generate embeddings inside PostgreSQL
- User mentions `azure_openai.create_embeddings()` or in-database embedding
- User wants to embed text without leaving the database
- User asks about batch embedding for existing table data
- User needs to set up Azure OpenAI integration in PostgreSQL

**Do NOT use when:**
- User asks about vector index types or search (use `azure-postgresql/vector-diskann/`)
- User needs end-to-end RAG (use `azure-postgresql/rag-pipeline/`)
- User needs the azure_ai extension setup itself (use `azure-postgresql/azure-ai-extension/`)

**Overlaps with:**
- `azure-postgresql/azure-ai-extension/` (extension setup required before embeddings work)
- `azure-postgresql/vector-diskann/` (embeddings are stored in vector columns)
- `azure-postgresql/rag-pipeline/` (embedding is one step in RAG)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- `azure_ai` extension installed (see `azure-postgresql/azure-ai-extension/`)
- Azure OpenAI endpoint configured with an embedding model deployed
- MCP `execute_sql` tool or `psql`

## Instructions

**Step 1: Verify azure_ai is configured**

```sql
-- Check endpoint is set
SELECT azure_ai.get_setting('azure_openai.endpoint');
```

**Step 2: Generate a single embedding**

```sql
SELECT azure_openai.create_embeddings(
    'text-embedding-ada-002',  -- deployment name in Azure OpenAI
    'PostgreSQL is a powerful open-source database'
)::vector AS embedding;
```

**Step 3: Add embedding column and populate**

```sql
-- Add vector column
ALTER TABLE documents ADD COLUMN embedding vector(1536);

-- Batch populate embeddings (process in chunks to avoid timeouts)
UPDATE documents
SET embedding = azure_openai.create_embeddings(
    'text-embedding-ada-002',
    content
)::vector
WHERE embedding IS NULL
LIMIT 100;  -- Process 100 rows at a time
```

**Step 4: Batch embedding with larger chunks**

```sql
-- For large tables, use a loop approach
DO $$
DECLARE
    batch_size int := 100;
    processed int := 0;
BEGIN
    LOOP
        UPDATE documents
        SET embedding = azure_openai.create_embeddings(
            'text-embedding-ada-002', content
        )::vector
        WHERE id IN (
            SELECT id FROM documents WHERE embedding IS NULL LIMIT batch_size
        );
        GET DIAGNOSTICS processed = ROW_COUNT;
        EXIT WHEN processed = 0;
        PERFORM pg_sleep(1);  -- Rate limit courtesy
    END LOOP;
END $$;
```

## Common Mistakes

1. **`azure_openai.create_embeddings()` SQL syntax**: `SELECT azure_openai.create_embeddings('deployment-name', 'text to embed')::vector(1536)`. Returns `text` — must cast to `vector(N)` for storage. Without cast, you get a text string representation
2. **Batch embedding pattern**: Process in chunks to avoid timeouts: `WITH batch AS (SELECT id, content FROM documents WHERE embedding IS NULL LIMIT 100) UPDATE documents SET embedding = azure_openai.create_embeddings('ada-002', batch.content)::vector(1536) FROM batch WHERE documents.id = batch.id`
3. **TPM limit workaround**: Azure OpenAI enforces tokens-per-minute limits. Add `SELECT pg_sleep(1)` between batches. Monitor: if you get 429 errors in `pg_stat_activity`, increase sleep or reduce batch size
4. **Dimension table by model**: `text-embedding-ada-002` = 1536, `text-embedding-3-small` = 1536 (default) or configurable down to 256, `text-embedding-3-large` = 3072 (default) or configurable. Pass `dimensions` parameter for v3 models: `azure_openai.create_embeddings('text-3-small', text, dimensions => 512)`
5. **Silent truncation trap**: ada-002 truncates input at 8191 tokens silently (no error). text-embedding-3 models handle 8191 tokens. For longer content, split with overlap: `substring(content from 1 for 2000)` with 200-char overlap between chunks
6. **Deployment name vs model name confusion**: Azure OpenAI deployments can have ANY name. `azure_openai.create_embeddings('my-custom-name', ...)` uses the deployment name you set in Azure Portal, NOT 'text-embedding-ada-002'
7. **NULL propagation**: `azure_openai.create_embeddings('model', NULL)` returns NULL (not an error). Filter: `WHERE content IS NOT NULL AND length(content) > 0` before embedding. Empty string also produces a valid but meaningless vector
8. **Cost estimation formula**: `SELECT count(*), sum(length(content))/4/1000 * 0.0001 AS estimated_usd FROM documents WHERE embedding IS NULL` — approximate cost before backfilling. At scale (1M+ rows), consider provisioned throughput for cost predictability
9. **Verifying deployment supports embeddings**: Not all Azure OpenAI deployments support embeddings. Use a completions deployment for chat, embeddings deployment for vectors. Calling embeddings on a GPT deployment gives HTTP 404

## Verification

```sql
-- Verify embeddings are generated (non-null, correct dimension)
SELECT id, array_length(embedding::real[], 1) AS dims
FROM documents
WHERE embedding IS NOT NULL
LIMIT 5;

-- Test similarity search works with new embeddings
SELECT id, content, embedding <=> azure_openai.create_embeddings(
    'text-embedding-ada-002', 'database performance'
)::vector AS distance
FROM documents
ORDER BY distance LIMIT 5;
```

## Failure Recovery

- **"model not found"**: Verify deployment name in Azure OpenAI Studio matches what you pass to the function
- **Timeout on large batches**: Reduce batch size to 50 or fewer rows per UPDATE
- **Rate limit (429)**: Increase `pg_sleep()` delay or request higher TPM quota in Azure OpenAI
