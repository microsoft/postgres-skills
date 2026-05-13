---
name: azure-ai-extension
description: "Set up and configure the azure_ai extension for Azure Database for PostgreSQL: endpoint binding, managed identity authentication, and multi-service chaining"
version: "1.0.0"
tags: [azure, postgresql, azure-ai, extension, endpoint, managed-identity]
execution_mode: mutate
requires_confirmation: true
platform_scope: azure-postgresql
---

# Azure AI Extension

## When to Use

**Trigger when:**
- User asks how to set up the azure_ai extension
- User needs to connect PostgreSQL to Azure OpenAI, Azure AI Language, or Azure ML
- User mentions endpoint binding or API key configuration for azure_ai
- User asks about managed identity authentication for azure_ai
- Error: "azure_ai endpoint not configured" or "invalid API key"

**Do NOT use when:**
- User needs to generate embeddings (already configured) (use `azure-postgresql/embeddings-azure-ai/`)
- User asks about specific AI functions like generate/extract (use `azure-postgresql/ai-functions/`)
- User needs RAG pipeline (use `azure-postgresql/rag-pipeline/`)

**Overlaps with:**
- `azure-postgresql/embeddings-azure-ai/` (depends on this extension being configured)
- `azure-postgresql/ai-functions/` (depends on this extension being configured)
- `azure-postgresql/extension-lifecycle/` (azure_ai is installed via standard extension flow)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- `azure_ai` extension allowlisted and installed
- Azure OpenAI resource with deployed models
- API key or managed identity configured

## Instructions

**Step 1: Install the extension**

```sql
-- Requires azure.extensions allowlist (see extension-lifecycle skill)
CREATE EXTENSION azure_ai;
```

**Step 2: Configure Azure OpenAI endpoint (API key method)**

```sql
SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://myoai.openai.azure.com');
SELECT azure_ai.set_setting('azure_openai.subscription_key', '<your-api-key>');
```

**Step 3: Configure with managed identity (recommended for production)**

```sql
-- Use managed identity instead of API key
SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://myoai.openai.azure.com');
SELECT azure_ai.set_setting('azure_openai.subscription_key', 'managed_identity');
```

> The Flexible Server's system-assigned managed identity must have "Cognitive Services OpenAI User" role on the Azure OpenAI resource.

**Step 4: Configure additional AI services**

```sql
-- Azure AI Language (for sentiment, NER, etc.)
SELECT azure_ai.set_setting('azure_cognitive.endpoint', 'https://mylang.cognitiveservices.azure.com');
SELECT azure_ai.set_setting('azure_cognitive.subscription_key', '<key>');

-- Azure ML (for custom models)
SELECT azure_ai.set_setting('azure_ml.scoring_endpoint', 'https://my-endpoint.inference.ml.azure.com/score');
SELECT azure_ai.set_setting('azure_ml.endpoint_key', '<key>');
```

**Step 5: Verify configuration**

```sql
SELECT azure_ai.get_setting('azure_openai.endpoint');
-- Returns the endpoint URL (key is never returned)
```

## Common Mistakes

1. **Health check pattern**: Always verify extension works before building pipelines: `SELECT azure_ai.version()` returns version string if configured correctly. Returns error if extension not in allowlist
2. **Multi-model registration**: Each AI service needs separate configuration. Pattern: `SELECT azure_ai.set_setting('azure_openai.endpoint', 'https://RESOURCE.openai.azure.com'); SELECT azure_ai.set_setting('azure_openai.subscription_key', 'KEY1');` Then for Azure ML: `SELECT azure_ai.set_setting('azure_ml.scoring_endpoint', 'https://ENDPOINT.inference.ml.azure.com/score')`
3. **Managed identity RBAC chain**: Server needs system-assigned identity enabled (`az postgres flexible-server identity assign`). Then assign `Cognitive Services OpenAI User` role on the OpenAI resource to the server's managed identity. Without BOTH steps, you get 403
4. **Error code interpretation**: 401 = wrong key or expired key. 403 with managed identity = missing RBAC role assignment. 429 = rate limited (implement retry with `pg_sleep`). 404 = wrong deployment name or endpoint URL
5. **Fallback chain for rate limits**: Wrap AI calls in a retry function: `DO $$ BEGIN FOR i IN 1..3 LOOP BEGIN PERFORM azure_openai.create(...); RETURN; EXCEPTION WHEN OTHERS THEN PERFORM pg_sleep(power(2, i)); END; END LOOP; END $$;`
6. **Key rotation without downtime**: Set new key first (`azure_ai.set_setting`), test with `SELECT azure_ai.version()`, then revoke old key in Azure Portal. Settings take effect immediately without server restart
7. **Audit trail for AI calls**: API keys set via SQL appear in `pg_stat_statements` and query logs. Use managed identity for production to avoid key exposure. If keys must be used, rotate after initial setup and restrict `pg_stat_statements` access

## Verification

```sql
-- Test Azure OpenAI connectivity
SELECT azure_openai.create_embeddings('text-embedding-ada-002', 'test')::vector;

-- List all configured settings
SELECT azure_ai.get_setting('azure_openai.endpoint');
SELECT azure_ai.get_setting('azure_cognitive.endpoint');
```

## Failure Recovery

- **"endpoint not configured"**: Run `azure_ai.set_setting()` for the required service
- **401 Unauthorized**: API key is invalid or expired. Regenerate in Azure Portal and update
- **403 Forbidden with managed identity**: Add "Cognitive Services OpenAI User" role to the server's managed identity
- **Timeout**: Check network connectivity. If using private endpoint, verify DNS resolution
