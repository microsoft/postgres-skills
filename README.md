# PostgreSQL Agent Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Skills: 19](https://img.shields.io/badge/Skills-19-green.svg)](#skill-catalog)
[![Platforms: 4](https://img.shields.io/badge/Platforms-Claude_|_Copilot_|_Codex_|_Cursor-purple.svg)](#get-started-in-60-seconds)

**Ship production PostgreSQL faster.** These 19 expert-curated agent skills give your AI coding assistant the deep PostgreSQL and Azure Database for PostgreSQL knowledge it doesn't have out of the box, so you get safe, version-aware, production-ready answers instead of Stack Overflow snippets.

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

## Get started in 60 seconds

Pick your AI coding agent and install:

**Claude Code**
```bash
claude mcp add postgresql-agent-skills --scope @microsoft/postgresql-agent-skills
```

**GitHub Copilot CLI**
```bash
copilot skill install @microsoft/postgresql-agent-skills
```

**Codex CLI**
```bash
codex plugin add @microsoft/postgresql-agent-skills
```

**Cursor** — Add to `.cursor-plugin/plugin.json` in your project root, or install from the Cursor marketplace.

**Any other agent** — Clone this repo and point your agent's skill/plugin config at the repo root. The `.skills.json` file maps skill names to file paths.

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

Every skill is continuously evaluated against 97 test challenges covering activation accuracy, anti-pattern detection, and safety guardrails.

| Metric | What it measures | Latest |
|--------|-----------------|--------|
| **Precision** | Skills fire only when relevant (no noise) | 89.1% |
| **Recall** | Skills fire when needed (no misses) | 94.3% |
| **F1 Score** | Overall activation accuracy | 91.6% |

```bash
# Run evals yourself
python evals/pipeline.py --model gpt-4o --provider azure_openai

# Dry run (no API calls)
python evals/pipeline.py --dry-run
```

See [evals/README.md](evals/README.md) for details.

## Repository layout

```
postgresql-agent-skills/
├── postgresql/                 # 8 foundational PostgreSQL skills
├── azure-postgresql/           # 11 Azure-specific skills
├── evals/                      # Evaluation pipeline (97 challenges)
├── .skills.json                # Skill routing manifest
├── marketplace.json            # Claude Code manifest
├── plugin.json                 # Codex CLI manifest
└── .cursor-plugin/plugin.json  # Cursor manifest
```

Each skill lives in its own folder as a `SKILL.md` file. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full skill inventory and naming conventions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving skills.

## License

[MIT](LICENSE)
