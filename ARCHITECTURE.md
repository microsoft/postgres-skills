# Architecture

This document defines the skill inventory matrix, dependency graph, and naming conventions for the PostgreSQL Agent Skills repository.

## Skill Inventory Matrix (P0)

### PostgreSQL (Generic Foundation)

| Skill ID | Skill Name | Folder Path | FRs Covered | Execution Mode | Token Tier |
|----------|-----------|-------------|-------------|----------------|------------|
| advanced-indexing | Advanced Indexing | `postgresql/advanced-indexing/` | F1a, F1b, F1c | sequential | 800-1200 |
| jsonb-patterns | JSONB Patterns | `postgresql/jsonb-patterns/` | F2a, F2b | sequential | 800-1200 |
| query-performance | Query Performance | `postgresql/query-performance/` | F3a, F3b | sequential | 800-1200 |
| table-partitioning | Table Partitioning | `postgresql/table-partitioning/` | F4a, F4b | sequential | 800-1200 |
| row-level-security | Row-Level Security | `postgresql/row-level-security/` | F5a, F5b | sequential | 800-1200 |
| full-text-search | Full-Text Search | `postgresql/full-text-search/` | F6a | sequential | 800-1200 |
| connection-management | Connection Management | `postgresql/connection-management/` | F7a, F7b | sequential | 800-1200 |
| logical-replication | Logical Replication | `postgresql/logical-replication/` | F8a, F8b | sequential | 800-1200 |

### Azure Database for PostgreSQL

| Skill ID | Skill Name | Folder Path | FRs Covered | Execution Mode | Token Tier |
|----------|-----------|-------------|-------------|----------------|------------|
| extension-lifecycle | Extension Lifecycle | `azure-postgresql/extension-lifecycle/` | 0a, 0b, 0c, 0d, 0e, 3c, 6n | sequential | 1500-1800 |
| provisioning | Provisioning | `azure-postgresql/provisioning/` | 1, 1a, 1b, 1c | sequential | 1500-1800 |
| ha-disaster-recovery | HA & Disaster Recovery | `azure-postgresql/ha-disaster-recovery/` | 2, 2a, 2b, 2c | requires_confirmation | 1500-1800 |
| entra-id-auth | Entra ID Auth | `azure-postgresql/entra-id-auth/` | 3, 6l, 6l-ii | sequential | 1500-1800 |
| networking-ssl | Networking & SSL | `azure-postgresql/networking-ssl/` | 3a, 3b, 6m | sequential | 1500-1800 |
| connection-pooling | Connection Pooling | `azure-postgresql/connection-pooling/` | 6b, 6b-ii | sequential | 800-1200 |
| intelligent-tuning | Intelligent Tuning | `azure-postgresql/intelligent-tuning/` | 4, 4a, 6k, 6k-ii, 6k-iii | sequential | 1500-1800 |
| upgrades-maintenance | Upgrades & Maintenance | `azure-postgresql/upgrades-maintenance/` | 4b, 4c, 4d | requires_confirmation | 1500-1800 |
| vector-diskann | Vector & DiskANN | `azure-postgresql/vector-diskann/` | 7, 7a, 7b, 7c, 9 | sequential | 1500-1800 |
| embeddings-azure-ai | Embeddings (Azure AI) | `azure-postgresql/embeddings-azure-ai/` | 8, 8-ii | sequential | 1500-1800 |
| rag-pipeline | RAG Pipeline | `azure-postgresql/rag-pipeline/` | 11, 12, 12-ii | sequential | 1500-1800 |
| azure-ai-extension | Azure AI Extension | `azure-postgresql/azure-ai-extension/` | 8a, 8a-ii, 8a-iv, 8b | sequential | 1500-1800 |
| ai-functions | AI Functions | `azure-postgresql/ai-functions/` | 10, 10a, 10b, 10c, 10d, 10e | sequential | 1500-1800 |

### Cross-Cutting FRs (Encoded as Constraints, Not Standalone Skills)

| FR | Behavior | Where Applied |
|----|----------|---------------|
| 6 | Execute SQL via MCP | All skills (MCP tool capability) |
| 6a | Recommend connection method | entra-id-auth, connection-pooling |
| 6g | Azure CLI commands | provisioning, extension-lifecycle |
| 6j | Destructive op confirmation | ha-disaster-recovery, upgrades-maintenance |

## Dependency Graph

Skills reference other skills in their "Overlaps with" section. This graph shows activation-time dependencies (if skill A fires, skill B may also be relevant).

