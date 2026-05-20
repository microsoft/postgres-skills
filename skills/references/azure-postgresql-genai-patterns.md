---
name: genai-patterns
description: Generate vector embeddings in-database via azure_ai extension and build RAG pipelines with hybrid search on Azure Database for PostgreSQL.
tags: [azure, postgresql, embeddings, vector, pgvector, rag, hybrid-search, RRF, azure-openai, genai]
activation:
 user_intent:
 - generate embeddings for my table
 - build a RAG pipeline using azure_ai
 - in-database embeddings without app roundtrip
 - store embeddings from azure_openai
 - hybrid search with reciprocal rank fusion on Azure
 - embed user query in SQL and search similar documents
 technical_keywords:
 - create_embeddings
 - azure_openai.create_embeddings
 - azure_ai
 - vector(1536)
 - in-database RAG
 - batch embed
 exclusion_conditions:
 - "when user needs vector indexing or DiskANN/HNSW tuning only, use `azure-postgresql/vector-diskann/` instead"
 - "when user needs text generation / classification / extraction, use `azure-postgresql/azure-ai/` instead"
 - "when user builds app-driven RAG (app calls OpenAI SDK, stores vectors), use `postgresql-genai-rag` instead"
 adjacent_skills:
 - "`azure-postgresql/azure-ai/`"
 - "`azure-postgresql/vector-diskann/`"
 - "`postgresql-genai-rag`"
---

## When to use this skill

Use ONLY when the user wants **in-database embeddings via azure_ai extension** on Azure Flexible Server. This is the Azure-specific delta over generic RAG (which uses app-side embeddings).

If user builds app-driven RAG (app calls OpenAI SDK, stores vectors in PostgreSQL), route to `postgresql-genai-rag` instead.

Avoid explaining basic vector search, HNSW indexes, or generic RAG patterns. The base model and other skills handle those.

## Key Facts (what models get wrong)

| Fact | Detail |
|------|--------|
| Dimension match required | Column `vector(N)` MUST match model output (1536 for 3-small, 3072 for 3-large) |
| Operator/index pairing | `<=>` needs `vector_cosine_ops`, `<->` needs `vector_l2_ops`. Mismatch = no index use |
| azure_ai is single-row | `azure_openai.create_embeddings` processes ONE text per call. Batch with SQL LIMIT + `pg_sleep()` |
| Rate limits shared | azure_ai calls share quota with your Azure OpenAI deployment (429 errors on batch) |
| Extension prerequisite ORDER | `CREATE EXTENSION vector;` THEN `CREATE EXTENSION azure_ai;` (order matters) |
| Max dimensions | 16000 on Azure Flexible Server |
| Deployment name, not model | First arg to `create_embeddings()` is your deployment name (e.g., `my-embedding-3-small`), NOT the model name |

## Path Decision: In-database vs External

| Factor | In-database (azure_ai) | External (app-side) |
|--------|----------------------|---------------------|
| Best for | SQL-only workflows, batch jobs | App with existing OpenAI SDK |
| Models available | Azure OpenAI only | Any embedding model |
| Batching | Loop in SQL with `pg_sleep` | App controls batch/concurrency |
| Chunking | Limited (SQL string ops) | Full (NLP libraries) |
| Rate limit control | Server-level quota | App-level quota |

## Critical Gotchas

1. **"type vector does not exist"**: `CREATE EXTENSION vector;` first. On Azure, add to allowlist
2. **"azure_openai.create_embeddings does not exist"**: azure_ai not installed or endpoint not configured
3. **Silent truncation**: Models truncate beyond token limit without error. Pre-chunk to 500-1000 tokens
4. **No batch input**: `azure_openai.create_embeddings` takes single text, not array. Loop required
5. **Operator mismatch**: Index with `vector_cosine_ops` but query with `<->` (L2) = sequential scan silently
6. **[HIGH] Chunking at token boundaries**: Character counts are not token counts. A 512-char chunk can still exceed model limits; validate with `tiktoken` or the model tokenizer
7. **[MEDIUM] Hybrid search RRF weight tuning**: Default RRF `k=60` is balanced. For strong keyword domains like product codes or IDs, lower `k` (for example `20`) to boost lexical matches
8. **[MEDIUM] App-side vs in-DB embedding migration**: `azure_ai.create_embeddings()` may produce different vectors from app-side generation. Re-embed the corpus or keep separate columns during migration

## Anti-Hallucination Rules

- `azure_openai.create_embeddings` does NOT accept array/batch input — single text per call
- DiskANN does NOT work on self-hosted PostgreSQL or Burstable tier
- Cannot use non-Azure-OpenAI models with azure_ai extension
- azure_ai requires explicit endpoint configuration via `azure_ai.set_setting()` (not auto-discovered)
- Do NOT confuse `create_embeddings()` (returns vector) with `create()` (returns text)

## SQL Examples

**Store externally generated embeddings (Path B: app-side)**

```sql no-execute
INSERT INTO documents (content, embedding)
VALUES ($1, $2::vector);  -- $2 is float array from your embedding model
```

**Cosine similarity search**

```sql no-execute
SELECT id, content, 1 - (embedding <=> $1) AS similarity
FROM documents
ORDER BY embedding <=> $1
LIMIT 10;
```

## References
- [Generate embeddings with azure_ai](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-azure-openai)
- [Semantic search](https://learn.microsoft.com/azure/postgresql/flexible-server/generative-ai-semantic-search)
