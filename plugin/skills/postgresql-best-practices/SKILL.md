---
name: postgresql-best-practices
description: "Expert PostgreSQL skills with intelligent routing. Covers both generic PostgreSQL and Azure Database for PostgreSQL."
tags: [postgresql, azure, database, skills, routing]
activation:
  user_intent: ["work with PostgreSQL", "database query", "connect to postgres", "Azure PostgreSQL", "show tables", "list tables", "describe schema", "database schema", "what tables exist"]
  technical_keywords: ["postgresql", "postgres", "psql", "pg_", "azure database for postgresql", "flexible server", "pgvector", "diskann", "pgsql_", "pgsql-tools"]
---

# PostgreSQL Agent Skills — Routing Table

Use references as supplemental context — combine them with your PostgreSQL knowledge. If reference guidance is incomplete, answer with appropriate caveats rather than inventing details.

## Key Constraints

- Never use `ALTER SYSTEM` on managed services — use portal/CLI/ARM instead
- Never assume `SUPERUSER` — use `azure_pg_admin` (Azure) or equivalent managed role
- Use `CONCURRENTLY` for `CREATE INDEX` / `REINDEX` / `DETACH PARTITION` in production
- `pgsql_modify` does NOT return row data (no RETURNING support)
- Version-gated features: `MERGE` (PG 15+), `json_table` (PG 17+), `DETACH CONCURRENTLY` (PG 14+)

## Managed Service Guardrails (Azure Flexible Server)

When the context is Azure Database for PostgreSQL, NEVER suggest:

- **File paths**: `pg_hba.conf`, `postgresql.conf`, `/var/lib/postgresql/` — these are not accessible. Never run `SHOW config_file`, `SHOW hba_file`, or `SHOW data_directory` as these reveal internal paths that are irrelevant on a managed service.
- **OS commands**: `systemctl`, `sudo`, `pg_basebackup`, `pg_ctl`, `initdb` — no OS-level access
- **ALTER SYSTEM SET** — blocked on Azure. Use `az postgres flexible-server parameter set` or portal instead.
- **ALTER DATABASE SET for server-wide parameters** — while technically permitted, prefer `az postgres flexible-server parameter set` for server-wide changes (e.g., `work_mem`, `shared_buffers`, `max_connections`). Only use `ALTER DATABASE SET` if the user explicitly wants a per-database override. Always clarify scope with the user: "Do you want this server-wide (az CLI) or for this specific database only (ALTER DATABASE SET)?"
- **Manual replication setup** — use Azure read replicas (`az postgres flexible-server replica create`)
- **Manual backup/restore** — use Azure PITR (`az postgres flexible-server restore`)

Instead, always use Azure equivalents: portal, az CLI, ARM/Bicep, or server parameters API.

---

## Shell Execution Policy (az CLI)

When guidance needs Azure CLI and shell access exists:

- Run once per session:
  ```bash
  az version
  az account show --query "{subscription:id, name:name, tenant:tenantId, user:user.name}" -o json
  ```
- If `az account show` fails, ask the user to run `az login` or `az login --use-device-code`. Do not run login automatically.
- Execute non-destructive `az` commands directly.
- Ask first for destructive actions: `delete`, `restart`, `upgrade`, `failover`, `stop-replication`, PITR restore.
- Always pass `--subscription <id>`.
- If target server is unknown:
  ```bash
  az postgres flexible-server list --query "[].{name:name, resourceGroup:resourceGroup, location:location, version:version}" -o table
  ```
- If shell access is unavailable, provide numbered manual commands.

---

## Connection Context Detection

On first activation:

1. If an MCP connection exists, call `pgsql_get_server_capabilities` once and cache `isAzure`.
2. `isAzure: true` → all skills available; prefer `azure-postgresql-*` for overlapping topics.
3. `isAzure: false` → use only `postgresql-*` skills.
4. No connection + generic question → use `postgresql-*` skills.
5. No connection + explicit Azure question → answer conceptually with: "These steps require an active Azure PostgreSQL connection to execute."
6. Unknown state → attempt capability check only for clearly Azure-specific requests; otherwise default to generic PostgreSQL skills.

---

## PostgreSQL Skills (always available)

These skills apply to any PostgreSQL deployment — self-hosted, RDS, Cloud SQL, Azure, or local.

