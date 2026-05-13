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

1. **Key exposed in logs**: API keys set via SQL appear in query logs. Use managed identity for production or rotate keys after setup
2. **Wrong endpoint format**: Use the full URL with `https://` prefix. Omitting the protocol causes connection failures
3. **Managed identity not assigned**: The Flexible Server must have a system-assigned managed identity enabled AND the identity must have the correct RBAC role on the AI resource
4. **Multiple services, multiple keys**: Each AI service (OpenAI, Language, ML) has its own endpoint/key pair. Configure each separately
5. **403/PermissionDenied**: For managed identity, verify RBAC assignment. For API key, verify key is valid and not expired

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
