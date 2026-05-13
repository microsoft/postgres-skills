<!-- MACHINE-OPTIMIZED -->
<!-- agent-skills-competitive-research.md | Competitive Research | 2026-04-20 -->

# Competitive Research: Database Agent Skills & Plugins for AI Coding Agents

## Metadata

```yaml
author: Aditi Gupta (adig)
date: 2026-04-20
status: Draft
area: Azure Database for PostgreSQL
decision_to_inform: Build strategy for Agent Skills package
competitors_analyzed:
  - Neon (Databricks)
  - Supabase
  - Google AlloyDB / MCP Toolbox for Databases
  - Azure Cosmos DB
  - Timescale / Tiger Data (pg-aiguide + tiger-cli)
```

---

## Executive Summary

The AI coding agent ecosystem is rapidly converging on database connectivity
as a critical capability. Every major database vendor now ships or plans to
ship an MCP-based plugin for AI coding agents (Codex, Copilot CLI,
Claude Code, Cursor, Gemini CLI). **Azure Database for PostgreSQL has no
plugin or Agent Skills package today.** Competitors are filling this gap
by shipping Codex plugins (Neon), MCP servers with 20+ tools (Supabase),
Agent Skills packages with curated Postgres best practices (Timescale),
and multi-database MCP gateways (Google MCP Toolbox). Developers building on Azure
PostgreSQL must rely on generic, third-party tooling or go without.

**Key findings:**

1. **Neon shipped a Codex plugin on 2026-04-16** bundling an MCP app, a
   Postgres skill, and an egress optimizer skill. Now a Databricks company
   with enterprise distribution reach.
2. **Supabase has the most complete package** with 20+ MCP tools, curated
   Postgres best-practices skill, public hosted MCP endpoint, and listings
   on all three marketplaces (Codex, Claude with 63,510 installs, Cursor).
   Threat level: HIGH.
3. **Google ships MCP Toolbox for Databases** (open source, 14.7k GitHub
   stars, 15+ databases) with an Agent Skills generation command.
4. **Timescale (Tiger Data) has the most polished skills experience for
   PostgreSQL** with pg-aiguide (1.7k stars): curated best-practice skills,
   semantic doc search, and cloud service lifecycle management via tiger-cli.
5. **Azure Cosmos DB shipped a full Agent Skills kit** covering data
   modeling, partition key design, query optimization, SDK usage, scaling,
   and monitoring.
6. **Azure PostgreSQL has zero agent presence today.** Unique advantages
   (DiskANN, AI Functions, Graph-augmented RAG, Apache AGE, azure_ai, Entra ID)
   are not exposed to any AI coding agent.
7. **Both Cursor and Claude marketplaces now accept public plugin
   submissions.** Cursor at cursor.com/marketplace/publish (manual review
   by Cursor team). Claude at claude.com/plugins with a public browsable
   directory, install counts, and submission form
   (clau.de/plugin-directory-submission, reviewed by Anthropic). Codex
   official Plugin Directory is "coming soon" with no public submission
   path. Cursor lists AWS Databases, CockroachDB, Neon Postgres, Azure
   (generic), and Cosmos DB. Claude lists Supabase (63,510 installs),
   Neon (606 installs), MongoDB, PlanetScale, and Prisma.
   Azure PostgreSQL is absent from all three.

**Marketplace presence summary:**

| Vendor | Codex Marketplace | Claude Marketplace | Cursor Marketplace | npx skills | Hosted MCP | Manual config |
|--------|------------------|--------------------|-------------------|------------|------------|---------------|
| Neon | Listed | Listed (606 installs) | Listed | Yes | No | Gemini CLI, VS Code |
| Supabase | Listed | Listed (63,510 installs) | Listed | Yes | Yes | VS Code, Windsurf |
| Google MCP Toolbox | Installable (not listed) | Installable (not listed) | Not listed | No | No | Gemini CLI, Cursor (self-host) |
| Timescale | Listed | Installable (not listed) | Not listed | Yes | Yes | Gemini CLI, VS Code, Windsurf |
| Azure Cosmos DB | Installable (not listed) | Installable (not listed) | Listed | Yes | No | Copilot, Gemini CLI |
| **Azure PostgreSQL** | **None** | **None** | **None** | **None** | **None** | **None** |

