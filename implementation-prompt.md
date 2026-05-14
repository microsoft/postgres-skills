# Implementation Prompt: PostgreSQL Agent Skills

## [ROLE]

You are an expert in PostgreSQL, Azure CLI, and Azure Database for PostgreSQL. You are adept at writing skills for PostgreSQL following the AgentSkills.io format, which optimizes for token efficiency, minimal context switching, and the ability for agents to load only the right skill at the right time. You have researched how competitors (Neon, Supabase, Timescale, Cosmos DB, Google MCP Toolbox) write and structure skills, and you understand their best practices. Before generating anything, read the full spec and competitive research files listed in Key References below.

## [YOUR TASK]

**Deliverable order:** Generate each phase sequentially. Stop and wait for a user "CONTINUE" signal between each phase. Do not attempt multiple phases in a single pass.

**Phases:** Task 1A → CONTINUE → Task 1B → CONTINUE → Task 2 (Evals)

### Task 1A: Repository Architecture

Generate only the scaffolding. Do NOT generate SKILL.md bodies yet.
- Folder structure (`postgresql/` and `azure-postgresql/` with logical sub-folders), for example:
  ```
  postgresql-agent-skills/
  ├── postgresql/

  ├── azure-postgresql/

  ├── plugin.json                      # Codex manifest
  ├── marketplace.json                 # Claude Code manifest
  ├── .cursor-plugin/plugin.json       # Cursor manifest
  ├── .skills.json                     # npx skills add lock file
  ├── package.json
  ├── README.md                        # Overview, install instructions, quick start
  ├── CONTRIBUTING.md                  # How to contribute, PR process, skill authoring guide
  ├── CODE_OF_CONDUCT.md               # Microsoft Open Source Code of Conduct
  ├── SECURITY.md                      # Security vulnerability reporting (MSRC)
  ├── LICENSE                          # MIT license
  ├── SUPPORT.md                       # Support channels, issue filing guidance
  └── CHANGELOG.md                     # Release history
  ```
  This is a starting point. Consolidate or split skills based on activation overlap and token budget during generation.
- **Minimum viable skill:** If a skill's Instructions section would be fewer than 5 lines or merely restates general PostgreSQL documentation, merge it into an adjacent skill rather than shipping a thin standalone file.
- All plugin manifest files (Claude Code, Copilot CLI, Codex, Cursor)
  - Use officially documented manifest formats only.
  - If a platform lacks a stable public manifest specification, generate a proposed placeholder manifest with TODO comments and mark it experimental.
  - Do not hallucinate unsupported marketplace formats.
- Skill inventory matrix: table mapping each P0 FR to its target skill name or merged target skill name based on common functionality/scope, folder path, platform scope, and execution mode. 
- Dependency graph: which skills reference or depend on other skills
- Naming conventions document

**Wait for CONTINUE.**

### Task 1B: Generate Skill Files

Generate `SKILL.md` bodies for all P0 skills in our spec. Use the inventory matrix from Task 1A as your generation checklist.

#### Shared requirements (apply to Task 1B):

- Follow AgentSkills.io format (see Skill Format Reference below)
- **Skill consolidation:** Do not create one skill per FR blindly. Combine FRs into a single skill when they share activation patterns, prerequisites, execution flow, or when splitting would create redundant context. Prefer fewer high-signal skills over many narrow ones.
- Skills must have precise activation descriptions so agents load the right skill
- See Constraints section below for platform separation rules, MCP tool usage, and permission model
- **Stateful session assumption:** Assume the agent can discover environment details (e.g., `psql` availability, PostgreSQL version, `az cli` presence, server name) through its own tool calls. Each skill's Prerequisites section should list what it needs; the agent will verify on demand rather than relying on a separate pre-flight step.
- Generic skills must be role-agnostic (standard PostgreSQL permissions only).
- Azure skills assume `azure_pg_admin` (see Constraints for details).


#### Skill Format Reference

Each `SKILL.md` must follow this structure:

```markdown
---
name: skill-name
description: "Precise one-liner with exact product names and key terms"
tags: [postgresql, indexing, performance]
platform_scope: postgresql | azure-postgresql
activation:
  user_intent: ["phrase1", "phrase2"]
  technical_keywords: ["keyword1", "keyword2"]
  exclusion_conditions: ["when X, use skill Y instead"]
  adjacent_skills: ["sibling-skill"]
---

# Skill Title

## Prerequisites  ← AZURE SKILLS ONLY; omit for generic PG skills
[Only Azure-specific: azure_pg_admin, extension allowlist, server config, etc.]

## Instructions
[Step-by-step guidance. SQL examples, CLI commands, decision trees.
 End with a ### Verify subsection showing how to confirm success.]

## Common Mistakes
[Numbered list. Each item tagged [CRITICAL], [HIGH], or [MEDIUM].
 Top 2-3 items include ❌ Wrong / ✅ Right code pairs.
 Includes Azure error recovery (403, allowlist, RBAC) where applicable.]
```

