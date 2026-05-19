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

## Key Facts (what models get wrong)

> **Response focus:** Prioritize deployment name vs model name confusion, function schema (`azure_openai` not `azure_ai`), endpoint format, and managed identity RBAC. Avoid explaining basic Azure OpenAI or SQL concepts.

| Fact | Detail |
|------|--------|
| create() vs create_embeddings() | `azure_openai.create()` = text generation (returns text). `azure_openai.create_embeddings()` = vector embeddings (returns vector type) |
| Function schema | Functions live in `azure_openai` schema (not `azure_ai`). Config via `azure_ai.set_setting()` |
| Deployment name not model name | First arg is your deployment name (e.g., `my-gpt4o`), NOT the model name (`gpt-4o`) |
| Endpoint format | `https://<resource>.openai.azure.com` with no trailing slash, no `/openai/` path |
| Managed identity RBAC | Server identity needs "Cognitive Services OpenAI User" role on the OpenAI resource; propagation up to 10 min |
| azure.extensions allowlist | `azure_ai` must be added to `azure.extensions` server parameter before CREATE EXTENSION |
| Single-text-per-call | Each `create()` call processes one text value; batch with SQL LIMIT + loops |
| Key stored per-session | `set_setting()` values are session-scoped unless persisted via server parameters |

## Decision Matrix

| Auth Method | When to Use | Setup |
|-------------|-------------|-------|
| API Key | Dev/test, quick start | `azure_ai.set_setting('azure_openai.subscription_key', '<key>')` |
| Managed Identity | Production, no secrets in DB | Grant RBAC role to server identity; no key needed |

## Critical Gotchas

1. **Extension not in allowlist**: Must add `azure_ai` to `azure.extensions` server parameter first; requires `azure_pg_admin` role
2. **Wrong endpoint format**: No trailing slash, no `/openai/` suffix
3. **Deployment name is case-sensitive**: Must match exactly what is in Azure OpenAI Studio
4. **Rate limiting (429)**: Batch with `LIMIT 50-100` per query; use `pg_sleep()` between batches
5. **RBAC propagation delay**: Managed identity role assignment takes up to 10 minutes to propagate
6. **Temperature for classification**: Always set `temperature => 0.0` for deterministic tasks
7. **NULL results**: Usually means deployment name is wrong, endpoint is wrong, or model is not deployed
8. **403 Forbidden**: RBAC not assigned or `azure_pg_admin` role missing

## Anti-Hallucination Rules

- Do NOT use model name (e.g., `gpt-4o`) as the first argument; use deployment name
- Do NOT claim `azure_openai.create()` returns embeddings; it returns text
- Do NOT omit the allowlist step; CREATE EXTENSION will fail without it
- Do NOT add trailing slash or path segments to the endpoint URL
- Do NOT claim batch/array input is supported; it is one text per call

## References
- [Azure AI extension for Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-overview)
- [Integrate Azure AI services](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-openai)
