# PostgreSQL Agent Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Skills: 21](https://img.shields.io/badge/Skills-21-green.svg)](#skill-catalog)
[![Platforms: 4](https://img.shields.io/badge/Platforms-Claude_|_Copilot_|_Codex_|_Cursor-purple.svg)](#get-started-in-60-seconds)

**Ship production PostgreSQL faster.** These 21 expert-curated agent skills give your AI coding assistant the deep PostgreSQL and Azure Database for PostgreSQL knowledge it doesn't have out of the box, so you get safe, version-aware, production-ready answers instead of Stack Overflow snippets.

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

## Two plugins, install what you need

Skills ship as **two independent plugins** so you only install what matches your stack:

| Plugin | Skills | For |
|--------|--------|-----|
| `postgresql-skills` | 9 (1 root + 8 feature) | Any PostgreSQL deployment (self-hosted, RDS, Cloud SQL, local) |
| `azure-postgresql-skills` | 12 (1 root + 11 feature) | Azure Database for PostgreSQL Flexible Server |

- **Generic PG only?** Install just `postgresql-skills`.
- **Azure PG?** Install `azure-postgresql-skills` (optionally add the generic plugin too for foundational skills).
- Each plugin is fully self-contained with no cross-plugin dependencies.

## Get started in 60 seconds

Clone this repo and your AI coding agent discovers both plugins automatically via the root manifest files:

```bash
git clone https://github.com/microsoft/postgresql-agent-skills.git
```

All four supported platforms auto-detect plugins from root-level manifests:

| Platform | Manifest | Auto-discovers |
|----------|----------|---------------|
| **Claude Code** | `.claude-plugin/marketplace.json` | Both plugins |
| **GitHub Copilot CLI** | `.claude-plugin/marketplace.json` | Both plugins |
| **Codex CLI** | `marketplace.json` | Both plugins |
| **Cursor** | `.cursor-plugin/marketplace.json` | Both plugins |

**Any other agent** — Point your agent's skill/plugin config at `plugins/postgresql-skills/` or `plugins/azure-postgresql-skills/`. Each has its own `.skills.json` manifest.

That's it. Start asking your agent PostgreSQL questions and the right skill activates automatically.

## Skill Catalog

### PostgreSQL Foundational (8 skills)

These skills work with any PostgreSQL deployment, whether self-hosted, managed, or local.

| Skill | Helps you with | What the agent learns that LLMs get wrong |
|-------|---------------|------------------------------------------|
| **query-performance** | Slow query diagnosis, EXPLAIN analysis, pg_stat_statements | JIT thresholds, parallel query pitfalls, vacuum/bloat tuning |
| **advanced-indexing** | Choosing the right index type (B-tree, GIN, GiST, BRIN) | Covering indexes, index-only scan prerequisites, deduplication (PG13+) |
| **connection-management** | Pooling, timeouts, connection lifecycle | `work_mem` multiplication in pools, prepared statement mode traps, SET guardrails |
| **table-partitioning** | Range/list/hash partitioning strategies | Partition pruning failures, default partition traps, PG14+ `DETACH CONCURRENTLY` |
| **jsonb-patterns** | Schema design, operators, indexing for JSONB | `jsonb_path_query` (PG12+), GIN trigram anti-patterns, containment vs existence |
| **logical-replication** | Publications, subscriptions, CDC patterns | Row filter (PG15+), conflict resolution, initial data sync strategies |
| **full-text-search** | tsvector, tsquery, ranking, multilingual search | Phrase search (PG9.6+), custom dictionaries, weighted ranking |
| **row-level-security** | Multi-tenant RLS policies | Policy stacking, leaky view anti-patterns, performance with 1000+ tenants |

### Azure Database for PostgreSQL (11 skills)

These skills are purpose-built for Azure Database for PostgreSQL Flexible Server, covering managed-service workflows, Azure AI integrations, and platform-specific safety guardrails.

| Skill | Helps you with | What the agent learns that LLMs get wrong |
|-------|---------------|------------------------------------------|
| **vector-diskann** | Billion-scale vector search with pgvector + DiskANN | `lists` vs `m`/`ef_construction` tuning, streaming DiskANN (Preview) |
| **genai-patterns** | Embeddings (in-database + external pgvector), RAG, hybrid search | Both azure_ai and external embedding paths, reciprocal rank fusion, chunk overlap |
| **azure-ai** | azure_ai extension setup, AI text functions (generate, classify, extract) | `create()` vs `create_embeddings()` disambiguation, managed identity config |
| **intelligent-tuning** | Query Store, autovacuum tuning, index recommendations | Query Store must be enabled first, `pg_qs.query_capture_mode` settings |
| **entra-id-auth** | Passwordless auth with Microsoft Entra and managed identity | Token refresh before 5-min expiry, `PGPASSWORD` with `az account get-access-token` |
| **connection-pooling** | Built-in PgBouncer configuration | Named prepared statements break in transaction mode, `pgbouncer.ini` on Flex |
| **ha-disaster-recovery** | Zone-redundant HA, geo-replicas, PITR | Forced failover vs planned, RPO/RTO per tier, PITR creates a new server |
| **networking-ssl** | Private endpoints, VNet integration, SSL enforcement | `sslmode=verify-full` with DigiCert G2 root CA, private DNS zones |
| **provisioning** | IaC with Bicep/Terraform, SKU selection | Burstable vs GP vs MO decision matrix, storage auto-grow caveats |
| **extension-lifecycle** | CREATE EXTENSION workflow and allowlisting | `azure.extensions` server parameter, `azure_pg_admin` role requirement |
| **upgrades-maintenance** | Major version upgrades, maintenance windows | `--validate-only` pre-check, extension compatibility matrix |

## Real-world examples

Here are tasks where skills make a measurable difference in answer quality:

**"Set up vector search for my product catalog"**
→ Agent uses **vector-diskann** to recommend DiskANN over HNSW for your 50M-row dataset, sets correct `m` and `ef_construction` values, and warns about `azure_pg_admin` role requirements.

**"My query went from 200ms to 8 seconds after deployment"**
→ Agent uses **query-performance** to walk through `EXPLAIN (ANALYZE, BUFFERS)`, checks for missing indexes, and flags that your new `work_mem` setting is too high for your pooled connection count.

**"Add Entra ID authentication to my app"**
→ Agent uses **entra-id-auth** to generate connection code with automatic token refresh, correct `sslmode`, and managed identity setup instead of copy-pasting expired token examples.

**"I need full-text search with ranking"**
→ Agent uses **full-text-search** to build a `tsvector`/`tsquery` pipeline with weighted ranking and `websearch_to_tsquery` (PG11+), avoiding the common mistake of using `LIKE '%term%'` on large tables.

## Eval-tested quality

Every skill is continuously evaluated against 107 test challenges covering activation accuracy, anti-pattern detection, and safety guardrails.

| Metric | What it measures | Latest |
|--------|-----------------|--------|
| **Precision** | Skills fire only when relevant (no noise) | 90.4% |
| **Recall** | Skills fire when needed (no misses) | 96.9% |
| **F1 Score** | Overall activation accuracy | 93.5% |
| **Win Rate** | Skill-augmented response beats baseline | 91.8% |
| **Cohen's d** | Effect size of skill injection | 1.005 (large) |
| **Hallucination Rate** | Azure-specific facts fabricated | 5/107 (4.7%) |

```bash
# Run evals yourself
python evals/pipeline.py --model gpt-4o-mini --concurrency 5

# Dry run (no API calls)
python evals/pipeline.py --dry-run
```

See [evals/README.md](evals/README.md) for details.

## Repository layout

```
postgresql-agent-skills/
├── .claude-plugin/marketplace.json      # Claude Code + Copilot CLI multi-plugin manifest
├── .cursor-plugin/marketplace.json      # Cursor multi-plugin manifest
├── marketplace.json                     # Codex CLI multi-plugin manifest
├── .skills.json                         # Master skills index (all 21, for evals + discovery)
├── mcp.json                             # MCP server config (postgresql + azure-postgresql)
├── package.json                         # Repo metadata and scripts
├── plugins/
│   ├── postgresql-skills/               # Plugin 1: Generic PostgreSQL (9 skills)
│   │   ├── .skills.json                 # Plugin skill manifest (relative paths)
│   │   ├── README.md
│   │   └── skills/
│   │       ├── SKILL.md                 # Root skill (ground rules + routing)
│   │       ├── query-performance/SKILL.md
│   │       ├── advanced-indexing/SKILL.md
│   │       └── ...                      # 6 more feature skills
│   └── azure-postgresql-skills/         # Plugin 2: Azure PostgreSQL (12 skills)
│       ├── .skills.json                 # Plugin skill manifest (relative paths)
│       ├── README.md
│       └── skills/
│           ├── SKILL.md                 # Root skill (ground rules + routing)
│           ├── vector-diskann/SKILL.md
│           ├── genai-patterns/SKILL.md
│           └── ...                      # 9 more feature skills
├── evals/                               # Evaluation pipeline (107 challenges)
└── README.md
```

Each skill lives in its own folder as a `SKILL.md` file inside its plugin's `skills/` directory. Root-level manifests handle all platform discovery; per-plugin `.skills.json` files provide relative paths for platform skill loading.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving skills.

## License

[MIT](LICENSE)
