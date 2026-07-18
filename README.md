# PostgreSQL Agent Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![References: 32](https://img.shields.io/badge/References-32-green.svg)](#reference-catalog)
[![Platforms: 3](https://img.shields.io/badge/Platforms-Claude_|_Copilot_|_Codex-purple.svg)](#get-started-in-30-seconds)

**Ship production PostgreSQL faster.** This plugin turns your AI coding assistant into a PostgreSQL and Azure Database for PostgreSQL expert that can *act*, not just advise. It pairs 32 expert-curated skill references — including a full graph-database lifecycle on Apache AGE — with two execution hands: the **postgres-mcp MCP server** for working inside your database and the **Azure CLI** for managing your Flexible Server. You get safe, version-aware, production-ready results instead of Stack Overflow snippets.

## What you get

A default AI assistant gives you plausible-looking PostgreSQL advice. This plugin gives you expert guidance *and* runs it against your actual database, safely:

| A default assistant | With this plugin |
|----------------|-------------|
| Suggests generic SQL and hopes it fits | Reads your live schema, tier, and settings first, then tailors the answer |
| Confidently recommends commands that break managed databases | Applies managed-service guardrails and the correct Azure workflow |
| Explains what you *could* do | Executes it — query, index, provision, restore — with confirmation before anything destructive |
| Can't tell self-hosted from Azure | Detects the connection and routes to the right generic or Azure guidance |
| Hand-waves "just use a graph database" | Derives an ontology from your data, builds the graph on Apache AGE, and answers questions with openCypher — all inside PostgreSQL |

## How it works

This repo is the plugin. Installing it gives your agent three things that work together:

- **The skill** — a lightweight routing table that reads your question and connection, then loads the one matching reference (generic, Azure, or graph). A dedicated **pg-graph** skill owns the full Apache AGE lifecycle — ontology derivation, graph construction, and openCypher querying.
- **The postgres-mcp MCP server** — executes inside your database: runs queries, applies changes, inspects schema, builds and traverses graphs, and detects whether you're on Azure.
- **The Azure CLI (`az`)** — executes on the managed service: provisioning, scaling, parameters, HA and failover, replicas, point-in-time restore, networking, and upgrades.

## Get started in 30 seconds

Installation differs by host. Each host registers the marketplace, then installs the plugin.

### GitHub Copilot CLI

```bash
copilot plugin marketplace add microsoft/postgres-skills
copilot plugin install postgres-skills@postgres-skills
```

### Claude Code

```bash
claude plugin marketplace add microsoft/postgres-skills
claude plugin install postgres-skills@postgres-skills
```

### Codex CLI

```bash
codex plugin marketplace add microsoft/postgres-skills
codex plugin install postgres-skills@postgres-skills
```

## Real-world examples

### Working inside your database (via the postgres-mcp MCP server)

**"What tables do I have, and which are the biggest?"**
→ Introspects your live schema and reports tables, row estimates, and sizes.

**"Set up vector search for my product catalog"**
→ Routes to **postgresql-vector-search** (or **azure-postgresql-vector-diskann** on Azure) and applies the extension and index after you confirm.

**"My query went from 200ms to 8 seconds after deployment"**
→ Routes to **postgresql-query-performance** and runs `EXPLAIN (ANALYZE, BUFFERS)` live to find the regression.

**"Add multi-tenant isolation to these tables"**
→ Routes to **postgresql-row-level-security** and writes and applies the policies.

**"Partition my 500M-row events table by month"**
→ Routes to **postgresql-table-partitioning** and applies the DDL with confirmation.

**"Index my JSONB documents for containment queries"**
→ Routes to **postgresql-jsonb-patterns** and creates the right GIN index.

**"Batch-embed 1 million rows without leaving the database"**
→ Routes to **azure-postgresql-genai-patterns** and runs the `azure_ai` embedding loop.

### Building and querying graphs (via the pg-graph skill)

**"Turn my documents into a knowledge graph"**
→ Routes to **pg-graph → ontology-derivation**, samples your data, proposes node labels, edge types, and properties, and runs a human feedback loop before finalizing — then **extract-to-graph** MERGE-loads the graph on Apache AGE.

**"Generate an ontology from my existing tables"**
→ Routes to **pg-graph → ontology-derivation**, reads your schema and foreign keys, and proposes tables as node labels and FKs as edges for your review before anything is built.

**"Answer this by traversing my graph"**
→ Routes to **pg-graph → text-to-cypher**, introspects the graph schema first, then generates and runs a validated openCypher query wrapped in `ag_catalog.cypher(...)`.

**"Why did the graph recommend this?"**
→ Routes to **pg-graph → graph-explainability** and returns the reasoning path, provenance, and a confidence bounded by the weakest edge.

### Managing your Azure Flexible Server (via `az` CLI)

**"Provision a General Purpose server and scale it to 8 vCores"**
→ Routes to **azure-postgresql-provisioning**, discovers your server and resource group, and runs the `create` / `update` after confirming.

**"Change `work_mem` on my Azure server"**
→ Clarifies server-wide vs per-database scope, then runs `az postgres flexible-server parameter set`.

**"Set up zone-redundant HA and add a read replica"**
→ Routes to **azure-postgresql-ha-disaster-recovery** and runs the HA and `replica create` commands.

**"Roll my database back to 2pm yesterday"**
→ Routes to **azure-postgresql-ha-disaster-recovery** and runs a point-in-time restore after confirming.

**"I can't connect — 'SSL connection is required'"**
→ Routes to **azure-postgresql-networking-ssl** and checks firewall and private-endpoint/VNet setup.

**"Add passwordless Entra ID authentication to my app"**
→ Routes to **azure-postgresql-entra-id-auth** and generates the connection code and managed-identity setup.

**"Upgrade my server from PG13 to PG16"**
→ Routes to **azure-postgresql-upgrades-maintenance** and runs the pre-check before the upgrade.

## Reference Catalog

### PostgreSQL Foundational (11 references)

These references work with any PostgreSQL deployment — self-hosted, RDS, Cloud SQL, Azure, or local.

| Reference | Helps you with | What the agent learns that LLMs get wrong |
|-----------|---------------|------------------------------------------|
| **postgresql-vector-search** | pgvector setup, HNSW indexes, distance operators | Index type selection, recall tuning, operator/index mismatch |
| **postgresql-genai-rag** | RAG pipelines, hybrid search, chunking | RRF scoring, dimension mismatch, FTS + vector combination |
| **postgresql-extensions** | Extension install/upgrade, troubleshooting | shared_preload_libraries restart requirement, version compatibility |
| **postgresql-advanced-indexing** | B-tree, GIN, GiST, BRIN, partial indexes | Covering indexes, index-only scan prerequisites, deduplication (PG13+) |
| **postgresql-jsonb-patterns** | JSONB operators, indexing, query patterns | `jsonb_path_query` (PG12+), GIN trigram anti-patterns, containment vs existence |
| **postgresql-table-partitioning** | Range/list/hash partitioning | Partition pruning failures, default partition traps, PG14+ `DETACH CONCURRENTLY` |
| **postgresql-row-level-security** | Multi-tenant RLS policies | Policy stacking, leaky view anti-patterns, performance with 1000+ tenants |
| **postgresql-full-text-search** | tsvector, tsquery, ranking | Phrase search (PG9.6+), custom dictionaries, weighted ranking |
| **postgresql-connection-management** | Pooling, timeouts, connection lifecycle | `work_mem` multiplication in pools, prepared statement mode traps |
| **postgresql-replication** | Publications, subscriptions, CDC | Row filter (PG15+), conflict resolution, initial data sync strategies |
| **postgresql-query-performance** | EXPLAIN analysis, vacuum, statistics | JIT thresholds, parallel query pitfalls, vacuum/bloat tuning |

### Azure Database for PostgreSQL (11 references)

These references are gated by the connection capability check. They cover managed-service workflows, Azure AI integrations, and platform-specific safety guardrails.

| Reference | Helps you with | What the agent learns that LLMs get wrong |
|-----------|---------------|------------------------------------------|
| **azure-postgresql-vector-diskann** | DiskANN for billion-scale vector search | `lists` vs `m`/`ef_construction` tuning, DiskANN is Azure-only |
| **azure-postgresql-genai-patterns** | In-database embeddings + RAG with azure_ai | Batch processing limits, rate limit handling, Path A vs B decision |
| **azure-postgresql-azure-ai** | azure_ai extension setup, AI functions | `create()` vs `create_embeddings()`, managed identity config |
| **azure-postgresql-intelligent-tuning** | Query Store, index recommendations | Query Store must be enabled first, `pg_qs.query_capture_mode` |
| **azure-postgresql-entra-id-auth** | Passwordless auth with Entra ID | Token refresh before 5-min expiry, managed identity setup |
| **azure-postgresql-connection-pooling** | Built-in PgBouncer configuration | Prepared statements break in transaction mode |
| **azure-postgresql-ha-disaster-recovery** | Zone-redundant HA, PITR, geo-replicas | Forced vs planned failover, PITR creates NEW server |
| **azure-postgresql-networking-ssl** | Private endpoints, VNet, SSL | VNet chosen at creation (can't change), DigiCert G2 cert |
| **azure-postgresql-provisioning** | IaC, SKU selection, scaling | Burstable limits, storage can't shrink, IOPS scaling |
| **azure-postgresql-extension-lifecycle** | Extension allowlisting on Azure | `azure.extensions` param, `azure_pg_admin` role requirement |
| **azure-postgresql-upgrades-maintenance** | Major version upgrades, maintenance | MVU is one-way, no skip-version, `--validate-only` pre-check |

### Graph on PostgreSQL — Apache AGE (pg-graph, 10 references)

The **pg-graph** skill is the single home for graph work on PostgreSQL, covering the full lifecycle: derive an ontology from your data (with a human feedback loop), build the graph, and query it with openCypher, natural-language-to-Cypher, and graph-augmented retrieval. It uses only capabilities available today — agent-driven extraction over the MCP query tools (any PostgreSQL with AGE) or the `azure_ai` extension for in-database work at scale on Azure.

| Reference | Helps you with | What the agent learns that LLMs get wrong |
|-----------|---------------|------------------------------------------|
| **ontology-derivation** | Deriving a graph ontology from structured or unstructured data with a human feedback loop | Never finalize an ontology without user approval; agent-driven vs `azure_ai` modes; no unreleased `ai.*` primitives |
| **extract-to-graph** | Extracting, deduplicating, and MERGE-loading entities into AGE from a finalized ontology | Idempotent `MERGE` on stable business keys to avoid duplicate vertices across repeated extraction |
| **context-dedup** | Entity resolution and canonicalization of aliases | Blocking for scale, persistent canonical map, resolving via type + graph neighborhood + source snippet |
| **opencypher-age-patterns** | AGE setup, Cypher wrapping, MATCH/MERGE/CREATE, indexing vertices and edges | Cypher must be wrapped in `ag_catalog.cypher(...)` with a column definition list; `search_path` ordering |
| **text-to-cypher** | Turning a natural-language question into a validated openCypher query | Ground on schema first, `agtype` casting, no host bind parameters inside `$$...$$` |
| **graph-schema-introspection** | Discovering labels, edge types, and properties | Use the `ag_label` catalog so generated Cypher is grounded, not hallucinated |
| **graph-augmented-rag** | Retrieval combining vector similarity with graph traversal and reranking | Hybrid graph retrieval that goes beyond flat vector search |
| **graph-explainability** | Provenance, reasoning paths, and explainable recommendations | Confidence bounded by the weakest edge on the path; reproducible reasoning trace |
| **azure-ai-semantic-search** | Enabling and configuring `azure_ai` and generating embeddings for semantic search | Read current settings and ask for endpoint/key/deployment — never invent them |
| **examples** | End-to-end worked graph examples spanning schema, query, and results | Grounded in the wrapping and safety rules from the other pg-graph references |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving the skill and its references.

## License

[MIT](LICENSE)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
