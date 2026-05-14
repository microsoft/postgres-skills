---
name: azure-ai
description: Configure the azure_ai extension and use Azure OpenAI functions (generate, classify, extract, score) directly in SQL on Azure Database for PostgreSQL.
tags: [azure, postgresql, azure-ai, azure-openai, generate, extract, summarize, classify, ai-functions, managed-identity]
activation:
  user_intent:
    - configure azure_ai extension
    - call Azure OpenAI from SQL
    - classify or generate text in SQL
    - extract entities from database columns
    - score or summarize rows with AI
  technical_keywords:
    - azure_ai
    - azure_openai.create
    - set_setting
    - managed_identity
    - azure_openai.create()
  exclusion_conditions:
    - "when user needs vector embeddings, use `azure-postgresql/genai-patterns/` instead"
    - "when user needs RAG / hybrid search, use `azure-postgresql/genai-patterns/` instead"
    - "when user needs vector indexing or DiskANN tuning, use `azure-postgresql/vector-diskann/` instead"
  adjacent_skills:
    - "`azure-postgresql/genai-patterns/`"
    - "`azure-postgresql/vector-diskann/`"
    - "`azure-postgresql/extension-lifecycle/`"
---

## Prerequisites
- Azure Database for PostgreSQL Flexible Server
- `azure_ai` listed in `azure.extensions` allowlist (requires `azure_pg_admin` role)
- Azure OpenAI resource deployed in same region (or accessible via Private Link)
- Azure OpenAI model deployment (e.g., `gpt-4o`, `gpt-4o-mini`)

## Instructions

### Step 1 — Install and configure the extension

```sql
CREATE EXTENSION IF NOT EXISTS azure_ai;

-- API key auth
SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://<resource>.openai.azure.com');
SELECT azure_ai.set_setting('azure_openai.subscription_key', '<key>');

-- OR managed identity (recommended for production)
SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://<resource>.openai.azure.com');
-- Grant "Cognitive Services OpenAI User" RBAC role to the server's managed identity
```

Verify: `SELECT azure_ai.version();` — must return a version string.

### Step 2 — Multi-service configuration (optional)

Chain additional Azure AI services:

```sql
-- Azure AI Language (sentiment, NER, key phrases)
SELECT azure_ai.set_setting('azure_ai_language.endpoint', 'https://<resource>.cognitiveservices.azure.com');
SELECT azure_ai.set_setting('azure_ai_language.subscription_key', '<key>');
```

### Step 3 — Text generation with azure_openai.create()

```sql
SELECT azure_openai.create(
  '<deployment_name>',           -- your Azure OpenAI deployment
  'Summarize this ticket briefly.',  -- system prompt
  ticket_text,                   -- user content from column
  max_tokens => 200
) AS summary
FROM support_tickets
WHERE summary IS NULL
LIMIT 100;                       -- batch to avoid rate limits
```

### Step 4 — Classification pattern

```sql
UPDATE products
SET category = azure_openai.create(
  '<deployment_name>',
  'Classify into exactly one category: Electronics, Clothing, Food, Other. Reply with the category name only.',
  description,
  max_tokens => 10,
  temperature => 0.0
)
WHERE category IS NULL;
```

### Step 5 — Entity extraction pattern

```sql
SELECT id,
  azure_openai.create(
    '<deployment_name>',
    'Extract all company names mentioned. Return as JSON array.',
    content,
    max_tokens => 200
  ) AS companies
FROM articles;
```

### Step 6 — Scoring / sentiment pattern

```sql
UPDATE reviews
SET sentiment_score = (azure_openai.create(
  '<deployment_name>',
  'Rate the sentiment of this review from 1 (very negative) to 5 (very positive). Reply with the number only.',
  review_text,
  max_tokens => 5,
  temperature => 0.0
))::int
WHERE sentiment_score IS NULL;
```

### Verify

```sql
-- Confirm extension
SELECT azure_ai.version();

-- Test generation
SELECT azure_openai.create('<deployment>', 'Reply with: OK', 'test');
-- Expected: returns 'OK' or similar short response
```

## Common Mistakes

1. **[CRITICAL] Extension not in allowlist**: `CREATE EXTENSION` fails → add `azure_ai` to `azure.extensions` server parameter (requires `azure_pg_admin` role). If you see 403: verify you hold the `azure_pg_admin` role: `SELECT pg_has_role(current_user, 'azure_pg_admin', 'MEMBER');`

   ❌ Wrong:
   ```sql
   -- As a non-admin user or without allowlisting
   CREATE EXTENSION azure_ai;
   -- ERROR: extension "azure_ai" is not allowlisted
   ```

   ✅ Right:
   ```bash
   # First allowlist, then create as azure_pg_admin
   az postgres flexible-server parameter set --name azure.extensions --value "azure_ai,vector"
   ```
   ```sql
   CREATE EXTENSION azure_ai;
   ```

2. **[HIGH] Wrong endpoint format**: Must be `https://<resource>.openai.azure.com` — no trailing slash, no `/openai/` path.

   ❌ Wrong:
   ```sql
   SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://myresource.openai.azure.com/openai/');
   ```

   ✅ Right:
   ```sql
   SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://myresource.openai.azure.com');
   ```

3. **[HIGH] Deployment name ≠ model name**: Pass the *deployment* name (e.g., `my-gpt4o`), not the model name (`gpt-4o`).

   ❌ Wrong:
   ```sql
   SELECT azure_openai.create('gpt-4o', 'Summarize', content);
   -- Returns NULL or error — no deployment named "gpt-4o"
   ```

   ✅ Right:
   ```sql
   SELECT azure_openai.create('my-gpt4o-deployment', 'Summarize', content);
   -- Use the deployment name from Azure OpenAI Studio
   ```

4. **[MEDIUM] Rate limiting (429)**: Batch with `LIMIT` + `pg_sleep()` between batches. Start with batches of 50-100 rows.
5. **[CRITICAL] Managed identity RBAC chain**: Server identity → "Cognitive Services OpenAI User" on OpenAI resource. Takes up to 10 minutes to propagate.
6. **[MEDIUM] Key rotation**: Update via `azure_ai.set_setting()` — no server restart needed, but value is per-session if not persisted.
7. **[MEDIUM] Confusing create() vs create_embeddings()**: `azure_openai.create()` = text generation (returns text). `azure_openai.create_embeddings()` = vector embeddings (returns vector). For embeddings, use `azure-postgresql/genai-patterns/`.
8. **[MEDIUM] Temperature for classification**: Always set `temperature => 0.0` for deterministic classification/scoring tasks.
9. **[CRITICAL] "extension azure_ai does not exist"**: Not in allowlist. Check `SHOW azure.extensions;` and add `azure_ai`.
10. **[CRITICAL] 403 Forbidden**: RBAC not assigned. Verify managed identity has "Cognitive Services OpenAI User" on the OpenAI resource.
11. **[MEDIUM] Timeout on large batches**: Use `LIMIT` + loop pattern; set `statement_timeout` higher if needed.
12. **[HIGH] NULL results**: Check deployment name matches exactly (case-sensitive), endpoint is correct, and model is deployed.

## References
- [Azure AI extension for Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-overview)
- [Integrate Azure AI services](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-openai)