---

## Competitor Deep Dive

### 1. Neon (now a Databricks company)

**What they shipped:**

| Component | Type | Description |
|-----------|------|-------------|
| Neon Postgres App | MCP-backed tools | Create/manage projects, branches, databases; run SQL; validate connections |
| Neon Postgres Skill | Workflow guide | Connection patterns, ORM setup, branching strategies, autoscaling, Neon Auth |
| Neon Egress Optimizer Skill | Cost skill | Diagnose and reduce data transfer costs |

**Distribution:** Listed on OpenAI Codex marketplace, Cursor Marketplace
(Infrastructure category, verified by Cursor), and Claude Plugin Directory
(606 installs at claude.com/plugins/neon). Also installable via
`npx skills add neondatabase/agent-skills -s neon-postgres`. Works with
Codex, Claude Code, Cursor. Source: github.com/neondatabase/agent-skills.
One of two database vendors (with Supabase) listed on all three marketplaces.

**Strengths:**
- First PostgreSQL vendor in Codex marketplace
- Branching-native (isolated dev environments per feature)
- Serverless autoscaling matches agent usage patterns
- Databricks enterprise distribution channel
- Three-component model (app + skill + optimizer) is the template others
  will follow

**Weaknesses:**
- No Entra ID / enterprise SSO integration
- No built-in AI/ML features (no vector search, no semantic operators)
- No graph database capabilities
- Egress optimizer skill is niche; no cost modeling beyond egress

**Threat level:** HIGH. Sets the bar for what a database Codex plugin
looks like. First-mover advantage in the Codex marketplace, and now also
listed in Cursor Marketplace (Infrastructure category, verified by Cursor).

---

### 2. Supabase

**What they shipped:**

| Component | Type | Description |
|-----------|------|-------------|
| MCP Server | MCP-backed tools (20+) | Design tables, run SQL, create branches, spin up projects, fetch config, generate TypeScript types, retrieve logs |
| Agent Skills package | SKILL.md skills | `supabase-postgres-best-practices` skill: query optimization, indexing, RLS, schema design, migrations, performance tuning, connection management, monitoring |
| Public hosted MCP endpoint | Live context server | `https://mcp.supabase.com/mcp?features=docs` for real-time docs and schema context |
| Database branching | Safety feature | Spin up isolated dev databases, merge back when ready |
| Destructive operation detection | Safety feature | Auto-detect dangerous operations, require confirmation |
| Edge Functions deployment | Compute integration | Create and deploy serverless functions from AI assistant |
| Project lifecycle management | Ops tools | Pause, restore, create new Supabase projects |

**Distribution:** Three installation paths:
1. `npx skills add supabase/agent-skills --skill supabase-postgres-best-practices` (AgentSkills.io)
2. Public MCP server: `https://mcp.supabase.com/mcp?features=docs`
3. Claude Code plugin: `/plugin marketplace add supabase/agent-skills`
4. MCP server (`@supabase/mcp-server-supabase`) for Cursor (listed in Cursor Marketplace), VS Code, any MCP client
5. Compatible with 18+ agents: Codex CLI, Claude Code, Cursor, Copilot, Windsurf, etc.

**Auth model:** Personal Access Token (PAT). OAuth 2 flow on roadmap.

**Strengths:**
- Most feature-rich MCP server (20+ tools)
- Now has Agent Skills via `npx skills` (AgentSkills.io standard)
- Public hosted MCP endpoint (zero-install live context)
- In Claude Code plugin marketplace
- Full project lifecycle management (not just queries)
- Built-in safety: branching, destructive operation detection
- TypeScript type generation (developer experience differentiator)
- Large open-source community
- Edge Functions integration (compute + database in one plugin)
- Curated Postgres best-practice skills (query optimization, indexing, RLS, schema design)
- Supports 18+ AI agents (Codex CLI, Claude Code, Cursor, Copilot, Windsurf, etc.)
- Listed on all three marketplaces (Codex, Claude, Cursor)

