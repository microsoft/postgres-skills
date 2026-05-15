# @microsoft/azure-postgresql-skills

Azure Database for PostgreSQL skills for AI coding agents. Covers DiskANN vector search, Entra ID auth, GenAI/RAG patterns, HA/DR, intelligent tuning, extension lifecycle, provisioning, and more.

## Skills included

| Skill | What it covers |
|---|---|
| **azure-postgresql** (root) | Ground rules, Azure CLI patterns, error lookup table |
| **extension-lifecycle** | Allowlist + install extensions on Flexible Server |
| **provisioning** | Create/resize servers, tier selection, storage IOPS |
| **ha-disaster-recovery** | Zone-redundant HA, failover, PITR, read replicas |
| **entra-id-auth** | Managed identity, service principal, passwordless auth |
| **networking-ssl** | Private Link, VNet, firewall rules, SSL/TLS |
| **connection-pooling** | Built-in PgBouncer, transaction mode, pool sizing |
| **intelligent-tuning** | Query Store, index recommendations, performance insights |
| **upgrades-maintenance** | Major version upgrades, maintenance windows |
| **vector-diskann** | DiskANN + pgvector indexes, HNSW vs DiskANN decision |
| **azure-ai** | azure_ai extension setup, LLM functions from SQL |
| **genai-patterns** | Embeddings, RAG, hybrid search, reciprocal rank fusion |

## Installation

### Claude Code
```bash
claude mcp add azure-postgresql-skills --from @microsoft/azure-postgresql-skills
```

### GitHub Copilot CLI
```bash
copilot plugin add @microsoft/azure-postgresql-skills
```

### OpenAI Codex CLI
```bash
codex install @microsoft/azure-postgresql-skills
```

### Cursor
Add to `.cursor-plugin/plugins.json`:
```json
{ "name": "@microsoft/azure-postgresql-skills" }
```

## MCP Server (coming soon)

This package includes a placeholder `mcp.json` for the Azure PostgreSQL MCP Server, which gives AI coding agents direct database access: list databases/tables, execute queries, manage server configuration, and more.

Once the MCP server CLI is published, update the `command` field in `mcp.json` with the install target (e.g., `npx @azure/postgresql-mcp-server`). See [Azure-Samples/azure-postgresql-mcp](https://github.com/Azure-Samples/azure-postgresql-mcp) for the upstream source.

## Companion package

For generic PostgreSQL best practices (indexing, query tuning, JSONB, partitioning, FTS, RLS, replication), install [`@microsoft/postgresql-skills`](../postgresql-skills/). Works great alongside this package.

## License

MIT
