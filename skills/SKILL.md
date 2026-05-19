---
name: postgresql-agent-skills
description: "Expert PostgreSQL skills with intelligent routing. Covers both generic PostgreSQL and Azure Database for PostgreSQL."
tags: [postgresql, azure, database, skills, routing]
activation:
  user_intent: ["work with PostgreSQL", "database query", "connect to postgres", "Azure PostgreSQL"]
  technical_keywords: ["postgresql", "postgres", "psql", "pg_", "azure database for postgresql", "flexible server", "pgvector", "diskann"]
---

# PostgreSQL Agent Skills — Routing Table

Use references as supplemental context — combine them with your PostgreSQL knowledge. If reference guidance is incomplete, answer with appropriate caveats rather than inventing details.

## Key Constraints

- Never use `ALTER SYSTEM` on managed services — use portal/CLI/ARM instead
- Never assume `SUPERUSER` — use `azure_pg_admin` (Azure) or equivalent managed role
- Use `CONCURRENTLY` for `CREATE INDEX` / `REINDEX` / `DETACH PARTITION` in production
- `pgsql_modify` does NOT return row data (no RETURNING support)
- Version-gated features: `MERGE` (PG 15+), `json_table` (PG 17+), `DETACH CONCURRENTLY` (PG 14+)

---

## Connection Context Detection

**On first activation**, determine the connection type:

1. Check if an MCP connection is already established (look for an active `connectionId`)
2. If YES → call `pgsql_get_server_capabilities` once per session to get `isAzure` flag
3. Cache the result for the session — do not re-check on every question

```
Connection state:
├── Active connection + isAzure: true
│   → All skills available. Prefer azure-postgresql-* for overlapping topics.
├── Active connection + isAzure: false
│   → Use ONLY postgresql-* skills. Do NOT reference azure-* skills.
├── No active connection + user asks generic PostgreSQL question
│   → Use postgresql-* skills only.
├── No active connection + user explicitly asks about Azure
│   → Provide conceptual answer from azure-* skills with disclaimer:
│     "These steps require an active Azure PostgreSQL connection to execute."
└── Unknown state (first interaction)
    → If user's question is clearly Azure-specific, attempt capability check.
    → Otherwise, default to postgresql-* skills.
```

---

## PostgreSQL Skills (always available)

These skills apply to any PostgreSQL deployment — self-hosted, RDS, Cloud SQL, Azure, or local.