**Weaknesses:**
- PAT-based auth (no enterprise SSO yet)
- No AI/ML extensions (no vector search, no semantic operators)
- Schema discovery is basic (`list_tables` only, improvements planned)
- No enterprise compliance story
- No graph database capabilities

**Threat level:** HIGH. Supabase now has
the most complete package: 20+ MCP tools + Agent Skills + public hosted
MCP endpoint + listings on all three marketplaces (Codex, Claude with
63,510 installs, and Cursor). Their quadruple distribution (npx skills +
hosted MCP + Claude plugin + Cursor listing) exceeds every other
competitor. The Postgres
best-practices skill directly competes with our planned AI Skill.

---

### 3. Google AlloyDB + MCP Toolbox for Databases

**What they shipped:**

| Component | Description |
|-----------|-------------|
| MCP Toolbox (open source, Go) | Generic MCP server for 15+ databases |
| Prebuilt tools | `list_tables`, `execute_sql`, schema discovery, out-of-box |
| Custom tools framework | YAML-defined tools with structured queries, NL2SQL |
| Agent Skills generation | `toolbox skills-generate` command converts toolsets to portable skill packages |
| AlloyDB AI extensions | pgvector, ScaNN indexing, NL2SQL, model endpoints |
| Remote MCP Server | Managed MCP experience for Google Cloud databases |

**Distribution:** Works with Gemini CLI, Google Antigravity, Claude Code,
Codex, any MCP client. Installable via `npx @toolbox-sdk/server`.
Available in Google Antigravity MCP Store. Not listed in Cursor Marketplace
(manual config via `.cursor/mcp.json` for self-hosted instances).

**Auth model:** IAM-based integrated authentication. Supports authorized
parameters and end-to-end observability (OpenTelemetry).

**Agent Skills spec:** Implements the AgentSkills.io specification.
Can package toolsets into portable skill packages installable via
`gemini skills install`.

**Strengths:**
- Open source with massive community (14.7k stars, 134 contributors)
- Database-agnostic (supports PostgreSQL, MySQL, Oracle, MongoDB, etc.)
- Agent Skills generation is the most advanced approach
- IAM-based auth (enterprise-grade)
- SDKs for Python, JS/TS, Go, Java
- Works with LangChain, LlamaIndex, ADK, custom agents
- Connection pooling, OpenTelemetry built in
- Toolbox UI for testing

**Weaknesses:**
- Generic; not specialized for AlloyDB-specific features
- AlloyDB AI features (ScaNN, NL2SQL) are separate from Toolbox
- Complex setup (config files, server deployment)

**Threat level:** HIGH. The most comprehensive and mature solution.
The Agent Skills generation feature is ahead of everyone. Open source
nature means it could also support Azure PostgreSQL (competitive threat
and potential integration opportunity).

---

### 4. Azure Cosmos DB

**What they shipped:**

| Component | Description |
|-----------|-------------|
| Agent Skills Kit | `npx skills add AzureCosmosDB/cosmosdb-agent-kit` — curated skills for data modeling, partition key design, query optimization, SDK usage, scaling, monitoring |
| Cursor Plugin | Rules-based plugin with best-practices guidance |
| MCP server + configs | Live database connection; MCP server configs for NL-to-SQL, Graph-augmented RAG workflows |
| AI-powered guidance | Data modeling, query optimization, RAG app building |

**Distribution:** GitHub (`AzureCosmosDB/cosmosdb-agent-kit`), npx skills, Cursor Marketplace (listed). Compatible with GitHub Copilot, Claude Code, Gemini CLI, and other MCP-compatible agents.

**Auth model:** Entra ID supported.

**Strengths:**
- First Microsoft database with both agent skills AND AI coding agent plugin
- Full npx skills packaging (same distribution model as Supabase/Timescale)
- Entra ID integration story already documented
- Best practices and rules baked in (not just raw tooling)
- Broad platform support (Copilot, Claude Code, Gemini CLI, Cursor Marketplace listed)
- **Only Azure service listed in Cursor Marketplace** (cursor.com/marketplace)
- Azure ecosystem alignment
- Multi-model database (document, graph, key-value, column)
- MCP configs include NL-to-SQL and Graph-augmented RAG workflows

