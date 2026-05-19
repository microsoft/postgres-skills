---
name: postgresql-agent-skills
description: "Expert PostgreSQL skills with intelligent routing. Covers both generic PostgreSQL and Azure Database for PostgreSQL."
tags: [postgresql, azure, database, skills, routing]
activation:
  user_intent: ["work with PostgreSQL", "database query", "connect to postgres", "Azure PostgreSQL"]
  technical_keywords: ["postgresql", "postgres", "psql", "pg_", "azure database for postgresql", "flexible server", "pgvector", "diskann"]
---

# PostgreSQL Agent Skills — Routing Table

This skill routes to specialized PostgreSQL references based on your question and connection context.

## Principles

**1. Know your PostgreSQL version before writing SQL:**
```sql
SELECT version();
```
Version-gated features: `MERGE` (PG 15+), `json_table` (PG 17+), `DETACH CONCURRENTLY` (PG 14+). If syntax error, check version first.

**2. Confirm every change — do not assume success:**
- Extension installed? → `SELECT * FROM pg_extension WHERE extname = 'x';`
- Table/index created? → query `pg_class` or `information_schema`
- Parameter changed? → `SHOW param;` (check `pending_restart` in `pg_settings`)

**3. When stuck, diagnose — do not retry blindly:**

| Error pattern | Likely cause | Fix |
|---|---|---|
| `permission denied for table` | Missing role grant | `GRANT SELECT ON table TO role;` |
| `relation "x" does not exist` | Wrong schema/search_path | `SET search_path TO myschema, public;` |
| `could not connect to server` | Host/port or pg_hba.conf | Check `listen_addresses` and pg_hba rules |

**4. Safety rules:**
- Never use `ALTER SYSTEM` on managed services — use portal/CLI/ARM instead
- Never assume `SUPERUSER` — use `azure_pg_admin` (Azure) or equivalent managed role
- Use `CONCURRENTLY` for `CREATE INDEX` / `REINDEX` / `DETACH PARTITION` in production
- Always include `IF NOT EXISTS` / `IF EXISTS` guards in DDL scripts
- Indexes are NOT free — each adds write overhead and storage
- `pgsql_modify` does NOT return row data (no RETURNING support)

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

| Keyword triggers | Reference | What it covers |
|---|---|---|
| pgvector, vector, HNSW, embedding, similarity search, cosine distance, vector index | [postgresql-vector-search](references/postgresql-vector-search.md) | pgvector setup, HNSW indexes, distance operators, recall tuning |
| RAG, embeddings, semantic search, hybrid search, reciprocal rank fusion, vector + text | [postgresql-genai-rag](references/postgresql-genai-rag.md) | RAG pipelines, hybrid search with RRF, chunking strategy |
| extension, CREATE EXTENSION, pg_stat_statements, pg_trgm, shared_preload_libraries | [postgresql-extensions](references/postgresql-extensions.md) | Extension install/upgrade, common extensions, troubleshooting |
| index, btree, gin, gist, brin, partial index, covering index, seq scan, create index, reindex | [postgresql-advanced-indexing](references/postgresql-advanced-indexing.md) | B-tree, GIN, GiST, BRIN, partial/expression/covering indexes |
| jsonb, json, containment, GIN jsonb, jsonb_path, document store | [postgresql-jsonb-patterns](references/postgresql-jsonb-patterns.md) | JSONB operators, indexing strategies, query patterns |
| partition, range partition, list partition, hash partition, pg_partman, archiving | [postgresql-table-partitioning](references/postgresql-table-partitioning.md) | Declarative partitioning, partition pruning, maintenance |
| row level security, RLS, tenant isolation, multi-tenant, policy, FORCE ROW LEVEL SECURITY | [postgresql-row-level-security](references/postgresql-row-level-security.md) | CREATE POLICY, per-tenant isolation, session variables |
| tsvector, tsquery, full text search, ts_rank, websearch_to_tsquery, stemming | [postgresql-full-text-search](references/postgresql-full-text-search.md) | tsvector/tsquery, GIN indexes, ranking, hybrid search |
| connection pool, max_connections, too many connections, idle connections, PgBouncer | [postgresql-connection-management](references/postgresql-connection-management.md) | Pool sizing, PgBouncer modes, connection lifetime |
| logical replication, publication, subscription, CDC, pg_logical, wal_level | [postgresql-replication](references/postgresql-replication.md) | Logical replication setup, row filters (PG15+), conflict resolution |
| slow query, EXPLAIN ANALYZE, query plan, work_mem, vacuum, statistics, performance | [postgresql-query-performance](references/postgresql-query-performance.md) | EXPLAIN reading, statistics tuning, vacuum, parallel query |