| pgvector, vector column, HNSW index, embedding store, similarity search, cosine distance, vector index, nearest neighbor, pgvector extension | [postgresql-vector-search](references/postgresql-vector-search.md) | pgvector setup, HNSW indexes, distance operators, recall tuning |
| RAG, embeddings postgresql, semantic search pgvector, hybrid search RRF, reciprocal rank fusion, vector + full text, retrieval augmented, RAG system | [postgresql-genai-rag](references/postgresql-genai-rag.md) | RAG pipelines, hybrid search with RRF, chunking strategy |
| CREATE EXTENSION, pg_stat_statements, pg_trgm, shared_preload_libraries, manage extensions, extension install, install extension, install the | [postgresql-extensions](references/postgresql-extensions.md) | Extension install/upgrade, common extensions, troubleshooting |
| btree index, gin index, gist index, brin index, partial index, covering index, CREATE INDEX, multicolumn index, index bloat, index on, index strategy, filters by, sorts by | [postgresql-advanced-indexing](references/postgresql-advanced-indexing.md) | B-tree, GIN, GiST, BRIN, partial/expression/covering indexes |
| jsonb, json containment, GIN jsonb_ops, jsonb_path_query, document store postgresql, jsonb index, -> operator, ->> operator, JSONB column | [postgresql-jsonb-patterns](references/postgresql-jsonb-patterns.md) | JSONB operators, indexing strategies, query patterns |
| table partition, range partition, list partition, hash partition, pg_partman, partition pruning, detach partition, 500M rows, large table time-series, detach a partition | [postgresql-table-partitioning](references/postgresql-table-partitioning.md) | Declarative partitioning, partition pruning, maintenance |
| row level security, RLS policy, tenant isolation, CREATE POLICY, FORCE ROW LEVEL SECURITY, multi-tenant, enabled RLS | [postgresql-row-level-security](references/postgresql-row-level-security.md) | CREATE POLICY, per-tenant isolation, session variables |
| tsvector, tsquery, full text search, ts_rank, websearch_to_tsquery, text search configuration, search functionality, autocomplete search, autocomplete, prefix search | [postgresql-full-text-search](references/postgresql-full-text-search.md) | tsvector/tsquery, GIN indexes, ranking, hybrid search |
| connection pool, max_connections, too many clients, too many connections, idle connections, PgBouncer, connection exhaustion | [postgresql-connection-management](references/postgresql-connection-management.md) | Pool sizing, PgBouncer modes, connection lifetime |
| logical replication, publication, subscription, CDC postgres, pg_logical, wal_level logical, replicate tables, replication slot, WAL filling, replicate specific tables | [postgresql-replication](references/postgresql-replication.md) | Logical replication setup, row filters (PG15+), conflict resolution |
| slow query, EXPLAIN ANALYZE, query plan, work_mem tuning, vacuum analyze, autovacuum tuning, query takes, query performance | [postgresql-query-performance](references/postgresql-query-performance.md) | EXPLAIN reading, statistics tuning, vacuum, parallel query |

---

## Azure PostgreSQL Skills (requires `isAzure: true`)

> **GATE:** Only use these when `pgsql_get_server_capabilities` confirms `isAzure: true`. For conceptual questions without a connection, provide informational answers with a disclaimer.

| Keyword triggers | Reference | When to use INSTEAD OF generic |
|---|---|---|
| DiskANN, pg_diskann, filtered vector search, azure vector index tuning, vector search azure, HNSW indexes azure | [azure-postgresql-vector-diskann](references/azure-postgresql-vector-diskann.md) | User needs DiskANN (Azure-only), filtered vector search, or is on Azure and needs index advice |
| azure_ai, azure_openai, ai.complete, in-database embeddings, LLM from SQL, generate embeddings SQL, call AI from SQL, connect azure openai, AI functions from SQL, classify using AI, AI directly in SQL | [azure-postgresql-azure-ai](references/azure-postgresql-azure-ai.md) | User wants to call LLMs/embeddings directly from SQL (azure_ai extension) |
| azure_ai RAG, in-database RAG pipeline, azure_openai.create_embeddings + search, RAG azure_ai, embeddings without leaving database, batch-embed, RAG system, embed the user, entire RAG pipeline inside, generate embeddings for | [azure-postgresql-genai-patterns](references/azure-postgresql-genai-patterns.md) | User wants end-to-end RAG using azure_ai (in-DB embeddings). If app-driven RAG on Azure, use generic `postgresql-genai-rag` instead |
| azure.extensions, allowlist, extension on Azure, azure_pg_admin, extension Flexible Server, install extension azure, permission denied extension azure, permission denied to create extension | [azure-postgresql-extension-lifecycle](references/azure-postgresql-extension-lifecycle.md) | Extension install ON AZURE (allowlist workflow). Generic `postgresql-extensions` covers non-Azure |
| Entra ID, managed identity, service principal, passwordless auth, AAD token, Entra ID postgres, token-based connection, token expir | [azure-postgresql-entra-id-auth](references/azure-postgresql-entra-id-auth.md) | Azure-specific auth only. No generic equivalent. |
| built-in PgBouncer, azure connection pooling, pool_mode azure Flexible Server, connection pooling azure | [azure-postgresql-connection-pooling](references/azure-postgresql-connection-pooling.md) | Azure built-in PgBouncer. Generic `postgresql-connection-management` covers standalone PgBouncer |
| provision Flexible Server, az postgres create, resize azure postgres, Burstable, GeneralPurpose, MemoryOptimized, IOPS scaling, Terraform azure postgres, create azure postgres, max_connections azure, scale down, scale storage, shrink storage | [azure-postgresql-provisioning](references/azure-postgresql-provisioning.md) | Azure-specific. No generic equivalent. |
| zone redundant HA, zone-redundant, failover azure, PITR, read replica azure, geo-restore, backup azure postgres, high availability azure postgres, same-zone HA | [azure-postgresql-ha-disaster-recovery](references/azure-postgresql-ha-disaster-recovery.md) | Azure HA/DR. No generic equivalent. |
| Private Link, VNet, firewall rule azure, SSL azure, TLS azure, public access azure, private endpoint postgres, network access azure | [azure-postgresql-networking-ssl](references/azure-postgresql-networking-ssl.md) | Azure networking. No generic equivalent. |
| Query Store, index recommendations, performance insights, intelligent tuning, query performance azure, slow queries azure, indexes Azure PostgreSQL recommends | [azure-postgresql-intelligent-tuning](references/azure-postgresql-intelligent-tuning.md) | Azure-specific monitoring. Generic `postgresql-query-performance` covers EXPLAIN-based tuning |
| major version upgrade, maintenance window, in-place upgrade, MVU, upgrade postgres azure, schedule maintenance, upgrade my Azure PostgreSQL, upgrade from version | [azure-postgresql-upgrades-maintenance](references/azure-postgresql-upgrades-maintenance.md) | Azure-specific. No generic equivalent. |