**Weaknesses:**
- No database branching or sandboxing capabilities

**Threat level:** MEDIUM. Different database, but **sets the internal bar
for Azure PostgreSQL**. Cosmos DB now has the full package: npx skills,
MCP server, multi-platform support, Entra ID, **and a Cursor Marketplace
listing** (the only Azure service listed there). Azure PostgreSQL must
match or exceed this level of investment.

---

### 5. Timescale (Tiger Data)

**What they shipped:**

Timescale ships TWO integrated products for AI coding agents:

| Component | Type | Description |
|-----------|------|-------------|
| pg-aiguide | MCP server + Claude plugin + Agent Skills | Curated Postgres best-practice skills + semantic search over PostgreSQL, TimescaleDB, PostGIS docs |
| tiger-cli | CLI + MCP server | Tiger Cloud service lifecycle management (create/fork/start/stop/resize/delete) + SQL execution + proxied docs from pg-aiguide |

**pg-aiguide tools:**

- `view_skill` - Curated, opinionated PostgreSQL best-practice skills covering
  schema design, indexing, data types, constraints, naming conventions,
  performance tuning, modern PG features
- `search_docs` - Semantic (vector) and keyword (BM25) search across PostgreSQL
  manual (version-aware), TimescaleDB docs, PostGIS docs

**tiger-cli MCP tools:**

- `service_list`, `service_get`, `service_create`, `service_fork`,
  `service_start`, `service_stop`, `service_resize`, `service_update_password`,
  `service_logs` - Full service lifecycle management
- `db_execute_query` - SQL execution with parameterized queries, timeouts,
  connection pooling
- Proxied `view_skill` and `search_docs` from pg-aiguide (enabled by default)

**Distribution:** Three installation paths:
1. `npx skills add timescale/pg-aiguide --skill postgres` (AgentSkills.io)
2. Public MCP server: `https://mcp.tigerdata.com/docs`
3. Claude Code plugin: `claude plugin marketplace add timescale/pg-aiguide`
4. `tiger mcp install` for: Claude Code, Codex, Cursor, Gemini CLI,
   VS Code, Windsurf

**Auth model:** Tiger Cloud API keys (public/secret key pair).

**Strengths:**
- One of only two Postgres vendors with `npx skills` integration (alongside Supabase)
- Public hosted MCP endpoint (zero-install)
- In Claude Code plugin marketplace
- Curated, opinionated skills (not just raw tools)
- Version-aware PostgreSQL documentation search
- PostGIS docs included (spatial use cases)
- Supports Codex, Claude Code, Cursor (manual config; not listed in Cursor Marketplace), Gemini CLI, VS Code, Windsurf
- Very actively maintained (commits within last week)
- Open source (Apache 2.0)
- Dual product strategy: generic Postgres skills (pg-aiguide) +
  cloud-specific ops (tiger-cli)

**Weaknesses:**
- No enterprise SSO
- No vector search skills (pgvector support "coming soon")
- No semantic operators or graph database capabilities
- No sandbox/branching features
- TimescaleDB-centric (time-series focus, not general-purpose AI/ML)
- Tiger Cloud is smaller than Azure/AWS/GCP (limited enterprise reach)
- No destructive operation protection
- No Agent Swarm / multi-agent support
- Not listed in Cursor Marketplace (manual config only)

**Threat level:** HIGH. pg-aiguide is the most polished "skills"
experience for PostgreSQL today. Their npx skills + public MCP +
Claude plugin triple distribution is best-in-class. The curated
best-practices approach directly competes with our planned AI Skill
and Graph Skill. Their weak spots are exactly where Azure PostgreSQL
can differentiate: no vector search, no semantic operators, no graph,
no enterprise auth.

---

## Feature Comparison Matrix

### 1. Marketplace Presence

Where each competitor is discoverable vs. merely installable.

