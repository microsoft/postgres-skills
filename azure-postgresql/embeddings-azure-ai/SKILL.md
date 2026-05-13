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

1. **Deployment name vs model name**: Use your Azure OpenAI deployment name, not the model name. They may differ
2. **Dimension mismatch**: `text-embedding-ada-002` = 1536 dimensions, `text-embedding-3-large` = 3072, `text-embedding-3-small` = 1536. Column must match
3. **Rate limiting**: Azure OpenAI has TPM limits. Process in batches of 100 rows with `pg_sleep(1)` between batches
4. **Null content**: `create_embeddings(model, NULL)` returns NULL. Filter out NULLs before embedding
5. **403/PermissionDenied**: Ensure the azure_ai extension endpoint and key are configured correctly
6. **Not setting endpoint correctly**: Use `SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://YOUR-RESOURCE.openai.azure.com')` and `azure_ai.set_setting('azure_openai.subscription_key', 'YOUR-KEY')`
7. **Embedding entire documents**: For text > 8191 tokens (ada-002 limit), truncation happens silently. Split content before embedding
8. **Using wrong API version**: The azure_ai extension calls Azure OpenAI REST API internally. Ensure your deployment supports the embeddings API (not completions-only deployments)
9. **Cost surprise on backfill**: Embedding 1M rows at $0.0001/1K tokens adds up. Estimate cost: `SELECT sum(length(content))/4/1000 * 0.0001 AS estimated_cost FROM documents`

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
