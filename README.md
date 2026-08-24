# PostgreSQL Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platforms: 3](https://img.shields.io/badge/Platforms-Claude_|_Copilot_|_Codex-purple.svg)](#get-started-in-30-seconds)

**Build, tune, and operate PostgreSQL with an AI assistant that can act, not just advise.** PostgreSQL Skills gives developers 32 expert-curated sub-skills for PostgreSQL anywhere: local, self-hosted, other clouds, Azure Database for PostgreSQL, and Azure HorizonDB. It covers application development, query performance, indexing, vector search, RAG, security, operations, and the full Apache AGE graph lifecycle. With **postgres-mcp** for database actions and the **Azure CLI** for Azure resource management, your assistant can inspect the real environment and safely execute approved changes instead of returning generic snippets.

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

- **The skill** — a lightweight routing table that reads your question and connection, then loads the matching sub-skill (generic, Azure, or graph). A dedicated **pg-graph** skill owns the full Apache AGE lifecycle — ontology derivation, graph construction, and openCypher querying.
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

### PostgreSQL anywhere

**"What tables do I have, and which are the biggest?"**
→ Introspects your live schema and reports tables, row estimates, and sizes.

**"Set up vector search for my product catalog"**
→ Selects the right vector index for your environment and applies the extension and index after you confirm.

**"My query went from 200ms to 8 seconds after deployment"**
→ Analyzes the live execution plan and buffer usage to identify the regression.

**"Add multi-tenant isolation to these tables"**
→ Designs row-level security policies for your tenancy model and applies them after confirmation.

**"Partition my 500M-row events table by month"**
→ Designs the partition layout, checks pruning requirements, and applies the DDL with confirmation.

**"Index my JSONB documents for containment queries"**
→ Examines the query pattern and creates the appropriate GIN index.

### Azure Database for PostgreSQL and HorizonDB

**"Batch-embed 1 million rows without leaving the database"**
→ Processes embeddings safely in batches with the `azure_ai` extension while respecting service limits.

**"Provision a General Purpose server and scale it to 8 vCores"**
→ Selects the right Azure resources and provisions or scales the server after confirmation.

**"Change `work_mem` on my Azure server"**
→ Clarifies server-wide vs per-database scope, validates the current configuration, and safely applies the parameter change.

**"Set up zone-redundant HA and add a read replica"**
→ Configures high availability and a read replica with the required topology and safety checks.

**"Roll my database back to 2pm yesterday"**
→ Validates the restore window and creates a point-in-time restored server after confirming the target time.

**"I can't connect — 'SSL connection is required'"**
→ Diagnoses firewall, private endpoint, VNet, DNS, and certificate configuration.

**"Add passwordless Entra ID authentication to my app"**
→ Generates the application connection code and managed-identity configuration.

**"Upgrade my server from PG13 to PG16"**
→ Validates extension and application compatibility and performs the required pre-check before the upgrade.

**"Create an Azure HorizonDB cluster and enable pgvector"**
→ Recognizes the HorizonDB environment and uses cluster and parameter-group guidance instead of applying Flexible Server workflows.

### Graph workloads with Apache AGE

**"Turn my documents into a knowledge graph"**
→ Samples your data, proposes node labels, edge types, and properties for review, then safely MERGE-loads the approved graph into Apache AGE.

**"Generate an ontology from my existing tables"**
→ Reads your schema and foreign keys and proposes tables as node labels and relationships as edges for review before anything is built.

**"Answer this by traversing my graph"**
→ Introspects the graph schema, then generates and runs a validated openCypher query.

**"Visualize my graph in VS Code"**
→ Returns complete vertices and edges with display labels so VS Code renders an interactive node-edge graph.

**"Why did the graph recommend this?"**
→ Returns the reasoning path, provenance, and confidence bounded by the weakest supporting edge.

## Sub-skill Catalog

### PostgreSQL Foundational (11 sub-skills)

These sub-skills work with any PostgreSQL deployment — self-hosted, RDS, Cloud SQL, Azure, or local.

| Sub-skill | Helps you with | What the agent learns that LLMs get wrong |
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

### Azure Database for PostgreSQL (11 sub-skills)

These sub-skills are gated by the connection capability check. They cover managed-service workflows, Azure AI integrations, and platform-specific safety guardrails.

Each Azure sub-skill also covers **Azure HorizonDB (Preview)** in an *On Azure HorizonDB* section. When your connection is a HorizonDB cluster (`*.horizondb.azure.com`), the agent routes to the HorizonDB-specific guidance — clusters, `az horizondb`, and parameter groups — instead of falling back to Flexible Server steps, and flags features not yet available on HorizonDB (VNet injection, built-in PgBouncer, index tuning, major-version upgrades, configurable backup retention, cross-region replicas). See [Azure HorizonDB](https://learn.microsoft.com/en-us/azure/horizondb/overview).

| Sub-skill | Helps you with | What the agent learns that LLMs get wrong |
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

### Graph on PostgreSQL — Apache AGE (pg-graph, 10 sub-skills)

The **pg-graph** skill is the single home for graph work on PostgreSQL, covering the full lifecycle: derive an ontology from your data (with a human feedback loop), build the graph, and query it with openCypher, natural-language-to-Cypher, and graph-augmented retrieval. It uses only capabilities available today — agent-driven extraction over the MCP query tools (any PostgreSQL with AGE) or the `azure_ai` extension for in-database work at scale on Azure.

| Sub-skill | Helps you with | What the agent learns that LLMs get wrong |
|-----------|---------------|------------------------------------------|
| **ontology-derivation** | Deriving a graph ontology from structured or unstructured data with a human feedback loop | Never finalize an ontology without user approval; agent-driven vs `azure_ai` modes; no unreleased `ai.*` primitives |
| **extract-to-graph** | Extracting, deduplicating, and MERGE-loading entities into AGE from a finalized ontology | Idempotent `MERGE` on stable business keys to avoid duplicate vertices across repeated extraction |
| **context-dedup** | Entity resolution and canonicalization of aliases | Blocking for scale, persistent canonical map, resolving via type + graph neighborhood + source snippet |
| **opencypher-age-patterns** | AGE setup, Cypher wrapping, MATCH/MERGE/CREATE, indexing vertices and edges | Cypher must be wrapped in `ag_catalog.cypher(...)` with a column definition list; `search_path` ordering |
| **text-to-cypher** | Turning a natural-language question into a validated openCypher query | Ground on schema first, `agtype` casting, no host bind parameters inside `$$...$$`; return full objects + `disp_label` for VS Code graph visualization |
| **graph-schema-introspection** | Discovering labels, edge types, and properties | Use the `ag_label` catalog so generated Cypher is grounded, not hallucinated |
| **graph-augmented-rag** | Retrieval combining vector similarity with graph traversal and reranking | Hybrid graph retrieval that goes beyond flat vector search |
| **graph-explainability** | Provenance, reasoning paths, and explainable recommendations | Confidence bounded by the weakest edge on the path; reproducible reasoning trace |
| **azure-ai-semantic-search** | Enabling and configuring `azure_ai` and generating embeddings for semantic search | Read current settings and ask for endpoint/key/deployment — never invent them |
| **examples** | End-to-end worked graph examples spanning schema, query, and results | Grounded in the wrapping and safety rules from the other pg-graph sub-skills |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving skills and sub-skills.

## License

[MIT](LICENSE)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
