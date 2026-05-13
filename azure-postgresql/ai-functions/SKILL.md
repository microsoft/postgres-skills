---
name: ai-functions
description: "Call Azure AI functions directly from SQL in Azure Database for PostgreSQL: generate text, extract entities, classify, summarize, and score with azure_ai helper functions"
version: "1.0.0"
tags: [azure, postgresql, azure-ai, generate, extract, summarize, classify, ai-functions]
execution_mode: mutate
requires_confirmation: false
platform_scope: azure-postgresql
---

# AI Functions

## When to Use

**Trigger when:**
- User asks how to call an LLM from inside PostgreSQL
- User mentions `azure_ai.generate()`, `azure_ai.extract()`, or `azure_ai.summarize()`
- User wants to classify, score, or extract entities using SQL
- User asks about `is_true()`, `rank()`, or AI-powered SQL functions
- User needs to process text with AI without leaving the database

**Do NOT use when:**
- User needs vector embeddings (use `azure-postgresql/embeddings-azure-ai/`)
- User needs to configure the azure_ai extension (use `azure-postgresql/azure-ai-extension/`)
- User needs RAG retrieval (use `azure-postgresql/rag-pipeline/`)

**Overlaps with:**
- `azure-postgresql/azure-ai-extension/` (must be configured first)
- `azure-postgresql/rag-pipeline/` (AI functions used for generation step)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- `azure_ai` extension installed and configured with Azure OpenAI endpoint
- Azure OpenAI deployment with a chat/completion model (e.g., gpt-4o)
- MCP `execute_sql` tool or `psql`

## Instructions

**Step 1: Generate text (LLM completion)**

```sql
SELECT azure_openai.create(
    'gpt-4o',          -- deployment name
    'Summarize this PostgreSQL error in one sentence: ' || error_message,
    max_tokens => 100
) FROM error_logs WHERE id = 42;
```

**Step 2: Extract structured data from text**

```sql
-- Extract entities using AI (returns JSON)
SELECT azure_ai.extract(
    'Extract all product names and prices as JSON array',
    content,
    'gpt-4o'
) AS extracted
FROM product_descriptions
WHERE id = 1;
```

**Step 3: Classify or score content**

```sql
-- Boolean classification
SELECT id, title,
    azure_ai.is_true(
        'gpt-4o',
        format('Is this support ticket about a billing issue? Ticket: %s', content)
    ) AS is_billing
FROM support_tickets
WHERE status = 'open';
```

**Step 4: Summarize content**

```sql
SELECT azure_ai.summarize(
    'gpt-4o',
    content,
    max_tokens => 200
) AS summary
FROM documents WHERE id = 5;
```

**Step 5: Rank or score items**

```sql
-- Score relevance of results
SELECT id, title,
    azure_ai.rank(
        'gpt-4o',
        'How relevant is this document to database performance tuning?',
        content
    ) AS relevance_score
FROM documents
ORDER BY relevance_score DESC
LIMIT 5;
```

**Step 6: Chain with SQL operations**

```sql
-- Use AI output in WHERE or JOIN
SELECT * FROM support_tickets
WHERE azure_ai.is_true(
    'gpt-4o',
    format('Is this urgent and about data loss? %s', content)
);
```

## Common Mistakes

1. **Deployment name vs model name**: Pass your Azure OpenAI deployment name (e.g., 'my-gpt4'), not the model identifier
2. **Rate limiting in loops**: Calling AI functions on every row of a large table hits rate limits. Process in batches with `LIMIT` and store results
3. **Non-deterministic in WHERE**: AI function outputs vary between calls. Cache results in a column rather than using in repeated WHERE clauses
4. **Token overflow**: Long `content` fields may exceed model context window. Truncate or chunk text before passing
5. **403/PermissionDenied**: Verify azure_ai extension is configured with valid endpoint and key/managed identity

## Verification

```sql
-- Simple connectivity test
SELECT azure_openai.create('gpt-4o', 'Reply with OK', max_tokens => 5);
-- Should return: "OK" or similar short response

-- Verify extract returns valid JSON
SELECT azure_ai.extract('Extract the city name as JSON', 'I live in Seattle', 'gpt-4o')::jsonb;
```

## Failure Recovery

- **"deployment not found"**: Verify deployment name in Azure OpenAI Studio. Names are case-sensitive
- **Timeout**: Reduce `max_tokens` or simplify prompt. Set `statement_timeout` higher for AI calls
- **Rate limit (429)**: Add `pg_sleep(1)` between batch operations or request higher TPM quota
- **Empty response**: The model may refuse unsafe prompts. Check content filtering settings in Azure OpenAI