---

## Azure PostgreSQL Skills (requires `isAzure: true`)

> **GATE:** Only use these when `pgsql_get_server_capabilities` confirms `isAzure: true`. For conceptual questions without a connection, provide informational answers with a disclaimer.

| Keyword triggers | Reference | When to use INSTEAD OF generic |
|---|---|---|
| DiskANN, pg_diskann, filtered vector search, azure vector index | [azure-postgresql-vector-diskann](references/azure-postgresql-vector-diskann.md) | User needs DiskANN (Azure-only), filtered vector search, or is on Azure and needs index advice |
| azure_ai, azure_openai, ai.complete, ai.embed, in-database embeddings, LLM from SQL | [azure-postgresql-azure-ai](references/azure-postgresql-azure-ai.md) | User wants to call LLMs/embeddings directly from SQL (azure_ai extension) |
| azure_ai + RAG, in-database RAG pipeline, azure genai | [azure-postgresql-genai-patterns](references/azure-postgresql-genai-patterns.md) | User wants end-to-end RAG using azure_ai (in-DB embeddings). If app-driven RAG on Azure, use generic `postgresql-genai-rag` instead |
| azure.extensions, allowlist, extension on Azure, azure_pg_admin | [azure-postgresql-extension-lifecycle](references/azure-postgresql-extension-lifecycle.md) | Extension install ON AZURE (allowlist workflow). Generic `postgresql-extensions` covers non-Azure |
| Entra ID, managed identity, service principal, passwordless auth, AAD token | [azure-postgresql-entra-id-auth](references/azure-postgresql-entra-id-auth.md) | Azure-specific auth only. No generic equivalent. |
| built-in PgBouncer, azure connection pooling, pool_mode on azure | [azure-postgresql-connection-pooling](references/azure-postgresql-connection-pooling.md) | Azure built-in PgBouncer. Generic `postgresql-connection-management` covers standalone PgBouncer |
| provision, create server, resize, tier, Burstable, GeneralPurpose, MemoryOptimized, IOPS | [azure-postgresql-provisioning](references/azure-postgresql-provisioning.md) | Azure-specific. No generic equivalent. |
| HA, zone redundant, failover, PITR, read replica, geo-restore, backup | [azure-postgresql-ha-disaster-recovery](references/azure-postgresql-ha-disaster-recovery.md) | Azure HA/DR. No generic equivalent. |
| Private Link, VNet, firewall rule, SSL on azure, TLS, public access | [azure-postgresql-networking-ssl](references/azure-postgresql-networking-ssl.md) | Azure networking. No generic equivalent. |
| Query Store, index recommendations, performance insights, intelligent tuning | [azure-postgresql-intelligent-tuning](references/azure-postgresql-intelligent-tuning.md) | Azure-specific monitoring. Generic `postgresql-query-performance` covers EXPLAIN-based tuning |
| major version upgrade, maintenance window, in-place upgrade | [azure-postgresql-upgrades-maintenance](references/azure-postgresql-upgrades-maintenance.md) | Azure-specific. No generic equivalent. |

**Azure-specific gotchas (when `isAzure: true`):**
- Check tier first: `SELECT current_setting('azure.server_tier', true);` — Burstable does NOT support read replicas or zone-redundant HA
- Check allowlist: `SHOW azure.extensions;` — extensions must be allowlisted before `CREATE EXTENSION`
- `az postgres flexible-server parameter set --value` for list params **replaces entire list** — always include existing values
- `--sku-name` format is `Standard_{series}` (e.g., `Standard_D2ds_v4`), NOT just the series name
- Some parameter changes require restart — check `pg_settings.pending_restart`

| Azure error | Cause | Fix |
|---|---|---|
| `permission denied for function` | Missing role | `GRANT azure_pg_admin TO youruser;` |
| `extension is not available` | Not allowlisted | Allowlist via Portal/CLI first |
| `must be loaded via shared_preload_libraries` | Needs preload + restart | Set param via CLI, then restart |
| `SSL connection is required` | sslmode missing | Use `sslmode=require` |

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
