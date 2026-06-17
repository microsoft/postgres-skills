# PostgreSQL Agent Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![References: 22](https://img.shields.io/badge/References-22-green.svg)](#reference-catalog)
[![Platforms: 3](https://img.shields.io/badge/Platforms-Claude_|_Copilot_|_Codex-purple.svg)](#get-started-in-60-seconds)

**Ship production PostgreSQL faster.** This skill's 22 expert-curated references give your AI coding assistant deep PostgreSQL and Azure Database for PostgreSQL knowledge it doesn't have out of the box, so you get safe, version-aware, production-ready answers instead of Stack Overflow snippets.

## What you get

Your AI agent already knows basic PostgreSQL syntax. These references fill in the hard parts:

| Without the skill | With the skill |
|----------------|-------------|
| Generic `CREATE INDEX` advice | Knows when to use GIN vs GiST vs BRIN and warns about partial index invalidation |
| `ALTER SYSTEM` suggestions that break managed databases | Blocks unsafe commands on Azure, recommends the correct server parameter workflow |
| Ignores connection pool interactions | Warns that `work_mem = 256MB` with 100 pooled connections can OOM your server |
| Token refresh? What token refresh? | Generates Entra ID auth code with 5-minute token refresh built in |
| Copy-paste `pgvector` examples | Tunes DiskANN parameters for your data scale and knows streaming DiskANN (Preview) |
| One-size-fits-all replication setup | Version-aware logical replication with PG15+ row filters and conflict resolution |

The skill activates automatically and routes to the right reference based on what you're working on. No manual switching, no configuration.

## Architecture: Single plugin with intelligent routing

This repo IS the plugin. A lightweight routing table (`plugin/skills/postgresql-best-practices/SKILL.md`, ~2000 tokens) loads first and directs to the relevant reference file based on your question and connection context.

```
User question → SKILL.md routing table → specific reference file (1500-2500 tokens)
                       ↓
              Azure gating check (isAzure: true/false)
```

- **Generic PostgreSQL?** Routing table sends to `postgresql-*` references (always available)
- **Azure PostgreSQL?** Routing table sends to `azure-postgresql-*` references (gated by connection check)
- **Token efficient:** Only the routing table + one reference file loads per interaction (~4000 tokens max)

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

That's it. Start your AI agent, ask PostgreSQL questions and the right skill activates automatically.

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

These references are gated by `pgsql_get_server_capabilities` → `isAzure: true`. They cover managed-service workflows, Azure AI integrations, and platform-specific safety guardrails.

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

## Real-world examples

**"Set up vector search for my product catalog"**
→ Agent routes to **postgresql-vector-search** (or **azure-postgresql-vector-diskann** on Azure) and recommends DiskANN for your 50M-row dataset with correct parameters.

**"My query went from 200ms to 8 seconds after deployment"**
→ Agent routes to **postgresql-query-performance** and walks through `EXPLAIN (ANALYZE, BUFFERS)`, checks for missing indexes, and flags `work_mem` conflicts with pooling.

**"Add Entra ID authentication to my app"**
→ Agent routes to **azure-postgresql-entra-id-auth** and generates connection code with automatic token refresh, correct `sslmode`, and managed identity setup.

**"I need to batch-embed 1 million rows without leaving the database"**
→ Agent routes to **azure-postgresql-genai-patterns** and provides the azure_ai batch loop with rate-limit pauses and dimension validation.

## Eval-tested quality

The skill is continuously evaluated against 300 test challenges across generic PostgreSQL and Azure-specific scenarios. CI runs on manual trigger (`workflow_dispatch`).

| Metric | What it measures | Latest |
|--------|-----------------|--------|
| **F1 Score** | Overall activation accuracy | 92.6% |
| **Precision** | Skill fires only when relevant | 93.1% |
| **Recall** | Skill fires when needed | 92.1% |
| **Win Rate (Overall)** | Skill beats no-skill baseline (paired judge) | 60.4% wins / 33.6% losses |
| **Win Rate (Generic)** | Generic PostgreSQL challenges | 61.5% wins / 29.1% losses |
| **Win Rate (Azure)** | Azure-specific challenges | 60.4% wins / 37.1% losses |
| **Correctness** | Factual accuracy (test vs control) | 98.8% vs 91.7% |
| **Hallucination Rate** | Managed-service confusion detected | 14/300 (4.7%) |
| **Wilcoxon p-value** | Statistical significance | p=0.0 |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving the skill and its references.

## License

[MIT](LICENSE)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