**Section rules:**
- Generic PG skills: 2 body sections (Instructions, Common Mistakes)
- Azure skills: 3 body sections (Prerequisites, Instructions, Common Mistakes)
- Activation logic lives entirely in frontmatter `activation` block
- Impact tags: CRITICAL = data loss/security, HIGH = perf/reliability, MEDIUM = suboptimal

---

## Skill Format & Quality Standards

> These standards apply to ALL skill generation (Task 1B) and inform eval design (Task 2).

**Token budget:** Each skill must be under 2,000 tokens (counted using `tiktoken` cl100k_base tokenizer as reference). If a skill exceeds this, split it into focused sub-skills. Target 800-1,200 tokens for Generic skills (to allow room for user data) and 1,500-1,800 tokens for complex Azure-specific AI/RAG skills where detailed CLI/SQL examples are mandatory.

**Content priority (what to include vs. cut):**
- Prioritize: (1) activation precision, (2) failure prevention, (3) executable commands, (4) verification steps
- Minimize: conceptual explanations, historical background, long prose, repeated warnings
- Example budget per skill: at most 2 SQL examples, 2 CLI examples, 1 decision tree. AI/RAG skills may exceed this when detailed pipelines are mandatory.

---

**Wait for CONTINUE before Task 2.**

## Task 2: Generate the Evals Pipeline (separate deliverable)

Create `evals/pipeline.py` — a test suite measuring skill quality via before/after comparison.

**Structure:**
- 50 Agent Challenges (e.g., "Set up a RAG system with DiskANN")
- Control group: LLM without skills; Test group: LLM with `@microsoft/postgresql-agent-skills`

**Required components:**
1. Challenge definitions (task, difficulty, target skill, platform scope)
2. Expected tool usage and SQL/CLI pattern matchers (regex or AST-based)
3. Semantic output grading (LLM-as-judge)
4. Hallucination detectors (flag `ALTER SYSTEM`, `superuser`, cross-layer leakage)
5. Token accounting (flag budget violations)
6. Execution replay logs (full interaction traces)
7. Per-skill confusion matrix (TP/FP/FN/TN for activation)

**Scoring Rubric:**

| Metric | Success Criteria |
|--------|-----------------|
| Syntax Accuracy (Azure) | Uses `azure_pg_admin`, never superuser — 100% |
| Syntax Accuracy (Generic) | No Azure dependencies — 100% |
| Tool Selection | Uses MCP `executesql` vs. raw strings — >90% |
| Token Efficiency | Within tier budget — Pass/Fail |
| Hallucination Rate | No `ALTER SYSTEM`, no cross-layer leakage — 0% |
| Activation Precision | 10 queries/skill (5 positive, 5 negative) — false activations <20% |

**Additional validations:**
- MCP end-to-end integration test
- Edge cases: empty tables, missing CLI, version mismatch (pgvector <0.5.1)
- Managed Service Gap: agent uses `az CLI` for params instead of `postgresql.conf`
- Negative ROI: skill must simplify output, not over-engineer it
- Multi-model benchmarking: large model (Claude Opus 4.6) vs. small model (GPT-4o-mini); skill should elevate small-model quality
- Results report: pass/fail per skill, before/after scores, improvement recommendations


## Repository

- **Repo name:** `postgresql-agent-skills`
- **Org:** `microsoft`
- **MCP server name:** `pgsql-tools`
- **Package scope:** `@microsoft/postgresql-agent-skills`
- **File naming:** `SKILL.md` (uppercase), folders in kebab-case
- **Lock file:** `.skills.json` (for `npx skills add` compatibility)

## Key References

> **IMPORTANT:** Read these files in full before generating any output.

- **Spec (primary source of truth):** `agent-skills-spec-final.md`
  - Section 3: Functional Requirements
  - Section 4: Release Plan (PP/PuP/GA/Phase 2 milestones)
  - Appendix 1: Skills ROI Framework (litmus test)
  - Appendix 4: Manifest Strategy (single manifest recommendation)
  - Appendix 5: MCP Hosting Strategy (3 phases: pgsqltools CLI, plugin bundling, managed endpoint)
  - Appendix 9: Skills Scope (dual-layer rationale)
- **Competitive research:** `agent-skills-competitive-research.md` (competitor skill formats, marketplace analysis, AgentSkills.io spec details)


## Constraints