| pgvector, vector column, HNSW index, embedding store, similarity search, cosine distance, vector index, nearest neighbor, pgvector extension | [postgresql-vector-search](references/postgresql-vector-search.md) | pgvector setup, HNSW indexes, distance operators, recall tuning |
| RAG, embeddings postgresql, semantic search pgvector, hybrid search RRF, reciprocal rank fusion, vector + full text, retrieval augmented, RAG system | [postgresql-genai-rag](references/postgresql-genai-rag.md) | RAG pipelines, hybrid search with RRF, chunking strategy |
| CREATE EXTENSION, pg_stat_statements, pg_trgm, shared_preload_libraries, manage extensions, extension install, install extension, install the | [postgresql-extensions](references/postgresql-extensions.md) | Extension install/upgrade, common extensions, troubleshooting |
| btree index, gin index, gist index, brin index, partial index, covering index, CREATE INDEX, multicolumn index, index bloat, index strategy | [postgresql-advanced-indexing](references/postgresql-advanced-indexing.md) | B-tree, GIN, GiST, BRIN, partial/expression/covering indexes |
| jsonb, json containment, GIN jsonb_ops, jsonb_path_query, document store postgresql, jsonb index, -> operator, ->> operator | [postgresql-jsonb-patterns](references/postgresql-jsonb-patterns.md) | JSONB operators, indexing strategies, query patterns |
| table partition, range partition, list partition, hash partition, pg_partman, partition pruning, detach partition, 500M rows, large table time-series, detach a partition | [postgresql-table-partitioning](references/postgresql-table-partitioning.md) | Declarative partitioning, partition pruning, maintenance |
| row level security, RLS policy, tenant isolation, CREATE POLICY, FORCE ROW LEVEL SECURITY, multi-tenant, enabled RLS | [postgresql-row-level-security](references/postgresql-row-level-security.md) | CREATE POLICY, per-tenant isolation, session variables |
| tsvector, tsquery, full text search, ts_rank, websearch_to_tsquery, text search configuration, search functionality, autocomplete search, autocomplete, prefix search | [postgresql-full-text-search](references/postgresql-full-text-search.md) | tsvector/tsquery, GIN indexes, ranking, hybrid search |
| connection pool, max_connections, too many clients, too many connections, idle connections, PgBouncer, connection exhaustion | [postgresql-connection-management](references/postgresql-connection-management.md) | Pool sizing, PgBouncer modes, connection lifetime |
| logical replication, publication, subscription, CDC postgres, pg_logical, wal_level logical, replicate tables, replication slot, WAL filling, replicate specific tables | [postgresql-replication](references/postgresql-replication.md) | Logical replication setup, row filters (PG15+), conflict resolution |
| slow query, EXPLAIN ANALYZE, query plan, work_mem tuning, vacuum analyze, autovacuum tuning, query performance | [postgresql-query-performance](references/postgresql-query-performance.md) | EXPLAIN reading, statistics tuning, vacuum, parallel query |

---

## Azure PostgreSQL Skills (requires `isAzure: true`)

> **GATE:** Only use these when `pgsql_get_server_capabilities` confirms `isAzure: true`. For conceptual questions without a connection, provide informational answers with a disclaimer.