```
postgresql/advanced-indexing
  ├── overlaps: query-performance (index recommendations)
  └── overlaps: jsonb-patterns (GIN indexes on JSONB)

postgresql/query-performance
  └── overlaps: advanced-indexing (missing index detection)

postgresql/jsonb-patterns
  └── overlaps: advanced-indexing (GIN index strategies)

postgresql/connection-management
  └── overlaps: connection-pooling (Azure PgBouncer)

azure-postgresql/extension-lifecycle
  ├── prerequisite-for: vector-diskann (CREATE EXTENSION vector)
  ├── prerequisite-for: azure-ai-extension (CREATE EXTENSION azure_ai)
  └── prerequisite-for: ai-functions (CREATE EXTENSION azure_ai)

azure-postgresql/entra-id-auth
  └── overlaps: networking-ssl (connection string context)

azure-postgresql/vector-diskann
  ├── depends-on: extension-lifecycle
  └── overlaps: embeddings-azure-ai (vector generation)

azure-postgresql/embeddings-azure-ai
  ├── depends-on: extension-lifecycle
  ├── depends-on: azure-ai-extension
  └── overlaps: rag-pipeline (embedding step)

azure-postgresql/rag-pipeline
  ├── depends-on: vector-diskann (vector storage)
  ├── depends-on: embeddings-azure-ai (vector generation)
  └── depends-on: azure-ai-extension (model invocation)

azure-postgresql/azure-ai-extension
  ├── depends-on: extension-lifecycle
  └── overlaps: ai-functions (invoke patterns)

azure-postgresql/ai-functions
  ├── depends-on: azure-ai-extension
  └── overlaps: embeddings-azure-ai (embedding functions)

azure-postgresql/ha-disaster-recovery
  └── overlaps: provisioning (replica provisioning)

azure-postgresql/intelligent-tuning
  └── overlaps: query-performance (generic EXPLAIN analysis)
```

## Naming Conventions

### Folder Names

- **Format:** lowercase kebab-case
- **Pattern:** `{action-or-topic}` (not `{verb}-{noun}`)
- **Examples:** `advanced-indexing`, `rag-pipeline`, `ha-disaster-recovery`

### Skill IDs (in .skills.json)

- Match the folder name exactly
- Example: folder `azure-postgresql/vector-diskann/` has ID `vector-diskann`

### SKILL.md Frontmatter `name` Field

- Match the folder name / skill ID
- Example: `name: vector-diskann`

### Tags

- Always include `postgresql` for generic skills
- Always include `azure`, `postgresql` for Azure skills
- Add topic tags: `indexing`, `jsonb`, `vector`, `rag`, `auth`, `ha`, etc.

### Platform Scope

Two valid values only:
- `postgresql` for generic skills
- `azure-postgresql` for Azure-specific skills

### Execution Mode

- `sequential` (default): Instructions are followed step-by-step
- `requires_confirmation`: Agent must ask user before executing destructive operations (PITR, failover, major version upgrade)

### Version

- Semantic versioning: `MAJOR.MINOR.PATCH`
- Start all skills at `1.0.0` on first publish
- Bump MINOR for new instructions within a skill
- Bump MAJOR for breaking changes to activation patterns

## File Tree

```
postgresql-agent-skills/
├── README.md
├── ARCHITECTURE.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── SUPPORT.md
├── CHANGELOG.md
├── LICENSE
├── package.json
├── .skills.json                    # Universal skill registry
├── marketplace.json                # Claude Code marketplace manifest
├── plugin.json                     # Codex CLI plugin manifest
├── .cursor-plugin/
│   └── plugin.json                 # Cursor plugin manifest
├── postgresql/
│   ├── advanced-indexing/SKILL.md
│   ├── jsonb-patterns/SKILL.md
│   ├── query-performance/SKILL.md
│   ├── table-partitioning/SKILL.md
│   ├── row-level-security/SKILL.md
│   ├── full-text-search/SKILL.md
│   ├── connection-management/SKILL.md
│   └── logical-replication/SKILL.md
├── azure-postgresql/
│   ├── extension-lifecycle/SKILL.md
│   ├── provisioning/SKILL.md
│   ├── ha-disaster-recovery/SKILL.md
│   ├── entra-id-auth/SKILL.md
│   ├── networking-ssl/SKILL.md
│   ├── connection-pooling/SKILL.md
│   ├── intelligent-tuning/SKILL.md
│   ├── upgrades-maintenance/SKILL.md
│   ├── vector-diskann/SKILL.md
│   ├── embeddings-azure-ai/SKILL.md
│   ├── rag-pipeline/SKILL.md
│   ├── azure-ai-extension/SKILL.md
│   └── ai-functions/SKILL.md
└── evals/
    ├── challenges/                 # 50 agent challenge definitions
    ├── judges/                     # LLM-as-judge configs
    ├── results/                    # Test run outputs
    └── README.md
```

## Design Decisions

1. **Single package, scope filter:** One npm package (`@microsoft/postgresql-agent-skills`) with `platform_scope` filter to load only relevant skills. Reduces friction vs. two separate packages.

2. **Flat azure-postgresql/ structure:** No sub-folders within azure-postgresql/. Each skill gets its own top-level folder. Simpler navigation, no ambiguity.

3. **FR consolidation:** Multiple FRs merged into one skill when they share activation patterns (e.g., all Entra ID auth FRs in one skill, not split by token type). Keeps total skill count manageable (21 skills) while covering all P0 requirements.

4. **Cross-cutting FRs as constraints:** FRs like "execute SQL" (6) and "destructive op confirmation" (6j) are encoded as constraints across skills, not standalone skills. They describe agent behavior, not teachable techniques.

5. **requires_confirmation for destructive ops:** Skills that trigger PITR, failover, or major version upgrades use `requires_confirmation: true` so the agent pauses for user approval.