**Azure quick-reference (when `isAzure: true`):**
- Check tier: `SELECT current_setting('azure.server_tier', true);` — Burstable has limitations
- Check allowlist: `SHOW azure.extensions;` — must allowlist before `CREATE EXTENSION`
- `az ... parameter set --value` for list params **replaces entire list** — always GET current + append

---

## Quick Decision Tree

```
User asks about PostgreSQL...
├── Vector/embedding/similarity question
│   ├── isAzure: true → azure-postgresql-vector-diskann
│   └── else → postgresql-vector-search
├── RAG/GenAI question
│   ├── Wants in-database embeddings (azure_ai) → azure-postgresql-genai-patterns
│   └── App-driven or generic → postgresql-genai-rag
├── Extension question
│   ├── isAzure: true → azure-postgresql-extension-lifecycle
│   └── else → postgresql-extensions
├── Connection pooling question
│   ├── isAzure: true → azure-postgresql-connection-pooling
│   └── else → postgresql-connection-management
├── Azure-only topic (Entra ID, provisioning, HA, networking, upgrades)
│   ├── isAzure: true → appropriate azure-* reference
│   └── else → "This feature is specific to Azure Database for PostgreSQL"
└── Generic topic (indexing, JSONB, partitioning, RLS, FTS, replication)
    └── → postgresql-* reference (regardless of connection type)
```

---

## Global Anti-Hallucination Policy

When using ANY skill reference:

1. **Verify before asserting** — For Azure-specific capabilities (SKUs, extensions, limits, parameter names), prefer live database verification first (`pg_available_extensions`, `SHOW`, `pg_settings`). If unavailable, cite Azure documentation rather than guessing.
2. **State uncertainty explicitly** — If a detail is not in the skill reference and you are not confident, say "verify in Azure documentation" or "check your PostgreSQL version" rather than inventing an answer.
3. **Do not extrapolate** — Skill references cover specific versions and configurations. Do not assume behavior extends to other versions, tiers, or providers without evidence.
4. **Generic skills are supplements, not scripts** — Generic PostgreSQL skill content highlights gotchas and anti-patterns. Use it to enrich your existing knowledge, not as the sole basis for answers. If a question only needs basic syntax you already know, answer directly without over-relying on skill text.