| Marketplace | Neon | Supabase | Google MCP Toolbox | CosmosDB | Timescale | Azure PostgreSQL (PROPOSED) |
|-------------|------|----------|---------------------|----------|-----------|----------------------------|
| Codex Marketplace | LISTED | LISTED | Installable | Installable | LISTED | PLANNED (Listed) |
| Claude Plugin Directory | LISTED (606 installs) | LISTED (63,510 installs) | Installable | Installable | Installable | PLANNED (Listed) |
| Cursor Marketplace | LISTED | LISTED | Not listed | LISTED | Not listed | PLANNED (Listed, P0) |
| VS Code MCP | Manual config | Manual config | Manual config | None | Manual config | LATER |
| JetBrains MCP | None | None | None | None | None | LATER |

LISTED = browsable and discoverable in the marketplace UI (requires submission/review).
Installable = can be sideloaded via command, but not browsable in UI. User must know the repo name.
Manual config = user edits a JSON config file to point at an MCP server.

**Takeaway:** Neon and Supabase are the only competitors listed on all three
marketplaces (Codex, Claude, and Cursor). Supabase leads Claude with 63,510 installs.
Cosmos DB is the only Azure service listed on Cursor Marketplace. **Both
Cursor and Claude marketplaces accept public plugin submissions today.**
Cursor: cursor.com/marketplace/publish (manual review). Claude:
claude.com/plugins with browsable directory and submission form
(clau.de/plugin-directory-submission, reviewed by Anthropic). Codex
official Plugin Directory is "coming soon" with no public submission path.
Cursor already lists AWS Databases, CockroachDB, Azure (generic), Cosmos DB,
Neon Postgres, Appwrite, and Turbopuffer in its Infrastructure category.

### 2. Skills Packaging (bundled agent skills)

Which competitors ship curated, best-practice skill bundles (SKILL.md files or
equivalent) vs. raw MCP tool collections.

| Capability                       | Neon | Supabase | Google MCP Toolbox | CosmosDB | Timescale | Azure PostgreSQL (PROPOSED) |
|----------------------------------|------|----------|---------------------|----------|-----------|----------------------------|
| Agent Skills (SKILL.md bundles)  | YES  | YES      | YES                 | YES      | YES       | PLANNED                    |
| Curated best-practice skills     | No   | YES      | No                  | YES      | YES       | PLANNED                    |
| Doc search (semantic + BM25)     | No   | No       | No                  | No       | YES       | PLANNED                    |
| Cost optimization skills         | YES  | No       | No                  | No       | No        | PLANNED                    |
| Multi-agent / swarm support      | No   | No       | Toolsets            | No       | No        | PLANNED                    |

**Takeaway:** Timescale leads in skills depth (curated + doc search). Cosmos DB
and Supabase both ship curated Postgres/DB best-practice skills.

### 3. Installation and Distribution Mechanisms

How users actually install each competitor's tools.

| Mechanism                   | Neon | Supabase | Google MCP Toolbox | CosmosDB | Timescale | Azure PostgreSQL (PROPOSED) |
|-----------------------------|------|----------|---------------------|----------|-----------|----------------------------|
| `npx skills add` (AgentSkills.io) | YES | YES | YES               | YES      | YES       | PLANNED (P0)               |
| `npx add-mcp` (Neon universal)   | YES (creator) | No | No        | No       | No        | PLANNED (P1)               |
| Codex plugin manifest       | YES  | No       | No                  | No       | YES       | PLANNED (P0)               |
| Claude plugin manifest      | No   | YES      | No                  | No       | YES       | PLANNED (P0)               |
| Cursor plugin manifest      | YES  | No       | No                  | YES      | No        | PLANNED (P0)               |
| Public hosted MCP endpoint  | No   | YES      | No                  | No       | YES       | CONSIDER (P1)              |
| Direct config file editing  | YES  | YES      | YES                 | YES      | YES       | EXISTS*                    |

**Takeaway:** `npx skills add` is table-stakes (all five competitors ship it).
The differentiators are marketplace manifests and hosted MCP endpoints.

### 4. Database and AI Features

Core database capabilities exposed through the agent skills.

