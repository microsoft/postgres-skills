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

1. **`azure_openai.create()` function signature**: `SELECT azure_openai.create('deployment-name', 'system prompt', 'user content')` returns text. For JSON output, add format instruction in system prompt: `'Respond with valid JSON only: {"category": "...", "confidence": 0.0-1.0}'`
2. **Deployment name confusion**: First parameter is your Azure OpenAI DEPLOYMENT name (set in Portal), not model name. A deployment named 'classifier-v1' using gpt-4o is called as `azure_openai.create('classifier-v1', ...)`
3. **Batch classification pattern**: `UPDATE documents SET category = azure_openai.create('gpt4', 'Classify into: tech, business, science. Return only the category name.', content) WHERE category IS NULL LIMIT 50` — process in batches to avoid 429 rate limits
4. **Token overflow on large content**: GPT-4o context = 128K tokens but Azure imposes per-request limits. Truncate: `left(content, 4000)` for classification. For summarization, chunk and summarize incrementally
5. **Non-deterministic outputs in WHERE clauses**: `WHERE azure_openai.create(...) = 'positive'` re-calls the API on every evaluation. Cache: `UPDATE docs SET sentiment = azure_openai.create(...)` once, then `SELECT * FROM docs WHERE sentiment = 'positive'`
6. **Extract structured data pattern**: `SELECT id, azure_openai.create('gpt4', 'Extract JSON: {"name": "", "email": "", "company": ""}', raw_text)::jsonb FROM contacts WHERE parsed_data IS NULL LIMIT 25` — cast result to `jsonb` for SQL-queryable output
7. **Cost control**: Each `azure_openai.create()` call bills tokens. Guard against runaway costs: always use `LIMIT`, add `WHERE processed_at IS NULL`, and log call counts with a trigger or wrapper function
8. **Error handling in SQL**: Wrap in exception handler: `DO $$ BEGIN PERFORM azure_openai.create(...); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'AI call failed: %', SQLERRM; END $$;` — 429/500 errors from Azure OpenAI surface as PostgreSQL exceptions

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
