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

## Connection Context Detection

Before referencing any skill, determine the connection type:

```
IF active connection exists:
  → Call `pgsql_get_server_capabilities` to check `isAzure` flag
  → IF isAzure == true: Azure skills ARE available, prefer them for overlapping topics
  → IF isAzure == false: Use ONLY postgresql-* skills (generic)
IF no active connection:
  → Use postgresql-* skills for generic questions
  → For Azure conceptual questions (user explicitly asks about Azure): reference azure-postgresql-* skills as informational only — do NOT execute operational commands
```

## Precedence Rules

1. If `isAzure: true` and topic overlaps (e.g., connection pooling, extensions, auth), **prefer the azure-postgresql-* reference** — it has managed-service constraints.
2. If Azure status is unknown and user asks a generic PostgreSQL question, use **only postgresql-* references**.
3. If Azure status is unknown and user explicitly asks about Azure, call capability check first. If unavailable, provide conceptual guidance with a disclaimer.

---

## PostgreSQL Skills (always available)

These skills apply to any PostgreSQL deployment — self-hosted, RDS, Cloud SQL, Azure, or local.

| Keyword triggers | Reference | What it covers |
|---|---|---|
| index, btree, gin, gist, brin, partial index, covering index, seq scan, create index, reindex | [postgresql-advanced-indexing](references/postgresql-advanced-indexing.md) | B-tree, GIN, GiST, BRIN, partial/expression/covering indexes, EXPLAIN analysis |
| jsonb, json, containment, GIN jsonb, jsonb_path, document store | [postgresql-jsonb-patterns](references/postgresql-jsonb-patterns.md) | JSONB operators, indexing strategies, query patterns, schema-on-read |
| partition, range partition, list partition, hash partition, pg_partman, archiving | [postgresql-table-partitioning](references/postgresql-table-partitioning.md) | Declarative partitioning, partition pruning, maintenance, pg_partman |
| row level security, RLS, tenant isolation, multi-tenant, policy, FORCE ROW LEVEL SECURITY | [postgresql-row-level-security](references/postgresql-row-level-security.md) | CREATE POLICY, per-tenant isolation, session variables, BYPASSRLS |
| tsvector, tsquery, full text search, ts_rank, websearch_to_tsquery, stemming | [postgresql-full-text-search](references/postgresql-full-text-search.md) | tsvector/tsquery, GIN indexes, ranking, language configs, hybrid search |
| connection pool, max_connections, too many connections, idle connections, pgbouncer | [postgresql-connection-management](references/postgresql-connection-management.md) | Pool sizing, PgBouncer modes, connection lifetime, monitoring |
| logical replication, publication, subscription, CDC, pg_logical, wal_level | [postgresql-replication](references/postgresql-replication.md) | Logical replication setup, row filters (PG15+), conflict resolution |
| slow query, EXPLAIN ANALYZE, seq scan, query plan, work_mem, vacuum, statistics | [postgresql-query-performance](references/postgresql-query-performance.md) | EXPLAIN reading, statistics tuning, vacuum strategy, work_mem, parallel query |

---

## Azure PostgreSQL Skills (requires Azure connection)

> **⚠️ GATE:** Do NOT reference these skills for operational guidance unless `pgsql_get_server_capabilities` confirms `isAzure: true`. For conceptual questions about Azure (user explicitly asks), provide informational answers with a disclaimer that operational steps require an Azure connection.

| Keyword triggers | Reference | What it covers |
|---|---|---|
| extension, CREATE EXTENSION, azure.extensions, allowlist, shared_preload_libraries | [azure-postgresql-extension-lifecycle](references/azure-postgresql-extension-lifecycle.md) | Extension allowlisting, install workflow, azure_pg_admin role |
| vector, embedding, DiskANN, pgvector, HNSW, similarity search, cosine distance | [azure-postgresql-vector-diskann](references/azure-postgresql-vector-diskann.md) | pgvector + pg_diskann setup, index selection, recall tuning |
| Entra ID, managed identity, service principal, passwordless, AAD, token auth | [azure-postgresql-entra-id-auth](references/azure-postgresql-entra-id-auth.md) | Managed identity auth, token refresh, connection strings |
| RAG, embeddings, azure_ai, LLM, generative AI, semantic search, hybrid search | [azure-postgresql-genai-patterns](references/azure-postgresql-genai-patterns.md) | RAG architecture, azure_ai extension, hybrid search, RRF |
| provision, create server, resize, tier, Burstable, GeneralPurpose, MemoryOptimized, IOPS | [azure-postgresql-provisioning](references/azure-postgresql-provisioning.md) | Server creation, tier selection, storage/IOPS, scaling |
| HA, high availability, failover, PITR, read replica, zone redundant, backup | [azure-postgresql-ha-disaster-recovery](references/azure-postgresql-ha-disaster-recovery.md) | Zone-redundant HA, failover testing, PITR, geo-restore |
| Private Link, VNet, firewall, SSL, TLS, network security, public access | [azure-postgresql-networking-ssl](references/azure-postgresql-networking-ssl.md) | Private Link, VNet integration, firewall rules, TLS enforcement |
| built-in PgBouncer, transaction mode, pool_mode, azure pooling | [azure-postgresql-connection-pooling](references/azure-postgresql-connection-pooling.md) | Built-in PgBouncer config, transaction vs session mode, pool sizing |
| Query Store, index recommendations, performance insights, intelligent tuning | [azure-postgresql-intelligent-tuning](references/azure-postgresql-intelligent-tuning.md) | Query Store, auto-tuning, index advisor, wait statistics |
| major version upgrade, maintenance window, in-place upgrade, PG version | [azure-postgresql-upgrades-maintenance](references/azure-postgresql-upgrades-maintenance.md) | Major version upgrades, maintenance windows, pre-upgrade checks |
| azure_ai extension, azure_openai, ai.complete, ai.embed, LLM from SQL | [azure-postgresql-azure-ai](references/azure-postgresql-azure-ai.md) | azure_ai setup, calling LLMs from SQL, embedding generation |

---

## Quick Decision Tree

```
User asks about PostgreSQL...
├── Generic question (indexing, partitioning, RLS, FTS, etc.)
│   └── → Use postgresql-* reference
├── Azure-specific question
│   ├── Active Azure connection confirmed?
│   │   ├── YES → Use azure-postgresql-* reference
│   │   └── NO → Conceptual answer only + "connect to Azure instance for operational steps"
│   └── Unknown connection state?
│       └── → Call pgsql_get_server_capabilities first
└── Overlapping topic (pooling, extensions, auth)
    ├── isAzure: true → Prefer azure-postgresql-* (has managed constraints)
    └── isAzure: false → Use postgresql-* only
```