| Feature                    | Neon | Supabase | Google MCP Toolbox | CosmosDB  | Timescale | Azure PostgreSQL (PROPOSED) |
|----------------------------|------|----------|---------------------|-----------|-----------|----------------------------|
| MCP server                 | YES  | YES      | YES                 | YES       | YES       | EXISTS*                    |
| Schema discovery           | YES  | Basic    | YES                 | Limited   | No        | PLANNED                    |
| SQL execution              | YES  | YES      | YES                 | YES       | YES       | PLANNED                    |
| Safe SQL (read-only mode)  | No   | YES      | No                  | No        | No        | PLANNED                    |
| Database branching/sandbox | YES  | YES      | No                  | No        | No        | PLANNED                    |
| Project lifecycle mgmt     | YES  | YES      | No                  | No        | YES       | PLANNED                    |
| Vector search              | No   | No       | YES (AlloyDB)       | YES       | No        | ADVANTAGE                  |
| Semantic operators         | No   | No       | NL2SQL only         | No        | No        | ADVANTAGE                  |
| Graph queries (Cypher)     | No   | No       | No                  | Cosmos Gr | No        | ADVANTAGE                  |
| AI model integration       | No   | No       | Vertex AI           | Azure OAI | No        | ADVANTAGE                  |
| Entra ID / Azure RBAC      | No   | No       | No (IAM)            | YES       | No        | ADVANTAGE                  |
| Enterprise auth (SSO)      | No   | PAT      | IAM                 | Entra ID  | API keys  | ADVANTAGE                  |
| OpenTelemetry observability| No   | No       | YES                 | No        | No        | PLANNED                    |
| TypeScript type generation | No   | YES      | No                  | No        | No        | CONSIDER                   |

**Takeaway:** No competitor exposes advanced vector indexing, semantic search
operators, graph queries, in-database AI model invocation, or enterprise SSO
authentication through their agent skills. These five capability gaps represent
the largest uncontested surface area in the market today.

*EXISTS = Azure MCP Server for PostgreSQL is available but not packaged
as Agent Skills or a Codex-marketplace plugin.

---

## Distribution Channels Analysis

### Marketplace Listed vs. Marketplace Installable

An important distinction that affects competitive positioning:

| Level | What it means | Example |
|-------|--------------|---------|
| **Listed** | Plugin appears in the marketplace UI. Users can browse, search, and discover it without knowing it exists. Requires submission and often a review process. | Neon appears in Codex `/plugins` UI and Cursor Marketplace Infrastructure category; Timescale appears in Claude marketplace browse; Cosmos DB appears in Cursor Marketplace Infrastructure category. |
| **Installable** | Any GitHub repo can be sideloaded into a marketplace-enabled agent via a command. Not browsable in UI. User must already know the repo name. | `claude plugin marketplace add AzureCosmosDB/cosmosdb-agent-kit` works, but Cosmos DB does not show up when browsing the Claude marketplace. |
| **Manual config** | User edits an agent's config file to point at an MCP server. No marketplace involvement. | Adding a JSON snippet to `.cursor/mcp.json` for Supabase MCP. |

**Why this matters:** Being marketplace-installable is a low bar (any public repo
qualifies). Being marketplace-listed is a competitive advantage: it gives you discoverability,
credibility, and organic install flow. Timescale is listed on Codex (installable
on Claude via repo-based add, but not in the public claude.com/plugins directory).
Neon and Supabase are listed on all three marketplaces (Codex, Claude, Cursor). Cosmos DB is the only Azure service listed on Cursor
Marketplace. **Both Cursor and Claude marketplaces accept public plugin submissions
today** (Cursor: cursor.com/marketplace/publish; Claude:
claude.com/plugins + clau.de/plugin-directory-submission). Codex official Plugin
Directory is "coming soon." Our Phase 1 strategy should target listed status on
Cursor and Claude (submit immediately), then Codex as that directory opens.

### Channel Taxonomy

There are **8 distinct distribution channels** for getting agent skills and MCP
servers into developers' hands. They fall into three tiers:

**Tier 1: Write-once, reach-many (universal installers)**