| Keyword triggers | Reference | When to use INSTEAD OF generic |
|---|---|---|
| DiskANN, pg_diskann, filtered vector search, azure vector index tuning, vector search azure, HNSW indexes azure | [azure-postgresql-vector-diskann](references/azure-postgresql-vector-diskann.md) | User needs DiskANN (Azure-only), filtered vector search, or is on Azure and needs index advice |
| azure_ai, azure_openai, ai.complete, in-database embeddings, LLM from SQL, generate embeddings SQL, call AI from SQL, connect azure openai, AI functions from SQL, classify using AI, AI directly in SQL, call GPT from database, call OpenAI from SQL, invoke AI from postgres, run inference in database, ML in PostgreSQL azure, summarize text SQL, sentiment analysis SQL | [azure-postgresql-azure-ai](references/azure-postgresql-azure-ai.md) | User wants to call LLMs/embeddings directly from SQL (azure_ai extension) |
| azure_ai RAG, in-database RAG pipeline, azure_openai.create_embeddings + search, RAG azure_ai, embeddings without leaving database, batch-embed, RAG system, embed the user, entire RAG pipeline inside, generate embeddings for | [azure-postgresql-genai-patterns](references/azure-postgresql-genai-patterns.md) | User wants end-to-end RAG using azure_ai (in-DB embeddings). If app-driven RAG on Azure, use generic `postgresql-genai-rag` instead |
| azure.extensions, allowlist, extension on Azure, azure_pg_admin, extension Flexible Server, install extension azure, permission denied extension azure, permission denied to create extension | [azure-postgresql-extension-lifecycle](references/azure-postgresql-extension-lifecycle.md) | Extension install ON AZURE (allowlist workflow). Generic `postgresql-extensions` covers non-Azure |
| Entra ID, managed identity, service principal, passwordless auth, AAD token, Entra ID postgres, token-based connection, token expir | [azure-postgresql-entra-id-auth](references/azure-postgresql-entra-id-auth.md) | Azure-specific auth only. No generic equivalent. |
| built-in PgBouncer, azure connection pooling, pool_mode azure Flexible Server, connection pooling azure | [azure-postgresql-connection-pooling](references/azure-postgresql-connection-pooling.md) | Azure built-in PgBouncer. Generic `postgresql-connection-management` covers standalone PgBouncer |
| provision Flexible Server, az postgres create, resize azure postgres, Burstable, GeneralPurpose, MemoryOptimized, IOPS scaling, Terraform azure postgres, create azure postgres, max_connections azure, scale down, scale storage, shrink storage, scale up, change tier, change SKU, increase compute, increase vCores, upgrade tier, server configuration, compute tier, storage tier, resize server, server sizing | [azure-postgresql-provisioning](references/azure-postgresql-provisioning.md) | Azure-specific. No generic equivalent. |
| zone redundant HA, zone-redundant, failover azure, PITR, read replica azure, geo-restore, backup azure postgres, high availability azure postgres, same-zone HA | [azure-postgresql-ha-disaster-recovery](references/azure-postgresql-ha-disaster-recovery.md) | Azure HA/DR. No generic equivalent. |
| Private Link, VNet, firewall rule azure, SSL azure, TLS azure, public access azure, private endpoint postgres, network access azure, can't connect, connection refused azure, SSL connection is required, certificate verify failed, connection timeout azure, network connectivity azure, allow IP, whitelist IP | [azure-postgresql-networking-ssl](references/azure-postgresql-networking-ssl.md) | Azure networking. No generic equivalent. |
| Query Store, index recommendations, performance insights, intelligent tuning, query performance azure, slow queries azure, indexes Azure PostgreSQL recommends | [azure-postgresql-intelligent-tuning](references/azure-postgresql-intelligent-tuning.md) | Azure-specific monitoring. Generic `postgresql-query-performance` covers EXPLAIN-based tuning |
| major version upgrade, maintenance window, in-place upgrade, MVU, upgrade postgres azure, schedule maintenance, upgrade my Azure PostgreSQL, upgrade from version | [azure-postgresql-upgrades-maintenance](references/azure-postgresql-upgrades-maintenance.md) | Azure-specific. No generic equivalent. |

**Azure quick-reference (when `isAzure: true`):**
- Tier: `SELECT current_setting('azure.server_tier', true);`
- Allowlist: `SHOW azure.extensions;`
- `az ... parameter set --value` replaces the full list; fetch current values first.

---

## Quick Decision Tree

- Vector or similarity → `azure-postgresql-vector-diskann` on Azure, otherwise `postgresql-vector-search`
- RAG or GenAI → `azure-postgresql-genai-patterns` only for in-database `azure_ai`; otherwise `postgresql-genai-rag`
- Extensions → Azure uses `azure-postgresql-extension-lifecycle`; non-Azure uses `postgresql-extensions`
- Connection pooling → Azure built-in pooler uses `azure-postgresql-connection-pooling`; otherwise `postgresql-connection-management`
- Azure-only topics like Entra ID, provisioning, HA, networking, upgrades → route to matching `azure-*` skill only when `isAzure: true`
- Generic topics like indexing, JSONB, partitioning, RLS, FTS, replication → use `postgresql-*`

---

## Global Anti-Hallucination Policy

1. Verify Azure-specific claims with live checks like `SHOW`, `pg_settings`, or `pg_available_extensions` when possible.
2. State uncertainty explicitly instead of guessing.
3. Do not extrapolate beyond documented versions, tiers, or providers.
4. Treat generic skills as supplements, not scripts.
