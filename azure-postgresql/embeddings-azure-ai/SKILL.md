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

1. **Must cast to vector**: `azure_openai.create_embeddings('deployment-name', 'text')` returns `text`. Cast explicitly: `::vector(1536)` for ada-002, `::vector(3072)` for text-embedding-3-large
2. **Batch processing pattern**: Process in chunks to avoid timeouts. Use `WHERE embedding IS NULL LIMIT 100` in a loop with `pg_sleep(1)` between batches for rate limit compliance
3. **TPM limit handling**: Azure OpenAI enforces tokens-per-minute limits. 429 errors appear in `pg_stat_activity`. Increase sleep between batches or request higher TPM quota
4. **Deployment name vs model name**: First parameter is your deployment name from Azure Portal, not the model name. A deployment named 'my-embedder' is called as `azure_openai.create_embeddings('my-embedder', ...)`
5. **NULL handling**: `azure_openai.create_embeddings('model', NULL)` returns NULL silently. Always filter: `WHERE content IS NOT NULL AND length(content) > 0`
6. **Dimension by model**: ada-002 = 1536 fixed. text-embedding-3-small = 1536 default (configurable to 256). text-embedding-3-large = 3072 default. For v3 models, pass `dimensions` parameter: `azure_openai.create_embeddings('text-3-small', text, dimensions => 512)`
7. **Silent input truncation**: All embedding models truncate at 8191 tokens without error. For longer content, split with overlap before embedding

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
