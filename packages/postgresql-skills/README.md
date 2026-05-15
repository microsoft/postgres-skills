# @microsoft/postgresql-skills

Expert-curated PostgreSQL skills for AI coding agents. Covers indexing, query tuning, JSONB patterns, partitioning, full-text search, RLS, connection management, and logical replication.

## Skills included

| Skill | What it covers |
|---|---|
| **postgresql** (root) | Ground rules, version checks, error lookup table |
| **advanced-indexing** | B-tree, GIN, GiST, BRIN, partial/expression indexes |
| **query-performance** | EXPLAIN ANALYZE, pg_stat_statements, work_mem tuning |
| **jsonb-patterns** | JSONB operators, GIN indexing, jsonpath queries |
| **table-partitioning** | Range/list/hash partitioning, pg_partman, DETACH CONCURRENTLY |
| **full-text-search** | tsvector/tsquery, GIN vs GiST, dictionary config |
| **row-level-security** | Multi-tenant isolation, SECURITY DEFINER, pooler gotchas |
| **connection-management** | PgBouncer transaction mode, idle timeouts, SET restrictions |
| **logical-replication** | Publications, subscriptions, replica identity, conflict resolution |

## Installation

### Claude Code
```bash
claude mcp add postgresql-skills --from @microsoft/postgresql-skills
```

### GitHub Copilot CLI
```bash
copilot plugin add @microsoft/postgresql-skills
```

### OpenAI Codex CLI
```bash
codex install @microsoft/postgresql-skills
```

### Cursor
Add to `.cursor-plugin/plugins.json`:
```json
{ "name": "@microsoft/postgresql-skills" }
```

## Using with Azure?

Install [`@microsoft/azure-postgresql-skills`](../azure-postgresql-skills/) for DiskANN vector search, Entra ID auth, GenAI/RAG patterns, HA/DR, and 11 more Azure-specific skills.

## License

MIT
