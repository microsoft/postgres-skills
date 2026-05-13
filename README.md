# PostgreSQL Agent Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Skills: 21](https://img.shields.io/badge/Skills-21-green.svg)](#skill-catalog)
[![Evals: 97 challenges](https://img.shields.io/badge/Evals-97_challenges-orange.svg)](evals/)
[![Platforms: 4](https://img.shields.io/badge/Platforms-Claude_|_Copilot_|_Codex_|_Cursor-purple.svg)](#quick-start)

Expert-curated skills that give AI coding agents production-grade PostgreSQL and Azure Database for PostgreSQL expertise they lack out of the box.

## Why Agent Skills?

LLMs know basic PostgreSQL syntax, but struggle with:

- **Production footguns** (e.g., `work_mem` in connection pools, partial index invalidation)
- **Azure-specific workflows** (extension allowlisting, Entra ID token refresh, DiskANN tuning)
- **Version-aware advice** (PG14 vs PG16 differences in partitioning, JSONB, and replication)
- **Safety guardrails** (never `ALTER SYSTEM` on managed services, token budget awareness)

Agent skills fill these gaps with structured knowledge that activates contextually, only firing when relevant to the developer's actual task.

## How It Works

```
Developer asks question
        │
        ▼
┌──────────────────┐     ┌─────────────────────┐
│  AI Coding Agent │────▶│  Skill Router       │
│  (Claude, etc.)  │     │  (.skills.json)     │
└──────────────────┘     └─────────┬───────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
            ┌────────────┐ ┌────────────┐ ┌────────────┐
            │ postgresql/│ │   azure-   │ │  (no skill │
            │ SKILL.md   │ │postgresql/ │ │  needed)   │
            │            │ │ SKILL.md   │ │            │
            └────────────┘ └────────────┘ └────────────┘
```

Each `SKILL.md` follows a 6-section template:
1. **Identity** (YAML frontmatter with activation keywords)
2. **Activation Rules** (when to fire, when NOT to)
3. **Core Knowledge** (production patterns, version-specific details)
4. **Common Mistakes** (advanced footguns LLMs get wrong)
5. **Verification** (how the agent confirms success)
6. **References** (official docs links)

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

### Manual (any agent)

Clone the repo and point your agent's skill/plugin configuration at the repo root. The `.skills.json` file maps skill names to file paths.

## Skill Catalog

### PostgreSQL Foundational (8 skills)

| Skill | What it teaches | Key differentiators |
|-------|----------------|---------------------|
| **advanced-indexing** | B-tree, GIN, GiST, BRIN, partial/expression indexes | Covering indexes, index-only scan prerequisites, deduplication (PG13+) |
| **query-performance** | EXPLAIN analysis, pg_stat_statements, plan optimization | JIT thresholds, parallel query pitfalls, adaptive plans |
| **jsonb-patterns** | Schema design, operators, indexing for JSONB | `jsonb_path_query` (PG12+), GIN trigram anti-patterns, containment vs existence |
| **table-partitioning** | Range/list/hash partitioning strategies | Partition pruning failures, default partition traps, PG14+ detach concurrently |
| **row-level-security** | Multi-tenant RLS policies | Policy stacking, leaky view anti-patterns, performance with 1000+ tenants |
| **full-text-search** | tsvector, tsquery, ranking, multilingual | Phrase search (PG9.6+), custom dictionaries, weighted ranking |
| **connection-management** | Pooling, timeout tuning, connection lifecycle | `work_mem` multiplication in pools, prepared statement mode traps |
| **logical-replication** | Publications, subscriptions, CDC patterns | Row filter (PG15+), conflict resolution, initial data sync strategies |

### Azure Database for PostgreSQL (13 skills)

| Skill | What it teaches | Key differentiators |
|-------|----------------|---------------------|
| **vector-diskann** | pgvector + DiskANN for billion-scale vector search | `lists` vs `m`/`ef_construction` tuning, streaming DiskANN (Preview) |
| **intelligent-tuning** | Query Store, autovacuum tuning, index recommendations | `pg_qs.query_capture_mode`, bloat detection queries |
| **entra-id-auth** | Microsoft Entra passwordless auth, managed identity | Token refresh before 5-min expiry, `PGPASSWORD` with `az account get-access-token` |
| **azure-ai-extension** | `azure_ai.invoke()`, model catalog integration | Batch scoring, `azure_ai.set_setting()` for keys, error handling |
| **connection-pooling** | Built-in PgBouncer, session vs transaction mode | Named prepared statements break in transaction mode, `pgbouncer.ini` on Flex |
| **networking-ssl** | Private endpoints, VNet integration, SSL enforcement | `sslmode=verify-full` with DigiCert G2 root CA, private DNS zones |
| **provisioning** | IaC with Bicep/Terraform, SKU selection | Burstable vs GP vs MO decision matrix, storage auto-grow caveats |
| **ha-disaster-recovery** | Zone-redundant HA, geo-replicas, PITR | Forced failover vs planned, RPO/RTO per tier, `pg_is_in_recovery()` |
| **embeddings-azure-ai** | Generate embeddings via azure_ai extension | `text-embedding-3-small` dimensions parameter, batch chunking |
| **ai-functions** | AI-powered SQL functions (summarize, classify, translate) | System prompt injection in SQL, token limit per invocation |
| **rag-pipeline** | End-to-end RAG with hybrid search and RRF | Reciprocal rank fusion formula, chunk overlap strategy |
| **extension-lifecycle** | CREATE EXTENSION workflow, allowlisting | `azure.extensions` server parameter, `azure_pg_admin` role |
| **upgrades-maintenance** | Major version upgrades, maintenance windows | `--validate-only` pre-check, extension compatibility matrix |

## Evals

The repository includes a rigorous evaluation pipeline to measure skill quality:

```bash
# Dry run (no API calls)
python evals/pipeline.py --dry-run

# Full eval with gpt-4o
python evals/pipeline.py --model gpt-4o --provider azure_openai

# With judge-based semantic scoring
python evals/pipeline.py --model gpt-4o --provider azure_openai
# (judge enabled by default; use --no-judge to disable)
```

**What it measures:**

| Metric | What it tells you |
|--------|-------------------|
| **Delta** | Quality improvement from skills vs. control (no skills) |
| **Precision** | Skills activated correctly (no false positives) |
| **Recall** | Skills activated when needed (no misses) |
| **Hallucination Rate** | Managed-service anti-patterns in agent output |
| **Token Budget** | Skills stay within context window budgets |

**97 challenges** covering activation routing, pattern matching, anti-patterns, and negative tests (tasks that should NOT activate skills).

See [evals/README.md](evals/README.md) for full documentation.

## Repository Structure

```
postgresql-agent-skills/
├── postgresql/                 # 8 generic PostgreSQL skills
│   ├── advanced-indexing/SKILL.md
│   ├── query-performance/SKILL.md
│   └── ...
├── azure-postgresql/           # 13 Azure-specific skills
│   ├── vector-diskann/SKILL.md
│   ├── entra-id-auth/SKILL.md
│   └── ...
├── evals/                      # Evaluation pipeline
│   ├── challenges/challenges.yaml
│   ├── matchers/__init__.py
│   ├── judges/__init__.py
│   └── pipeline.py
├── .skills.json                # Skill routing manifest
├── marketplace.json            # Claude Code manifest
├── plugin.json                 # Codex CLI manifest
└── .cursor-plugin/plugin.json  # Cursor manifest
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the skill inventory matrix, dependency graph, and naming conventions.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or improving skills.

## License

[MIT](LICENSE)
