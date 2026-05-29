# PostgreSQL Agent Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Skills: 22](https://img.shields.io/badge/Skills-22-green.svg)](#skill-catalog)
[![Platforms: 4](https://img.shields.io/badge/Platforms-Claude_|_Copilot_|_Codex_|_Cursor-purple.svg)](#get-started-in-60-seconds)

**Ship production PostgreSQL faster.** These 22 expert-curated agent skills give your AI coding assistant deep PostgreSQL and Azure Database for PostgreSQL knowledge it doesn't have out of the box, so you get safe, version-aware, production-ready answers instead of Stack Overflow snippets.

## What you get

Your AI agent already knows basic PostgreSQL syntax. These skills fill in the hard parts:

| Without skills | With skills |
|----------------|-------------|
| Generic `CREATE INDEX` advice | Knows when to use GIN vs GiST vs BRIN and warns about partial index invalidation |
| `ALTER SYSTEM` suggestions that break managed databases | Blocks unsafe commands on Azure, recommends the correct server parameter workflow |
| Ignores connection pool interactions | Warns that `work_mem = 256MB` with 100 pooled connections can OOM your server |
| Token refresh? What token refresh? | Generates Entra ID auth code with 5-minute token refresh built in |
| Copy-paste `pgvector` examples | Tunes DiskANN parameters for your data scale and knows streaming DiskANN (Preview) |
| One-size-fits-all replication setup | Version-aware logical replication with PG15+ row filters and conflict resolution |

Skills activate automatically based on what you're working on. No manual switching, no configuration.

## Architecture: Single plugin with intelligent routing

This repo IS the plugin. A lightweight routing table (`skills/postgresql-best-practices/SKILL.md`, ~2000 tokens) loads first and directs to the relevant reference file based on your question and connection context.

```
User question → SKILL.md routing table → specific reference file (1500-2500 tokens)
                       ↓
              Azure gating check (isAzure: true/false)
```

- **Generic PostgreSQL?** Routing table sends to `postgresql-*` references (always available)
- **Azure PostgreSQL?** Routing table sends to `azure-postgresql-*` references (gated by connection check)
- **Token efficient:** Only the routing table + one reference file loads per interaction (~4000 tokens max)

## Get started in 60 seconds

Clone this repo and your AI coding agent discovers the plugin automatically via the root manifest:

```bash
git clone https://github.com/aditivgupta/postgresql-agent-skills.git
```

All four supported platforms auto-detect from root-level manifests:

| Platform | Manifest | Setup |
|----------|----------|-------|
| **GitHub Copilot** | `.skills.json` | Clone repo, Copilot auto-discovers |
| **Claude Code** | `.skills.json` | Clone repo, Claude auto-discovers |
| **Codex CLI** | `.skills.json` | Clone repo, Codex auto-discovers |
| **Cursor** | `.skills.json` | Clone repo, add as workspace skill |

That's it. Start asking your agent PostgreSQL questions and the right skill activates automatically.

## Skill Catalog

### PostgreSQL Foundational (11 references)

These skills work with any PostgreSQL deployment — self-hosted, RDS, Cloud SQL, Azure, or local.

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

Every skill is continuously evaluated against 300 test challenges across generic PostgreSQL and Azure-specific scenarios. CI runs on manual trigger (`workflow_dispatch`).

| Metric | What it measures | Latest |
|--------|-----------------|--------|
| **F1 Score** | Overall activation accuracy | 92.6% |
| **Precision** | Skills fire only when relevant | 93.1% |
| **Recall** | Skills fire when needed | 92.1% |
| **Win Rate (Overall)** | Skills beat no-skill baseline (paired judge) | 60.4% wins / 33.6% losses |
| **Win Rate (Generic)** | Generic PostgreSQL challenges | 61.5% wins / 29.1% losses |
| **Win Rate (Azure)** | Azure-specific challenges | 60.4% wins / 37.1% losses |
| **Correctness** | Factual accuracy (test vs control) | 98.8% vs 91.7% |
| **Hallucination Rate** | Managed-service confusion detected | 14/300 (4.7%) |
| **Wilcoxon p-value** | Statistical significance | p=0.0 |

```bash
# Run evals (requires Azure OpenAI key)
cd tests/evals
python pipeline.py --provider azure --model gpt-5.4 --concurrency 3

# Run generic-only subset
python pipeline.py --provider azure --model gpt-5.4 --concurrency 3 --challenges challenges/generic_only.yaml

# Dry run (no API calls, validates structure)
python pipeline.py --dry-run
```

## Repository layout

```
postgresql-agent-skills/
├── .skills.json                         # Root manifest (platform discovery)
├── skills/
│   ├── SKILL.md                         # Routing table + principles (~2000 tokens)
│   └── references/                      # 22 detailed reference files
│       ├── postgresql-vector-search.md
│       ├── postgresql-genai-rag.md
│       ├── azure-postgresql-vector-diskann.md
│       ├── azure-postgresql-genai-patterns.md
│       └── ...                          # 18 more references
├── tests/
│   ├── checks/                          # CI checks (routing precision, size, security)
│   ├── evals/                           # Eval pipeline (300 challenges, LLM-as-judge)
│   │   ├── pipeline.py                  # Main eval orchestrator
│   │   ├── challenges/challenges.yaml   # 300 test challenges
│   │   └── results/latest.json          # Auto-committed eval results
│   └── test_ai_app.js                   # 90-check dogfood test
├── .github/workflows/ci.yml             # 16-job CI pipeline
├── run_mcp.js                           # MCP server entry point
└── README.md
```

## How routing works

1. Agent loads `skills/postgresql-best-practices/SKILL.md` (lightweight routing table)
2. Routing table matches user's question to a reference file via keyword triggers
3. Azure references are gated: `pgsql_get_server_capabilities` must confirm `isAzure: true`
4. Agent loads the specific reference file and combines it with its own knowledge
5. Reference provides Azure-specific constraints, decision guides, and anti-hallucination guardrails

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving skills.

## License

[MIT](LICENSE)

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.