| Channel | Mechanism | What it distributes | Reach |
|---------|-----------|-------------------|-------|
| **npx skills add** (AgentSkills.io) | `npx skills add <owner/repo>` copies SKILL.md files into agent-specific skills folders (`.agents/skills/`, `.claude/skills/`, etc.). Uses `.skills.json` lock file. | Skills (procedural knowledge, best practices) | Claude Code, Codex, Cursor, Copilot CLI, Gemini CLI, VS Code, Windsurf, Zed, 18+ agents |
| **npx add-mcp** (Neon) | `npx add-mcp <server-url>` detects all installed agents and writes MCP config to each. | MCP server connections (tools, not skills) | Claude Code, Codex, Cursor, VS Code, Gemini CLI, Copilot CLI, Windsurf, Zed, Antigravity, 15+ agents |

**Tier 2: Platform-specific marketplaces (curated, discoverable)**

| Channel | Mechanism | What it distributes | Reach |
|---------|-----------|-------------------|-------|
| **Codex Marketplace** | `.codex-plugin/plugin.json` manifest + skills + MCP config. Install via `codex /plugins` UI or `codex mcp add`. Official Plugin Directory "coming soon" (no public submission path yet). | Full plugins (skills + MCP + app integrations) | Codex CLI, VS Code (shared config) |
| **Claude Plugin Directory** | `.claude-plugin/plugin.json` + `marketplace.json` in any GitHub repo. Public browsable directory at claude.com/plugins with install counts. Submit at clau.de/plugin-directory-submission or claude.ai/settings/plugins/submit. Reviewed by Anthropic. Users can also add repos as marketplaces: `claude plugin marketplace add owner/repo`. Install via `/plugin install`. | Full plugins (skills + MCP + hooks) | Claude Code (desktop + CLI) |
| **Cursor Marketplace** | `.cursor-plugin/plugin.json` manifest + skills + rules (.mdc) + agents + commands + hooks + MCP config. Submit at cursor.com/marketplace/publish. Manual review by Cursor team. One-click install via cursor.com/marketplace. | Full plugins (skills + rules + agents + commands + hooks + MCP) | Cursor IDE |
| **GitHub MCP Registry** | Public browsable directory at github.com/mcp with install counts. MCP servers registered via GitHub repos. One-click "Install" button. Postgres-specific listings: DBHub (2,619 installs), pgEdge Postgres (147). Also lists Supabase (2,635), Neon (588), MongoDB (1,005). | MCP servers (tools) | GitHub Copilot CLI, VS Code, any MCP client |
| **VS Code MCP Marketplace** | Extensions panel > MCP Server Marketplace. Config via `.vscode/mcp.json`. Also supports `npx` and HTTP servers. | MCP servers (tools) | VS Code, GitHub Copilot in VS Code |
| **JetBrains MCP** | Built into IntelliJ 2025.2+. Settings > MCP Server. Supports STDIO + SSE. Extension points for custom tools. | MCP servers (tools) | IntelliJ, Rider, PyCharm, WebStorm, GoLand, all JetBrains IDEs |

**Tier 3: Config-file installation (manual, per-agent)**

| Channel | Mechanism | What it distributes | Reach |
|---------|-----------|-------------------|-------|
| **Direct config file** | Edit agent-specific JSON: `~/.copilot/mcp-config.json` (Copilot CLI), `.cursor/mcp.json` (Cursor), `settings.json` (Gemini CLI), `~/.codeium/windsurf/mcp_config.json` (Windsurf) | MCP server connections | Any single agent |
| **Public hosted MCP endpoint** | Zero-install URL (e.g., `https://mcp.supabase.com/mcp`). Users paste URL into any MCP-capable client. | Live MCP tools + docs | Any MCP client |

### What competitors chose

