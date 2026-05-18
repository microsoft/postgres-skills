# @microsoft/postgresql-agent-skills

Expert PostgreSQL skills for AI coding agents — single plugin with intelligent routing.

## What's included

**19 reference skills** organized with connection-aware gating:

### Generic PostgreSQL (always available)
| Reference | Coverage |
|-----------|----------|
| postgresql-advanced-indexing | B-tree, GIN, GiST, BRIN, partial/covering indexes |
| postgresql-jsonb-patterns | JSONB operators, indexing, document store patterns |
| postgresql-table-partitioning | Declarative partitioning, pg_partman, archiving |
| postgresql-row-level-security | Tenant isolation, CREATE POLICY, session vars |
| postgresql-full-text-search | tsvector/tsquery, GIN search, ranking, hybrid |
| postgresql-connection-management | Pool sizing, PgBouncer, connection monitoring |
| postgresql-replication | Logical replication, CDC, row filters (PG15+) |
| postgresql-query-performance | EXPLAIN, vacuum, statistics, work_mem tuning |

### Azure Database for PostgreSQL (gated — requires Azure connection)
| Reference | Coverage |
|-----------|----------|
| azure-postgresql-extension-lifecycle | Allowlist + install workflow |
| azure-postgresql-vector-diskann | pgvector + DiskANN index setup |
| azure-postgresql-entra-id-auth | Managed identity, passwordless |
| azure-postgresql-genai-patterns | RAG, embeddings, hybrid search |
| azure-postgresql-provisioning | Server creation, tier selection |
| azure-postgresql-ha-disaster-recovery | Zone-redundant HA, PITR |
| azure-postgresql-networking-ssl | Private Link, VNet, TLS |
| azure-postgresql-connection-pooling | Built-in PgBouncer config |
| azure-postgresql-intelligent-tuning | Query Store, index advisor |
| azure-postgresql-upgrades-maintenance | Major version upgrades |
| azure-postgresql-azure-ai | azure_ai extension, LLM from SQL |

## How routing works

1. Agent loads the root `skills/SKILL.md` (lightweight routing table)
2. Based on user's question, routes to the appropriate reference in `skills/references/`
3. **Azure gating:** Azure references only activate when `pgsql_get_server_capabilities` confirms `isAzure: true`
4. Generic PostgreSQL skills are always available regardless of connection type

## Installation

### GitHub Copilot CLI
```bash
copilot plugin add @microsoft/postgresql-agent-skills
```

### Claude Code
```bash
claude mcp add postgresql-agent-skills --from @microsoft/postgresql-agent-skills
```

### OpenAI Codex CLI
```bash
codex install @microsoft/postgresql-agent-skills
```
