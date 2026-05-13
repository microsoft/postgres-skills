# PostgreSQL Agent Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Expert-curated skills for AI coding agents working with PostgreSQL and Azure Database for PostgreSQL.

## What are Agent Skills?

Agent skills are structured knowledge files that give AI coding agents (Claude Code, GitHub Copilot CLI, Codex CLI, Cursor) domain expertise they lack out of the box. Each skill teaches the agent **when** to activate, **what** to do, and **how** to verify success.

## Skill Categories

| Folder | Scope | Skills |
|--------|-------|--------|
| `postgresql/` | Generic PostgreSQL best practices | 8 foundational skills |
| `azure-postgresql/` | Azure Database for PostgreSQL | 13 Azure-specific skills |

## Quick Start

### Claude Code

```bash
claude mcp add postgresql-agent-skills --scope @microsoft/postgresql-agent-skills
```

### GitHub Copilot CLI

```bash
copilot skill install @microsoft/postgresql-agent-skills
```

### Codex CLI

```bash
codex plugin add @microsoft/postgresql-agent-skills
```

### Cursor

Add to `.cursor-plugin/plugin.json` in your project root, or install from the Cursor marketplace.

## Skill List

### PostgreSQL (Generic)

- **advanced-indexing** — B-tree, GIN, GiST, partial/expression indexes
- **jsonb-patterns** — Schema design, operators, indexing for JSONB
- **query-performance** — EXPLAIN analysis, plan optimization, pg_stat_statements
- **table-partitioning** — Range/list/hash partitioning strategies
- **row-level-security** — Multi-tenant RLS policies
- **full-text-search** — tsvector, tsquery, ranking, multilingual
- **connection-management** — Pooling, timeout tuning, connection lifecycle
- **logical-replication** — Publications, subscriptions, CDC patterns

### Azure Database for PostgreSQL

- **extension-lifecycle** — CREATE EXTENSION workflow, allowlisting, azure_pg_admin
- **provisioning** — IaC with Bicep/Terraform, SKU selection, CLI automation
- **ha-disaster-recovery** — Zone-redundant HA, geo-replicas, PITR
- **entra-id-auth** — Microsoft Entra passwordless, managed identity tokens
- **networking-ssl** — Private endpoints, VNet, SSL enforcement
- **connection-pooling** — PgBouncer (built-in), session vs transaction mode
- **intelligent-tuning** — Query Store, autovacuum tuning, index recommendations
- **upgrades-maintenance** — Major version upgrades, maintenance windows
- **vector-diskann** — pgvector + DiskANN for billion-scale vector search
- **embeddings-azure-ai** — Generate embeddings via azure_ai extension
- **rag-pipeline** — End-to-end RAG with hybrid search and RRF
- **azure-ai-extension** — azure_ai.invoke(), model catalog integration
- **ai-functions** — AI-powered SQL functions (summarize, classify, translate)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the skill inventory matrix, dependency graph, and naming conventions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving skills.

## License

[MIT](LICENSE)
