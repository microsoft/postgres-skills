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
- User mentions `azure_openai.create()` or in-database AI processing
- User wants to classify, score, or extract entities using SQL
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
- Role: `azure_pg_admin` (required for azure_ai functions; never superuser on Flexible Server)
- `azure_ai` extension installed and configured with Azure OpenAI endpoint
- Azure OpenAI deployment with a chat/completion model (e.g., gpt-4o)
- MCP `execute_sql` tool or `psql`

## Instructions

**Step 1: Generate text (LLM completion)**

```sql
SELECT azure_openai.create(
    'gpt-4o',          -- deployment name (from Azure Portal)
    'Summarize this PostgreSQL error in one sentence',  -- system prompt
    error_message      -- user content
) FROM error_logs WHERE id = 42;
```

**Step 2: Classify content**

```sql
-- Classify support tickets (cache result to avoid repeat API calls)
UPDATE support_tickets
SET category = azure_openai.create(
    'gpt-4o',
    'Classify into exactly one: billing, technical, account. Return only the word.',
    content
)
WHERE category IS NULL
LIMIT 50;
```

**Step 3: Extract structured data**

```sql
-- Extract entities as JSON
SELECT id,
    azure_openai.create(
        'gpt-4o',
        'Extract as JSON: {"name": "", "email": "", "company": ""}. Return valid JSON only.',
        raw_text
    )::jsonb AS extracted
FROM contacts
WHERE parsed_data IS NULL
LIMIT 25;
```

**Step 4: Score/rank content**

```sql
-- Priority scoring
UPDATE support_tickets
SET priority = azure_openai.create(
    'gpt-4o',
    'Rate urgency 1-5 based on: data loss risk, user impact, SLA violation. Return only the number.',
    content
)::int
WHERE priority IS NULL
LIMIT 50;
```

## Common Mistakes

1. **`azure_openai.create()` signature**: `SELECT azure_openai.create('deployment-name', 'system prompt', 'user content')` returns text. For JSON output, instruct in system prompt: `'Respond with valid JSON only'`
2. **Deployment name confusion**: First parameter is your Azure OpenAI DEPLOYMENT name (set in Portal), not model name. A deployment named 'classifier-v1' is called as `azure_openai.create('classifier-v1', ...)`
3. **Non-deterministic outputs in WHERE**: `WHERE azure_openai.create(...) = 'positive'` re-calls API on every row evaluation. Cache first: `UPDATE docs SET sentiment = azure_openai.create(...)`, then query cached column
4. **Batch processing**: Always use `LIMIT` to control costs and rate limits. Add `pg_sleep(1)` between batches for 429 avoidance
5. **Token overflow**: Truncate long content: `left(content, 4000)` for classification tasks. GPT-4o has 128K context but Azure per-request limits apply
6. **Cast output for typed columns**: For numeric scores: `::int`. For structured data: `::jsonb`. Raw output is always `text`
7. **Error handling**: 429/500 errors from Azure OpenAI surface as PostgreSQL exceptions. Wrap in `BEGIN...EXCEPTION WHEN OTHERS` for batch resilience
8. **Function naming**: `azure_openai.create()` = text generation (returns text), `azure_openai.create_embeddings()` = vector embeddings (returns vector). Do not confuse them. For embeddings, use `azure-postgresql/embeddings-azure-ai/`

## Verification

```sql
-- Simple connectivity test
SELECT azure_openai.create('gpt-4o', 'Reply with OK', '');
-- Should return: "OK" or similar short response

-- Verify structured extraction returns valid JSON
SELECT azure_openai.create(
    'gpt-4o',
    'Return valid JSON: {"city": ""}',
    'I live in Seattle'
)::jsonb;
```

## Failure Recovery

- **"deployment not found"**: Verify deployment name in Azure OpenAI Studio. Names are case-sensitive
- **Timeout**: Reduce `max_tokens` or simplify prompt. Set `statement_timeout` higher for AI calls
- **Rate limit (429)**: Add `pg_sleep(1)` between batch operations or request higher TPM quota
- **Empty response**: The model may refuse unsafe prompts. Check content filtering settings in Azure OpenAI
- **403 / permission denied**: Verify your role has `azure_pg_admin`: `SELECT pg_has_role(current_user, 'azure_pg_admin', 'member');` If false, grant via Azure Portal > Server > Roles