**Patterns observed:**
- Every competitor ships via `npx skills add` (AgentSkills.io is the de facto standard)
- Any repo is marketplace-installable on both Codex and Claude, but only Neon and Supabase are marketplace-listed on all three (Codex, Claude, Cursor)
- Neon is listed on Codex, Claude (606 installs), and Cursor; Supabase is listed on all three (63,510 installs on Claude)
- Cosmos DB is listed on Cursor Marketplace (the only Azure service with a Cursor listing)
- Both Cursor and Claude marketplaces accept public plugin submissions today; Codex directory is "coming soon"
- Cursor already lists database competitors: AWS Databases, CockroachDB, Turbopuffer, Appwrite, and Azure (generic)
- Google has not pursued any marketplace listings
- Only Neon built a universal installer (`npx add-mcp`), giving them config-free reach to 15+ agents
- Supabase and Timescale are the only two with public hosted MCP endpoints (zero-install)
- No competitor has invested in JetBrains MCP distribution

---

## Competitive Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| No Codex plugin exists today | HIGH | All five competitors already ship agent skills |
| MCP server exists but not packaged as skills | MEDIUM | Existing MCP server needs SKILL.md wrapping |
| No database branching (unlike Neon/Supabase) | MEDIUM | Schema isolation + PITR as alternative |
| No marketplace presence on Codex, Claude, or Cursor | HIGH | Neon listed on Codex + Claude + Cursor; Supabase listed on Claude (63,510 installs); Cosmos DB listed on Cursor; Azure PostgreSQL listed on none |
| Cursor and Claude marketplaces are live but we have no submission | HIGH | Both Cursor and Claude accept public submissions today. AWS Databases, CockroachDB, Cosmos DB on Cursor; Supabase, Neon, MongoDB on Claude. Lowest-friction path to first marketplace listings. |

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Competitors moving fast (Neon shipped few days ago) | HIGH | Fast-follow with differentiated features |
| Google MCP Toolbox could absorb our market (open source, 14.7k stars, already supports PostgreSQL) | HIGH | Differentiate on AI-native features (vector indexing, semantic operators, graph) that Toolbox cannot auto-generate |
| Marketplace fragmentation across 8 channels | MEDIUM | Invest in Tier 1 universal installers first (npx skills); add platform-specific channels incrementally |
| Agent Skills spec (AgentSkills.io) evolving | LOW | Align with Google's approach, contribute to spec |

---

## Forward Outlook

Six industry trajectories visible from this competitive analysis:

1. **AgentSkills.io is becoming the npm of agent skills.** All five
   competitors converged on `npx skills add` within weeks of each other.
   This protocol is consolidating fast. Vendors who delay adoption risk
   being left out of the default install flow for 18+ agents.

2. **A Codex + Claude + Cursor marketplace triopoly is forming.** Three
   marketplaces now have curated "listed" status with review gates. Both
   Cursor (cursor.com/marketplace/publish) and Claude
   (claude.com/plugins, clau.de/plugin-directory-submission) accept public
   plugin submissions today, both with review processes. Codex official
   Plugin Directory is "coming soon" with no public submission path.
   Being listed on all three is the new minimum bar for discoverability.
   Supabase leads Claude with 63,510 installs. Neon and Supabase are the
   only database vendors listed on all three marketplaces. Cursor already lists
   AWS Databases, CockroachDB, Azure (generic), and Cosmos DB in its
   Infrastructure category.

3. **MCP is the universal agent-database protocol.** All five competitors
   ship MCP servers. No competitor has bet on a proprietary protocol.
   MCP is becoming the USB-C of agent-to-database connectivity, and
   vendors without an MCP server are invisible to AI coding agents.

4. **Distribution is moving toward zero-install.** Supabase and Timescale
   both ship hosted MCP endpoints (paste a URL, no install). This mirrors
   the broader SaaS trend: the lowest-friction onboarding wins. Expect
   more vendors to ship public MCP URLs as a top-of-funnel strategy.

5. **Database vendors are expanding into AI platforms.** Neon (acquired by
   Databricks), Supabase (Edge Functions + compute), Google (Vertex AI
   integration) are all moving beyond storage into AI orchestration. The
   line between "database" and "AI platform" is blurring.

6. **Enterprise auth is the next battleground.** PATs and API keys dominate
   today. No Postgres competitor ships SSO-native agent skills. The first
   vendor to deliver enterprise-grade identity (SSO, RBAC, audit logging)
   inside agent workflows wins regulated industries (finance, healthcare,
   government).