- Must pass Azure SDK release process for publishing (see `mcp-npm-publish-process.md`)
- CELA approval required before public release
- Generic (`postgresql/`) skills must work without any Azure dependency (no `az` CLI, no Azure endpoints, no Azure-specific extensions)
- Azure skills use MCP tools where available (`executesql`, `listtables`, `describetable`, `configureextensions`, `getservermetrics`), `az CLI` via terminal as fallback. MCP tool names are from `pgsql-tools` v1.x; if tools are renamed in a future version, update skill Instructions sections accordingly.
- No superuser assumptions: Azure uses `azure_pg_admin` role, not superuser. Skills must not use `ALTER SYSTEM SET` (fails on managed PostgreSQL); use `az postgres flexible-server parameter set` instead. Every `azure-postgresql/` skill must include a 403/PermissionDenied diagnostic tip in "Common Mistakes."
- Extension naming: use binary names (`CREATE EXTENSION vector`, not `pgvector`)
- AGE requires two-gate setup: allowlist AND shared_preload_libraries (unlike vector which only needs allowlist)
- AGE session initialization required: `LOAD 'age'` or `SET search_path = ag_catalog`
- Cypher must be wrapped in `ag_catalog.cypher()` SQL function (bare Cypher does not execute on AGE)
- AI Functions: disambiguate Azure's `extract()` from PostgreSQL's built-in `EXTRACT(YEAR FROM ...)` for date/time
- Destructive operations (DROP, TRUNCATE, DELETE without WHERE) require explicit user confirmation (FR 6j)
- **Non-reversible operation warnings:** Any skill touching provisioning or operations must include a bold warning for non-reversible actions (e.g., storage cannot be scaled down on Azure, tier downgrades may not be supported, HA disablement triggers a restart). The warning must appear before the CLI/SQL command, not after.
- PITR creates a new server, not in-place restore (connection string changes required)
- Do not include long preamble text; start the SKILL.md directly with the YAML frontmatter
- **"When to Use" activation categories** — each skill must define criteria in ALL of these:
  1. **User intent phrases** (e.g., "set up vector search," "create embedding index")
  2. **Technical keywords** (e.g., "DiskANN," "pgvector," "hybrid retrieval")
  3. **Required tools/extensions** (e.g., requires `vector` extension, requires `az cli`)
  4. **Exclusion conditions** (e.g., "Do NOT load when the user only needs basic similarity search")
  5. **Adjacent skills to avoid** (e.g., "Do not load alongside the basic pgvector skill")
  Avoid generic phrases like "Use this for performance." Vague activation descriptions cause agents to load the wrong skill.
  Seed descriptions and triggers with tokens developers actually type: CLI commands (`az postgres flexible-server`), function names (`extract()`, `rank()`), extension names (`azure_ai`, `age`, `vector`), error messages (`permission denied`, `access to library 'age' is not allowed`), and Azure-specific terms (`Entra ID`, `Flexible Server`, `DiskANN`).
- **Product disambiguation in frontmatter:** The `description` field must contain the exact product name (e.g., "Azure Database for PostgreSQL Flexible Server" or "PostgreSQL with pgvector extension"), never abbreviations or generic terms like "PostgreSQL" or "database."
- **postgresql vs. azure-postgresql separation:** Keep `postgresql/` for standard SQL that works on any PostgreSQL deployment. Keep `azure-postgresql/` for all Azure-specific skills (extensions, auth, AI functions, RAG, provisioning, operations). No sub-folders under `azure-postgresql/` beyond skill-level folders.
- **No Diagnostic Loops:** Explicitly forbid pre-query role checks inside individual skills unless the user specifically asks "What are my permissions?"

## Success Criteria

- [ ] All P0 skills are covered in an appropriate `SKILL.md` files
- [ ] Each skill is under 2,000 tokens
- [ ] Each skill passes the ROI litmus test: "Does the agent fail or produce suboptimal output without this skill?" (Appendix 1)
- [ ] Each skill lists its prerequisites so the agent can verify tool availability on demand
- [ ] Generic (`postgresql/`) skills are role-agnostic, use standard PostgreSQL permissions, and have no Azure dependency
- [ ] Azure skills assume `azure_pg_admin` with 403 diagnostic tips
- [ ] Plugin manifests present for Claude Code, Copilot CLI, Codex, and Cursor
- [ ] `.skills.json` lock file present for `npx skills add` compatibility
- [ ] Azure skills reference MCP tools where available and fall back to `az CLI` via terminal
- [ ] Non-functional requirements addressed: no secrets in config, destructive op detection, <2000 token budget per skill
- [ ] Evals pipeline produces pass/fail results per skill with before/after quality comparison
- [ ] No duplicate activation domains across skills (each skill has a unique trigger space)
- [ ] Every skill has at least one documented failure mode
- [ ] Every mutating skill includes rollback guidance where applicable
- [ ] Every Azure control-plane skill avoids unsupported managed-service operations
- [ ] Every skill references at least one verification mechanism
