
Feature Spec
**Agent Skills for**** ****PostgreSQL**

**Author:** Aditi Gupta (adig)
**Date:** 2026-04-28
**Status:** Draft
**ADO Feature ID:** TBD
**Engineering Manager:** Rakesh Gujjula
**Engineer(s):** Alperen Cetin, Rob Emanuele
**UX Design Reviewer:** TBD
**Wave / Release:** TBD
## 1. Overview
### 1.1 Feature Description
Agent Skills for PostgreSQL is a bundled plugin that packages the Azure PostgreSQL MCP server together with SKILL.md guidance files covering both generic PostgreSQL best practices and Azure-specific capabilities. Following the same principle as our VSCode extension for Postgres (which targets all OSS workloads), the skills package includes foundation-level PostgreSQL skills that work on any deployment (self-hosted, AWS RDS, GCP CloudSQL, Azure) alongside Azure-differentiated skills (DiskANN, AI Functions, Graph-augmented RAG, azure_ai, Entra ID auth). This dual-layer approach de-risks adoption friction: developers on any PostgreSQL deployment get immediate value from generic skills, and Azure
users get additional differentiated skills on top.
The MCP server provides connectivity and core database tools; the skills layer teaches AI agents how to use those tools for advanced scenarios where agents fail without Azure-specific guidance (RAG pipelines, DiskANN indexing, Apache AGE graph queries, AI functions, enterprise auth). The bundled plugin targets Claude Code (P0), GitHub Copilot CLI (P0), Codex (P1), and Cursor (P2), with skills.sh publishing (`npx skills add`) as cross-platform fallback. Skills are selected by ROI delta: only capabilities where agents produce incorrect or suboptimal output without the skill are included.
### 1.2 Project Details

| Field | Value |
| --- | --- |
| Program Manager | Aditi Gupta (adig) |
| Engineering Manager | Rakesh Gujjula |
| Engineer(s) | Alperen Cetin, Rob Emanuele |
| UX Design Reviewer | TBD |
| ADO Feature ID | TBD |
| Status | Planning |
| Last Modified | 2026-04-28 |


## 2. What and Why
### 2.1 Purpose
**Current friction:**
- App developers using AI coding agents (Codex, Copilot CLI, Claude Code) cannot interact with Azure Database for PostgreSQL from their agent workflow. They must context-switch to the Azure Portal, psql, or documentation to provision databases, run queries, configure AI features, or set up graph pipelines.
- Beyond Azure-specific gaps, agents also fail at generic PostgreSQL patterns that affect all deployments: advanced indexing strategies (GIN, GiST, BRIN), JSONB optimization, EXPLAIN plan interpretation, table partitioning, row-level security, and full-text search. These failuresaffect every PostgreSQL developer regardless of cloud provider.
- The competitive landscape has moved fast. Neon, Supabase, and Timescale all ship true Postgres skills today via `npx skills add` and marketplace plugins. Azure Cosmos DB shipped its own agent skills kit. Google's MCP Toolbox supports 15+ databases with ADK skills.
- Azure PostgreSQL's unique AI capabilities (DiskANN, Semantic Operators, Graph-augmented RAG, Apache AGE) remain invisible to the AI coding agent ecosystem.

### 2.2 Current State
**Key pain points:**
- No agent skills exist for Azure PostgreSQL — so agents lack (1) reliable connection setup and (2) accurate, Azure-specific best-practice guidance; developers must leave their AI coding agent to perform any database operation.
- Azure PostgreSQL is invisible on every agent marketplace. A developer on Cursor, Claude, or Codex who searches for "postgres" finds Neon, Supabase, and Timescale but not Azure PostgreSQL. Even developers who know the MCP server exists must download pgsqltools CLI binaries, run them locally, and hand-edit their agent's MCP config, while competitors offer one-click marketplace installs.
### 
**What is available today:**
- **Azure MCP Server for PostgreSQL:** Developer downloads pgsqltools binaries, runs them locally, and configures their agent's MCP settings to connect. Provides basic connectivity (SQL execution, schema inspection) but no guidance for AI features, vector search, graph, or Azure-specific best practices. Developer can connect to Azure PostgreSQL via the VS Code extension or GitHub Copilot CLI through the MCP server. Cost: **manual **binary setup, no marketplace discoverability, limited to raw database operations.
- **Azure Portal / psql / documentation:** No intelligent guidance exists for PostgreSQL workflows. Users must manually piece together information from product docs, best-practice guides, troubleshooting articles, and Stack Overflow to perform even routine tasks (provisioning, extension setup, index tuning, connection configuration). Each change requires cross-referencing multiple sources, with no context-aware recommendations for the user's specific server configuration or workload. Cost: 6+ context switches, significant time overhead, error-prone.
- **Cursor extension:** We are on track to release a Cursor extension to allow developers on the Cursor AI coding platform to connect to Azure Database for PostgreSQL instances via the MCP server (pgsqltools CLI).

### 2.3 Proposed solution 
- **P0 (Private Preview): Bundle MCP server + ****core**** Azure Postgres**** and generic**** Postgres**** ****skills into marketplace plugins.**
Ship a single bundled plugin (MCP server + SKILL.md files) targeting Claude Code (P0) and GitHub Copilot CLI (P0) simultaneously. GitHub Copilot CLI is the most compatible with any format, making it the fastest path to launch. Claude Code is the native home for MCP (Anthropic invented the protocol) with the highest plugin install volumes (63K+ Postgres installs). (See Platform Analysis in Appendix Section 3)
- **Use existing MCP tools for:** SQL execution (`executesql`), schema inspection (`listtables`, `describetable`), extension configuration (`configureextensions`), server metrics (`getservermetrics`), and other operations the MCP server already provides.
- **Use az CLI where no MCP tool exists:** Server provisioning (`az postgres flexible-server create`), firewall and networking, scaling, HA, backup/restore, and other control-plane operations. Skills instruct the agent to run az CLI commands via the terminal.
- **Skills selection by ROI delta:** If the agent produces code that fails on Azure or generic PostgreSQL (see Skills Scope in Appendix Section 9), or produces a correct but dramatically suboptimal pattern because it does not know about an Azure-specific feature, that is a high-ROI skill. (See Skills ROI Framework in Appendix section 1 and Competitor Skills Inventory in Appendix section 2)
- **Universal plugin manifest:** Maintain a single SKILL.md + MCP server configuration as the canonical source. Each platform (Claude, Copilot CLI, Codex, Cursor) already accepts markdown-based skill definitions and standard MCP server configs natively. A universal manifest avoids the maintenance overhead of platform-specific wrappers while still being installable everywhere. (See Manifest Strategy Analysis in Appendix Section 4 )
- `azure-postgresql-agent-skills/        # Skills package (single install) ``+-- skills/                            # SKILL.md files (AgentSkills.io format) ``|   +-- azure-postgresql-core/SKILL.md       # Core DB workflows ``|   +-- azure-postgresql-vector-search/SKILL.md  # Vector/DiskANN guidance ``|   +-- azure-postgresql-rag/SKILL.md        # RAG pipeline setup ``|   +-- azure-postgresql-graph/SKILL.md      # Apache AGE graph workflows ``|   +-- azure-postgresql-graphrag/SKILL.md   # Graph-augmented RAG pipeline ``|   +-- azure-postgresql-semantic/SKILL.md   # Semantic SQL operators ``|   +-- ... ``+-- package.json                       # Skills package metadata ``+-- plugin.json                        # Codex marketplace manifest ``+-- marketplace.json                   # Claude marketplace manifest ``+-- .cursor-plugin/ ``|   +-- plugin.json                    # Cursor marketplace manifest ``+-- rules/                             # Cursor-specific .mdc rules (optional) ``+-- README.md `
- 
- **Bundled MCP evolution path:** pgsqltools CLI (current binary) → npm registry (`npx @azure/postgresql-mcp-server`) [required if binary cannot be bundled with all plugins]→ managed hosted endpoint (`mcp.postgres.azure.com`). Each step reduces friction; plugin manifests abstract the hosting model from the developer. (See Iterative MCP hosting Strategy in Appendix Section 5)
- **Pros:** Marketplace listings provide organic discoverability and one-click install on the two highest-priority platforms. Zero-config experience: one install gives connection + skills + MCP server. GitHub Copilot CLI accepts any format, so we can ship immediately. Claude has the largest proven Postgres plugin audience. No new MCP tool development needed. Matches how every competitor packages their offering.
- **Cons:** Must go through plugin listing and review process per platform. Each platform has its own manifest format. Requires publishing MCP server binary or npm package that the plugin can reference.
- **P1 (Public Preview): Expand marketplace**** presence**** ****and skills**** repo**** to include fleet management/****migration/****graph****/ P1 foundational PostgreSQL skills**** ****and ****publish via ****skills.sh.**** **(See skills.sh Publishing Strategy in Appendix Section 6)
Extend to Codex marketplace (P1) when it opens. Simultaneously publish skills to the skills.sh leaderboard for universal discoverability and installability on any coding agent platform (18+). `npx skills add` serves as the cross-platform fallback for agents without marketplace listings (Windsurf, Gemini CLI, JetBrains AI, OpenClaw).
- **Pros:** Codex has the largest agent developer base (81.7%). skills.sh leaderboard provides organic discovery beyond individual marketplaces. Universal installability on 18+ agents via `npx skills add`. Establishes Azure PostgreSQL as a visible player in the agent skills ecosystem.
- **Cons:** Codex marketplace timeline uncertain ("coming soon"). skills.sh visibility depends on skill quality signals and community adoption.
- **P2 (GA): ****Expand skills repo to include advanced skills and publish to ****Cursor marketplace + managed MCP endpoint.**
Publish to Cursor Marketplace (P2), which requires a specific `.cursor-plugin` format with bundled rules. Ship managed MCP endpoint (`mcp.postgres.azure.com`) for zero-install access on any MCP client.
- **Pros:** Cursor is the fastest-growing AI IDE. Managed endpoint eliminates all local binary friction. Zero-install demo path.
- **Cons:** Cursor plugin format requires additional packaging work (rules/, .mdc files). Managed endpoint adds network latency and requires Azure-side infrastructure.
**Target Users and ****Use cases enhanced****:**** **(See Persona Analysis in Appendix Section 7)
- P0: Full-stack developers can provision, configure, and query Azure PostgreSQL entirely from their AI coding agent (zero context switches, 60–80% time savings).
- P0: AI/ML engineers building semantic search applications can set up pgvector, configure DiskANN indexes, register embedding models, and run hybrid search queries through agent skills, replacing a multi-tool, multi-doc workflow with a single conversational setup.
- P1: Platform engineers managing PostgreSQL fleets can inventory servers across subscriptions, compare configurations, roll out parameter changes, coordinate major version upgrades, mirror server parameters across environments, and audit compliance posture — all from their AI coding agent, replacing the portal/CLI tab-switching workflow across dozens of servers.
- P1: Backend developers building knowledge graph applications can enable Apache AGE, construct graphs, and run Cypher queries via natural language.
- P2: DBAs can get performance tuning recommendations, index optimization advice, security audit guidance, and cost optimization insights through agent skills, replacing manual inspection of pgstatstatements, Azure Portal metrics, and documentation lookups. (See how this differentiates from DBAgent/SREAgent in Appendix Section 8)
### 
### 2.4 Goals and Non-Goals
**Goals:**
- Ship a dual-layer skills package: Foundation PostgreSQL skills that work on any PostgreSQL deployment (OSS, on-prem, any cloud) plus Azure-specific skills that leverage DiskANN, AI Functions, Entra ID, and managed-service capabilities. One install gives developers both layers.
- Close the Azure-specific knowledge gap in AI coding agents. Make Azure Database for PostgreSQL the most agent-friendly managed database.
- Only ship skills where AI agents produce incorrect, failing, or dramatically suboptimal output without the skill
- Enable zero-context-switch database workflows.
- Accelerate adoption of new Azure PostgreSQL capabilities and the plugin.
- Establish a sustainable, low-maintenance distribution channel.
- Differentiate from every Postgres competitor (Neon, Supabase, Timescale) by being the only plugin with AI-native skills (DiskANN, AI Functions, in-database embeddings, AGE graph) and enterprise auth (Entra ID, Managed Identity) that no competitor covers today.
- Publish to skills.sh leaderboard (P1) for universal discoverability and installability on 18+ coding agent platforms
**Non-Goals:**
- Investing in P2/P3 platform-specific packaging (Gemini CLI, Windsurf, JetBrains AI); these are covered passively via `skills.sh publishing`
- Building new MCP server tools (skills orchestrate existing MCP tools)
## 
## 3. Requirement Specification
### 3.3 Functional Requirements
**Priority definitions:**

| Priority | Definition |
| --- | --- |
| P0 | Must-have for the target milestone. Feature cannot ship without it. |
| P1 | Should-have. Important but the feature can ship with a workaround. |
| P2 | Nice-to-have. Planned for a future milestone or best-effort. |


#### Foundational PostgreSQL Skills (Skills 1–8)
##### Skill F1: Advanced Indexing Strategy

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F1a | I can get the correct index type recommendation (B-tree, GIN, GiST, BRIN) based on data type and query pattern instead of B-tree for everything | P0 | PP | Given a table definition and query pattern, When agent suggests an index, Then GIN recommended for JSONB/array/tsvector containment, GiST for geometric/range overlap, BRIN for time-ordered data, B-tree for equality/range on scalar columns | Agents default to B-tree for everything (including JSONB/arrays/full-text), and rarely suggest GiST for ranges/geospatial or BRIN for time-series where it’s the right fit. | Eliminates the most common Postgres performance anti-pattern: wrong index type (often the highest-impact generic tuning win). |
| F1b | I can get partial index suggestions for queries with constant predicates instead of full-table indexes | P0 | PP | Given a query with WHERE status = 'active', When agent creates an index, Then partial index suggested (WHERE status = 'active'), with size comparison to full index | Agents create full-table indexes even when queries always filter on a known predicate, missing that only a small fraction of rows are relevant. | ~20x index size reduction (and faster writes/reads) for filtered query patterns. |
| F1c | I can get expression index suggestions for computed column queries (e.g., lower(email), (data->>'type')) | P0 | PP | Given a query with function call in WHERE, When agent suggests index, Then expression index matches the exact function expression in the query | Agents generate computed predicates (e.g., lower(email)) but don’t add matching expression indexes, so queries fall back to sequential scans. | Prevents seq scans on computed expressions; turns expensive filters into index scans. |
| F1d | I can get multicolumn index column ordering guidance based on selectivity and query pattern | P1 | PuP | Given a multicolumn query, When agent creates index, Then most selective column is leading, with explanation of why order matters | Agents choose multicolumn index order arbitrarily. If the leading column doesn’t match the most selective WHERE predicate, PostgreSQL can’t use the index effectively. | Correct column order is the difference between index scan and seq scan for common multicolumn queries. |
| F1e | I can get covering index (INCLUDE) suggestions for index-only scan opportunities | P1 | PuP | Given a query selecting specific columns from an indexed table, When agent optimizes, Then INCLUDE columns suggested to enable index-only scans, with EXPLAIN verification | Agents don’t know about INCLUDE columns, so they create narrow indexes and queries still hit the heap even when an index-only scan is possible. | Enables index-only scans and eliminates heap fetches for frequent read paths. |
| F1f | I can audit existing indexes to identify unused (idxscan = 0) and duplicate indexes | P2 | GA | Given request to optimize indexes, When agent audits, Then pgstatuserindexes queried, unused indexes flagged, estimated write overhead calculated | Agents suggest creating new indexes but rarely audit existing ones. Systems accumulate unused “zombie” indexes that slow writes and bloat storage. | Identifies wasted storage and write overhead; enables safe cleanup (drop/reindex) based on usage signals. |


##### Skill F2: JSONB Patterns & Optimization

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F2a | I can get correct JSONB operator selection (-> for jsonb, ->> for text, @> for containment) with proper type casting in comparisons | P0 | PP | Given a JSONB query, When agent generates WHERE clause, Then ->> used for text comparisons, explicit ::int/::numeric casts for numeric comparisons, no string-to-number implicit comparisons | Agents confuse -> vs ->>, causing type mismatches or string comparisons (e.g., '30' > '100'). They omit required casts for numeric comparisons. | Prevents subtle type-coercion bugs and wrong results in JSONB queries. |
| F2b | I can get GIN index recommendations for JSONB columns with jsonbpathops when only @> is used | P0 | PP | Given JSONB containment queries, When agent creates index, Then USING gin(data jsonbpathops) suggested with note that it's 2-3x smaller than default operator class | Agents create B-tree indexes on JSONB or skip indexing. They don’t know that @> containment needs GIN, and they miss jsonbpathops as the smaller/faster operator class when only @> is used. | Transforms O(n) JSONB scans into indexed lookups; 2–3x smaller/faster GIN for path-only containment. |
| F2c | I can use jsonpath (jsonbpathquery) for complex nested JSONB filtering instead of application-side parsing | P1 | PuP | Given nested JSONB access pattern, When agent generates query, Then jsonbpathquery used with SQL/JSON path syntax instead of nested subqueries | Agents write deeply nested subqueries or push JSON parsing into application code instead of using built-in SQL/JSON path features. | Eliminates application-side JSON parsing and pushes complex filtering into the database engine. |
| F2d | I can get in-place JSONB update patterns using jsonbset() and merge operator (||) instead of full-document replacement | P1 | PuP | Given JSONB field update, When agent generates UPDATE, Then jsonbset() used for targeted field updates, not full-document read-modify-write | Agents default to read-modify-write: fetch full JSON in app, modify, write back. They don’t use jsonbset() or merge for targeted updates. | Prevents expensive read-modify-write on large JSON documents; reduces bandwidth and lock time. |


##### Skill F3: Query Performance Tuning
| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F3a | I can get correct EXPLAIN ANALYZE interpretation: identify the actual bottleneck node, understand loops multiplier, distinguish estimated vs actual rows | P0 | PP | Given EXPLAIN ANALYZE output, When agent diagnoses, Then slowest node identified correctly, loop count factored into actual time, row estimation errors flagged with ANALYZE recommendation | Agents misread EXPLAIN output (cost vs actual), miss that loops multiply work (e.g., loops=1000), and often guess the bottleneck instead of identifying the slowest node. | Correct diagnosis of the real bottleneck (fewer blind indexes/rewrites; faster time-to-fix). |
| F3b | I can get server configuration recommendations for common performance issues: workmem for sorts/hashes, sharedbuffers for cache, effectivecachesize for planner | P0 | PP | Given a slow query, When agent diagnoses, Then configuration checked before suggesting schema changes; sorts spilling to disk get workmem increase recommendation with memory budget context | Agents jump to query rewrites or new indexes and miss configuration knobs. They don’t connect slow sorts/hashes to low work_mem (disk spills), or account for planner hints like effective_cache_size. | Addresses a top root cause of slow queries; tuning (e.g., work_mem) can yield 10–100x gains without schema changes. |
| F3c | I can get anti-pattern detection: SELECT *, NOT IN vs NOT EXISTS, OFFSET pagination vs keyset, implicit type casts | P1 | PuP | Given a query, When agent reviews, Then anti-patterns flagged with fix and performance impact explanation | Agents generate common slow patterns (OFFSET 10000 pagination, SELECT *) and miss semantic gotchas (NOT IN NULL handling). They also introduce implicit casts that prevent index use. | Eliminates high-frequency query anti-patterns that degrade at scale (e.g., deep OFFSET) and prevents hidden index-miss bugs. |
| F3d | I can verify statistics freshness and trigger ANALYZE when stale stats cause wrong plan choices | P1 | PuP | Given a slow query with row estimation errors, When agent diagnoses, Then pgstats checked for stale data, ANALYZE recommended with scope (table-level vs database-level) | Agents suggest indexes without checking whether the planner is using existing stats correctly. They miss stale statistics as the root cause of bad plans (nested loop vs hash join, wrong row estimates). | Fixes wrong plan choices without schema/query changes; reduces wasted work from unnecessary indexes and rewrites. |



##### Skill F4: Table Partitioning

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F4a | I can get partitioning recommendations for large tables with correct strategy selection (RANGE for time-series, LIST for multi-tenant, HASH for even distribution) | P0 | PP | Given table size and query patterns, When agent suggests partitioning, Then correct strategy recommended, partition key matches primary query filter, child partition creation included | Agents rarely suggest partitioning when it matters (100M+ rows) and when they do, they default to RANGE for everything, missing LIST for multi-tenant and HASH for even distribution. | Prevents both over-partitioning (unnecessary complexity) and under-partitioning (slow queries on huge tables). |
| F4b | I can get complete partition setup including child partitions and default partition for unmatched values | P0 | PP | Given partition decision, When agent generates DDL, Then parent table, child partitions, default partition, and indexes all created; insert test verifies routing | Agents create a partitioned parent table but forget to create child partitions (and often miss default partitions), causing inserts to fail with “no partition of relation found.” They also don’t know automation tools like pgpartman. | Eliminates “no partition found” runtime errors and manual partition maintenance. |
| F4c | I can get partition pruning verification: queries must include partition key in WHERE to benefit from partitioning | P1 | PuP | Given partitioned table query, When agent reviews, Then EXPLAIN checked for "Partitions removed: N" confirming pruning; warning if partition key missing from WHERE | Agents write queries that omit the partition key, forcing scans across all partitions. They also don’t verify pruning via EXPLAIN (“Partitions removed: N”). | Ensures partitioning actually improves performance; correct pruning can be ~100x faster for time-partitioned workloads. |
| F4d | I can get partition maintenance automation with pgpartman for time-based partition creation and retention | P2 | GA | Given time-partitioned table, When agent configures maintenance, Then pgpartman setup with retention policy, automatic creation of future partitions | Agents don’t know pgpartman or detach/drop retention workflows, so partitions aren’t created ahead of time and retention becomes manual (error-prone). | Reduces operational toil and prevents ingestion failures; enables clean retention (detach+drop) without manual babysitting. |


##### Skill F5: Row-Level Security (RLS)

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F5a | I can set up complete RLS for multi-tenancy including ENABLE, CREATE POLICY, and FORCE ROW LEVEL SECURITY (for table owners) | P0 | PP | Given multi-tenant requirement, When agent configures RLS, Then all three steps completed, FORCE included with explanation of why table owners bypass RLS without it | Agents enable RLS but forget FORCE ROW LEVEL SECURITY. Table owners bypass RLS by default, creating a silent security hole. | Prevents a common, critical RLS security bypass that agents introduce. |
| F5b | I can get correct policy patterns for different operations (SELECT, INSERT, UPDATE, DELETE) with USING and WITH CHECK clauses | P0 | PP | Given RLS setup, When agent creates policies, Then separate policies for read vs write, WITH CHECK prevents tenantid modification in UPDATE | Agents generate one “catch-all” policy. They miss that INSERT/UPDATE need WITH CHECK to prevent tenant spoofing and that different operations require different predicates. | Complete multi-tenant isolation (read + write) instead of partial policies that still allow data corruption/leakage. |
| F5c | I can integrate RLS with connection pooling using session variables (SET app.tenantid) with proper reset on connection return | P1 | PuP | Given pooled connections, When agent configures RLS, Then SET app.tenantid at checkout, RESET ALL at return, with warning about state leakage without reset | Agents omit pool integration details (set/reset session variables). Without resetting on pool return, tenant context can leak between requests on reused connections. | Prevents critical cross-tenant data leakage in pooled environments. |
| F5d | I can verify RLS performance: policy column indexed, EXPLAIN shows index scan on policy predicate | P1 | PuP | Given RLS-enabled table, When agent verifies performance, Then index on policy column confirmed, EXPLAIN shows predicate uses index | Agents enable RLS without considering that policy predicates run on every query. They forget to index the policy column (e.g., tenantid), causing sequential scans and large performance regressions. | Keeps RLS from degrading performance; enables indexed enforcement (security without turning every query into a full scan). |


##### Skill F6: Full-Text Search

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F6a | I can set up full-text search with tsvector + GIN index instead of LIKE/ILIKE patterns | P0 | PP | Given text search requirement, When agent generates search, Then tsvector generated column with GIN index, totsquery for search, tsrank for ordering; ILIKE not used | Agents default to LIKE '%term%' / ILIKE, missing PostgreSQL FTS primitives (tsvector/tsquery) and GIN indexing, so searches stay O(n) and unranked. | ~100x faster text search with relevance ranking (search-engine behavior inside Postgres). |
| F6b | I can use phrase search and proximity operators for multi-word queries | P1 | PuP | Given phrase search need, When agent generates query, Then <-> for adjacent words, <N> for proximity, not separate term matches | Agents don’t know PostgreSQL’s phrase/proximity operators and instead split into independent term matches, creating many false positives for multi-word queries. | Enables search-engine quality phrase matching natively (better precision with no app-side filtering). |
| F6c | I can configure weighted search across multiple columns (title weight A, body weight D) | P1 | PuP | Given multi-field search, When agent configures, Then setweight() applied, title matches rank higher than body matches | Agents treat all text fields equally and omit weighting via setweight(), so results are poorly ranked (title matches don’t rise to the top). | More relevant results without application-side re-ranking; improves UX with better ordering. |
| F6d | I can configure multilingual full-text search with appropriate language dictionaries and unaccent extension | P2 | GA | Given non-English content, When agent configures FTS, Then correct language config used, unaccent extension enabled for accent-insensitive search | Agents default to English stemming for all content and skip extensions like unaccent, leading to poor results for non-English or accent-heavy text. | Correct multilingual search behavior (language-aware stemming + accent-insensitive search) without app-side workarounds. |


##### Skill F7: Connection Management & Pooling

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F7a | I can get connection pooling setup recommendations (PgBouncer transaction mode vs session mode) instead of connection-per-request patterns | P0 | PP | Given application architecture, When agent configures connections, Then PgBouncer recommended for multi-instance apps, transaction mode for stateless, session mode if prepared statements used; connection-per-request flagged as anti-pattern | Agents generate “open a new connection per request” and don’t understand PostgreSQL’s process-based connection model (each connection is a backend process with memory cost). They also conflate app-level pools with shared poolers like PgBouncer. | Prevents the #1 production outage cause: connection exhaustion; enables high throughput without app code changes via PgBouncer. |
| F7b | I can diagnose and fix "too many connections" errors with pgstatactivity analysis and idle connection cleanup | P0 | PP | Given connection limit error, When agent diagnoses, Then pgstatactivity queried, idle connections identified, idleintransactionsessiontimeout recommended, pgterminatebackend() used for cleanup | Agents don’t warn about maxconnections limits (default ~100) or the resource impact per connection. They also skip idle cleanup and timeouts, letting abandoned transactions and idle sessions accumulate. | Faster incident recovery and prevention (timeouts + cleanup) for the most common PostgreSQL production failure mode. |
| F7c | I can get connection string best practices: sslmode=require, connecttimeout, applicationname, options for schema isolation | P1 | PuP | Given connection setup, When agent generates connection string, Then sslmode=require included, applicationname set, connecttimeout specified | Agents generate minimal connection strings and omit critical flags like connecttimeout and applicationname, making debugging hard and failures slow. They also forget best-practice SSL defaults. | More resilient connections (fail fast) and faster debugging/observability via consistent application naming and safe defaults. |
| F7d | I can configure connection lifecycle management: DISCARD ALL on pool return, statementtimeout, idleintransactionsessiontimeout | P1 | PuP | Given pooled connections, When agent configures lifecycle, Then pool return cleanup configured, timeout values set based on workload | Agents open connections but don’t clean up session state (temp tables, SET variables, locks) or configure timeouts. Without DISCARD ALL / reset and timeouts, pools leak state and abandoned transactions can block autovacuum. | Prevents state leakage and lock contention; reduces outages from idle-in-transaction sessions and runaway queries. |


##### Skill F8: Logical Replication & CDC

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| F8a | I can choose the correct replication type: physical vs logical based on use case (cross-version, selective tables, schema differences) | P0 | PP | Given replication goal, When agent recommends approach, Then physical used for full-cluster same-version replicas, logical used for selective tables/cross-version/different schema | Agents confuse physical and logical replication and recommend physical streaming replication for cross-version migration or selective table sync (which doesn’t work). | Correct replication strategy selection; avoids dead-end implementations and failed migrations. |
| F8b | I can generate working logical replication setup with PUBLICATION/SUBSCRIPTION and prerequisites (wallevel=logical) | P0 | PP | Given publisher/subscriber, When agent sets up, Then CREATE PUBLICATION/CREATE SUBSCRIPTION provided, wallevel prerequisite called out, verification queries included | Agents either output physical replication configs or omit prerequisites like wallevel = logical, causing subscription creation to fail or silently not replicate. | Working logical replication setup on first try (fewer “it doesn’t replicate” incidents). |
| F8c | I can recommend logical decoding / CDC patterns using pgoutput and replication slots instead of polling | P1 | PuP | Given CDC requirement, When agent recommends approach, Then logical decoding with pgoutput + slot consumption suggested, polling-based CDC rejected with explanation | Agents suggest polling CDC (querying for rows since lastcheck) instead of logical decoding. They don’t know pgoutput/slots, which provide real-time, guaranteed-delivery change streams. | Real-time CDC without polling overhead or missed changes; aligns with Debezium/Airbyte/Kafka Connect patterns. |
| F8d | I can monitor and manage replication slots (inactive slots, WAL retention, lag) to prevent disk-full outages | P1 | PuP | Given logical replication, When agent provides ops guidance, Then pgreplicationslots and lag monitoring included, inactive slot risk explained, remediation steps provided | Agents create replication slots but never monitor them. Inactive slots retain WAL indefinitely and can fill disk quickly on write-heavy systems. | Prevents disk-full outages from unmonitored slots; improves reliability of CDC/replication pipelines. |

#### 
#### Core Database Operations (Skills 1–7)
##### Skill 1: Getting Started — Extension Lifecycle, Server Parameters, First Connection

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 0a | I can get the correct two-gate extension setup (allowlist via portal/CLI + shared_preload_libraries for extensions that need it) instead of hitting "permission denied" or "access to library not allowed" | P0 | PP | Given any extension setup, When agent configures extension, Then allowlist step performed first, shared_preload_libraries added if needed (age, pg_cron, pgaudit, auto_explain, pg_partman_bgw), restart warned, and CREATE EXTENSION uses correct binary name (vector not pgvector) | Agents conflate allowlist and shared_preload_libraries or skip one entirely. Generate CREATE EXTENSION directly — fails with "permission denied" on Azure. | Eliminates the most confusing Azure-specific extension failure mode. Saves 15–30 min per developer's first extension setup. |
| 0b | I can get correct extension naming (CREATE EXTENSION vector not CREATE EXTENSION pgvector) and version management (ALTER EXTENSION vector UPDATE) | P0 | PP | Given extension install, When agent generates CREATE EXTENSION, Then correct binary name used, version check provided (SELECT * FROM pg_available_extensions), and upgrade path shown | Agents write CREATE EXTENSION pgvector — gets "extension does not exist". Marketing name differs from binary name. | Saves the "extension does not exist" error loop. Prevents running on stale extension versions. |
| 0c | I can get extension-specific post-install configuration (azure_ai endpoint binding, age session LOAD, vector index type selection) instead of "extension installed but not working" | P0 | PP | Given extension created, When agent completes setup, Then extension-specific config applied: azure_ai gets endpoint + key binding, age gets LOAD 'age' or search_path, vector gets DiskANN vs HNSW guidance | Each extension has unique post-CREATE setup that agents skip or get wrong. azure_ai — agents don't know it exists. age — agents omit session LOAD step. | One lifecycle flow per extension prevents the "extension installed but not working" gap. |
| 0d | I can change server parameters using portal/CLI (not ALTER SYSTEM SET which fails on managed PostgreSQL) and know which changes require a restart | P0 | PP | Given parameter change needed, When agent generates parameter command, Then az postgres flexible-server parameter set used; static params (shared_preload_libraries, max_connections, wal_level) flagged with restart warning | Agents generate ALTER SYSTEM SET shared_preload_libraries = ... — fails with permission denied on managed PostgreSQL. They also don't warn which parameter changes will trigger a restart. | Prevents "permission denied" errors and unplanned restarts from parameter changes. |
| 0e | I can verify my complete setup with a smoke-test sequence (connect → \dx → test operation per extension → SHOW shared_preload_libraries) | P0 | PP | Given setup completed, When agent runs verification, Then 5-line verification script checks connectivity, extensions loaded, functions callable, and parameters applied | Agents don't provide a "did it all work?" check. Developers assume setup is done after CREATE EXTENSION without verifying. | 5-line verification script catches setup gaps before they become debugging sessions. |


##### Skill 2: Provisioning — IaC, CLI, SKU Selection

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | I can provision a new Azure PostgreSQL Flexible Server with correct SKU tier selection (Burstable vs GP vs MemOpt) based on workload heuristics | P0 | PP | Given workload description, When agent provisions server, Then correct tier recommended (Burstable for idle/dev, GP for production, MemOpt for analytics), valid SKU name used (Standard_B1ms, Standard_D4ds_v5), not invented names | Agents invent SKU names or use outdated ones. Burstable compute heuristic not applied. | Prevents over-provisioning (wrong tier costs 3–10x more) or under-provisioning. |
| 1a | I can generate valid Terraform/Bicep templates using current resource type (Microsoft.DBforPostgreSQL/flexibleServers) and API version, not deprecated Single Server types | P0 | PP | Given IaC request, When agent generates template, Then current API version used (2026-01-01-preview), Single Server types rejected with deprecation warning (retired March 2025), required fields included | Agents generate outdated API versions, use deprecated Single Server resource types (retired March 2025), or miss required fields. | Prevents deployment failures from invalid ARM/Terraform templates. |
| 1b | I can provision with correct storage configuration understanding that storage cannot be scaled down, and Premium SSD v2 IOPS/throughput are independently scalable | P0 | PP | Given storage config, When agent provisions, Then one-way-up constraint warned, autogrow behavior explained, Premium SSD v2 independent scaling offered for high-performance workloads | Agents don't know storage is one-way-up on Azure. Developers over-provision without realizing they can't reduce it later. | Prevents irreversible cost mistakes. Enables Premium SSD v2 independent IOPS/throughput scaling. |
| 1c | I can use az postgres flexible-server create with current CLI parameters including --zonal-resiliency and post-training-data flags | P0 | PP | Given CLI provisioning, When agent generates command, Then current parameter names used, new flags like --zonal-resiliency included where appropriate | New CLI parameters like --zonal-resiliency are post-training-data. Agents generate outdated CLI flags. | Prevents CLI provisioning failures from wrong parameters. |


##### Skill 3: HA and Disaster Recovery

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | I can configure HA correctly (zone-redundant vs same-zone with explicit highAvailability.mode) instead of generic "enable HA" | P0 | PP | Given HA request, When agent configures, Then explicit mode specified, standby zone configured, failover behavior explained | Agents generate generic "enable HA" without specifying mode. Azure requires explicit ZoneRedundant or SameZone. | Correct DR posture from day one instead of discovering gaps during an outage. |
| 2a | I can restore to a point in time understanding that PITR creates a *new* server (not in-place restore) and plan for connection string changes | P0 | PP | Given restore request, When agent runs PITR, Then new server creation explained, connection string migration guidance provided, retention window (7-35 days) and geo-restore limitations documented | Agents suggest "restore the database" as if it's in-place. PITR creates a new server — developers don't plan for connection string changes. | Prevents botched recovery procedures during actual incidents. |
| 2b | I can use read replicas with virtual endpoints for zero-downtime failover instead of hardcoded server hostnames that break on failover | P0 | PP | Given replica setup, When agent configures read replica, Then virtual endpoint DNS used, promote-to-primary workflow provided, direct hostname references flagged as anti-pattern | Agents don't know about Azure's virtual endpoint abstraction — generate direct server hostnames that break on failover. | Eliminates hardcoded connection strings that break during regional failover. |
| 2c | I can configure geo-redundant backups understanding the up-to-1-hour RPO to paired region and compute constraints during geo-restore | P0 | PP | Given DR planning, When agent configures geo-redundancy, Then RPO/RTO expectations set correctly, geo-restore compute limitations documented | Agents assume geo-restore is instant with full flexibility. In reality, up to 1-hour delay and compute configs are locked. | Sets correct RTO/RPO expectations — prevents surprises during DR exercises. |


##### Skill 4: Auth and Connectivity

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | I can connect using Entra ID passwordless auth with managed identity (Python: azure-identity + psycopg2, Node: @azure/identity + pg) instead of hardcoded password connection strings | P0 | PP | Given production deployment, When agent generates connection code, Then managed identity token flow used, no stored credentials, correct library patterns per language | Agents generate postgres://user:password@host/db every time. Azure production pattern is token-based with managed identity. | Shifts from password-based to zero-credential auth — security compliance requirement for most enterprises. |
| 3a | I can configure SSL correctly (Azure requires SSL by default) with per-language certificate trust configuration instead of failing with "SSL connection is required" | P0 | PP | Given first connection, When agent generates connection, Then SSL enforced, certificate download and trust configured for the developer's language | Agents generate plaintext connections. First connection fails with "SSL connection is required." | Prevents the most common "why can't I connect" error after provisioning. |
| 3b | I can choose the correct networking architecture (private endpoint vs VNet integration vs public access) with correct DNS configuration and connection string differences | P0 | PP | Given networking decision, When agent advises, Then decision tree provided based on workload (enterprise → private endpoint, dev → public + firewall), DNS zone config included | Agents always generate public endpoint connection strings. Enterprise workloads require private endpoints with private DNS zones. | Correct networking architecture from the start — retrofitting private endpoints is painful. |
| 3c | I can work within the azure_pg_admin role model (no superuser on managed PostgreSQL) and use reserved connections from pg_use_reserved_connections pool | P0 | PP | Given privilege escalation attempt, When agent generates ALTER ROLE ... SUPERUSER, Then error prevented, azure_pg_admin capabilities explained, reserved connection pool documented | Agents generate ALTER ROLE ... SUPERUSER — fails on Azure. Don't know about azure_pg_admin capabilities or reserved connections. | Prevents confusion about privilege model on managed PostgreSQL. |


##### Skill 5: Operations — Monitoring, Tuning, Upgrades

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | I can enable intelligent tuning (auto-index recommendations, auto-vacuum tuning) instead of manual CREATE INDEX and manual vacuum settings | P0 | PP | Given performance optimization request, When agent advises, Then intelligent tuning enabled via server parameters, Azure-managed recommendations surfaced before manual approach suggested | Agents suggest manual CREATE INDEX and vacuum tuning. Azure has automated recommendations that agents don't know exist. | Automated performance improvement with zero manual effort. |
| 4a | I can enable Query Store (pg_qs.query_capture_mode) and use Query Performance Insight instead of manually setting up pg_stat_statements | P0 | PP | Given slow query investigation, When agent suggests monitoring, Then built-in Query Store recommended over manual pg_stat_statements, portal dashboard link provided | Agents suggest pg_stat_statements setup manually. Azure has built-in Query Store feeding portal-integrated dashboards. | Better observability with less setup — managed approach over manual. |
| 4b | I can perform in-place major version upgrade instead of pg_dump/pg_restore migration, with pre-flight extension compatibility check | P0 | PP | Given version upgrade needed, When agent advises, Then in-place MVU workflow provided with extension compatibility check, not the manual dump/restore path | Agents suggest pg_dump/pg_restore for version upgrades. Azure supports in-place MVU with pre-flight validation. | Saves hours of migration work and downtime — agents suggest the hardest path. |
| 4c | I can use built-in Grafana dashboards and enhanced metrics instead of setting up external monitoring from scratch | P0 | PP | Given monitoring request, When agent suggests observability, Then built-in Grafana (no added cost) and diagnostic settings recommended before third-party tools | Azure portal includes built-in Grafana dashboards at no added cost. Agents suggest external Grafana or Datadog setup. | Eliminates unnecessary third-party monitoring setup. |
| 4d | I can set a custom maintenance window to control when Azure applies patches, avoiding surprise restarts during business hours | P0 | PP | Given operational setup, When agent configures server, Then custom maintenance window setting included, default behavior (Azure-chosen) explained | Agents don't mention maintenance windows — developers get surprised by unexpected restarts during business hours. | Prevents unplanned maintenance disruptions. |


##### Skill 6: Fleet Management
| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | Inventory all Azure PostgreSQL Flexible Servers across multiple subscriptions and resource groups, returning a normalized fleet table and highlighting outliers. | P1 | PuP | Output includes at minimum: name, subscription, resource group, region, version, SKU/tier, HA, storage. Produces an outlier list (version drift, missing HA, non-compliant settings) and is not limited to a single subscription. | Agents scope to a single resource group. Don't iterate across subscriptions or provide fleet-wide inventory. | Single-command fleet view instead of clicking through portal per resource group. |
| 5a | Mirror server parameters from a source server to one or more target servers (export → diff → apply), explicitly flagging restart-requiring vs dynamic parameters. | P1 | PuP | Provides a repeatable multi-step command sequence that exports parameters, diffs source vs target, applies only deltas, and identifies which changes require a server restart vs immediate effect. | Mirroring parameters requires jq + Azure CLI pipeline — agents don't generate this. Suggest editing one at a time. | Reduces configuration drift resolution from hours of manual comparison to a single agent conversation. |
| 5b | Coordinate a major version upgrade campaign across a fleet with extension compatibility pre-checks, rollout sequencing (dev → staging → prod), and rollback plan. | P1 | PuP | Generates: (1) per-server preflight compatibility checks, (2) ordered plan across environments, (3) per-server upgrade commands, (4) validation gates, and (5) rollback steps with stop conditions. | Agents suggest single-server upgrade. Don't sequence across environments or check extension compatibility first. | Turns a multi-day, multi-server upgrade campaign into a guided agent workflow. |
| 5c | Manage Elastic Clusters as a fleet: generate Terraform patterns for provisioning/scaling cluster size and explain firewall rule inheritance behaviors. | P1 | PuP | Provides Terraform snippet patterns for create/scale (node count) and documents inherited firewall behavior for new nodes; includes operator notes for safe scaling. | Agents don't know about Elastic Clusters. Suggest manual firewall configuration per node. | Enables horizontal scaling management across sharded PostgreSQL deployments. |
| 5d | Run a fleet-wide cost optimization scan to identify over-provisioned Burstable servers, idle replicas, oversized storage that cannot be reclaimed, and missing HA. | P1 | PuP | Outputs prioritized recommendations per server and a summary of savings opportunities; identifies fleet-wide patterns (e.g., Burstable drift, idle replicas) not visible in single-server tuning. | Agents optimize single-server configurations. Don't provide fleet-wide cost analysis or identify patterns. | Surfaces cost savings opportunities invisible at the individual server level. |
| 5e | Perform a fleet-wide compliance and security audit (SSL, Entra ID, private endpoints, extension allowlists, maintenance windows) and output remediation for each outlier. | P1 | PuP | Produces pass/fail by server for the listed controls and includes explicit remediation steps for each failing server/setting; report is generated across the full fleet. | Agents check one server at a time. Fleet compliance requires iterating across all servers and flagging outliers. | Replaces manual Azure Policy audits with conversational fleet-wide compliance checks. |
| 5f | Set up or recommend scheduled start/stop automation at scale for dev/test fleets using Task Automation / Logic Apps, including guardrails to avoid production. | P1 | PuP | Defines schedule + inclusion/exclusion criteria (or tagging strategy) and documents permissions and operational caveats; explicitly prevents stopping production servers. | Agents suggest manual az postgres flexible-server stop — don't know about built-in task automation for scheduling. | Eliminates unnecessary compute costs for dev/test servers outside business hours. |
| 5g | Generate SDK usage guidance that avoids deprecated libraries and uses the correct current Flexible Server SDK packages and API versions for Go, Java, JavaScript, .NET, and Python. | P1 | PuP | Provides correct package/import names for each language and flags deprecated libraries; examples align to current Flexible Server SDKs and do not reference deprecated packages. | Agents generate code using deprecated libraries (e.g., azure-mgmt-rdbms) instead of current Flexible Server SDK packages. | Prevents importing deprecated libraries that will eventually break. |



##### Skill 7: Migration

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | I can use Azure Migration Service for online/offline migration instead of manual pg_dump/pg_restore for every scenario | P1 | PP | Given migration request, When agent advises migration strategy, Then managed migration service recommended with online vs offline decision tree, not default to pg_dump | Agents suggest pg_dump/pg_restore for every migration. Azure has managed migration service with online migration support. | Reduces migration from hours/days of manual work to a managed workflow. |
| 6a | I can handle collation mismatches (Flexible Server uses en_US.utf8) and know to rebuild indexes after migration | P1 | PP | Given post-migration, When agent verifies migration, Then collation check performed, index rebuild recommended if mismatch detected | Agents don't warn about collation differences. Post-migration, queries return wrong sort order or indexes silently degrade. | Prevents subtle data ordering bugs that surface weeks post-migration. |
| 6b | I can import/export Parquet format via Azure Storage extension instead of CSV-based bulk loading | P1 | PP | Given bulk data load, When agent generates import, Then Parquet via Azure Storage extension offered (10x faster) alongside CSV fallback | Azure Storage extension now supports Parquet format. Agents suggest CSV-based bulk loading. | 10x faster data loading for analytics workloads. |


##### Cross-cutting

| ID | Requirement | Pri | Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | I can execute SQL queries and get results directly in my agent | P0 | PP | Given connected database, When agent runs execute_sql, Then query results returned in structured format | Platform capability — agents need MCP server integration to execute SQL directly. | Enables direct database interaction from within the agent workflow. |
| 6a | I can get a recommended connection method and driver based on my runtime (serverless, long-running, edge, container) | P0 | PP | Given project context (language, framework, runtime), When agent runs recommend_connection_method, Then correct driver and transport returned with install command and sample code | Agents don't consider runtime context (serverless, container, edge) when recommending drivers. | Right driver and transport for each deployment context. |
| 6g | I can manage my server using Azure CLI commands generated by the agent (not outdated flags or Single Server commands) | P0 | PP | Given Azure CLI installed, When agent generates az postgres flexible-server commands, Then current CLI syntax with valid parameters for the user's context, executable via terminal | Agents generate outdated CLI syntax or Single Server commands. New parameters are post-training-data. | Current CLI syntax with valid parameters, executable without modification. |
| 6j | Destructive operations (DROP, TRUNCATE, DELETE without WHERE) require explicit user confirmation | P0 | PP | Given destructive SQL detected, When agent attempts execution, Then user prompted for confirmation before proceeding | Agents may execute DROP/TRUNCATE without safeguards if not explicitly instructed to confirm. | Prevents accidental data loss from destructive operations. |


***Milestone key:** PP = Private Preview, PuP = Public Preview, GA = General Availability*
#### Skills: RAG on Azure PostgreSQL (ROI — highest developer volume, highest agent error rate)
*The most common developer workflow on Azure PostgreSQL. Agents make the most Azure-specific mistakes here: wrong extension setup, app-side embeddings instead of in-database, HNSW instead of DiskANN, vector-only retrieval instead of hybrid search. Skills 7-10 cover embeddings, vector indexing, hybrid search, and end-to-end pipeline.*

| ID | Requirement | Priority | Release Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 7 | I can set up pgvector with DiskANN indexes instead of defaulting to HNSW, because DiskANN is 10x faster with 4x cost savings on Azure and supports 16K dimensions | P0 | PP | Given pgvector-enabled database, When agent advises on vector indexing, Then DiskANN recommended with correct CREATE INDEX ... USING diskann(...) syntax; decision tree provided for when HNSW is preferred | Every agent generates HNSW by default. No agent knows DiskANN exists on Azure. At production scale, HNSW costs 4x more. | Prevents 4x cost overrun at production scale. DiskANN uses disk-backed SSD with fraction of HNSW memory. |
| 7a | I can get the correct extension allowlisting workflow (portal/CLI allowlist -> CREATE EXTENSION -> verify with SHOW azure.extensions) instead of hitting "permission denied" | P0 | PP | Given new Azure PostgreSQL server, When developer needs pgvector/azure_ai/age, Then agent guides through allowlist step first, uses CREATE EXTENSION vector (not pgvector), and verifies | Agents skip Azure allowlisting gate entirely. Generate CREATE EXTENSION directly — fails with "permission denied." | Unblocks the entire RAG workflow — without allowlisting, zero extensions install. |
| 7b | I can configure DiskANN Product Quantization for cost optimization on large vector datasets (100M+ rows) | P0 | PP | Given large vector table, When agent generates index, Then PQ-based DiskANN config provided with correct lists and quantizer parameters for the dataset size | Agents don't know PQ exists for DiskANN. Even developers who find DiskANN may miss the PQ option for cost optimization. | 4-8x memory savings on large vector datasets — difference between 64GB and 16GB server. |
| 7c | I can use DiskANN filtered search (3x faster filtered traversals) instead of post-filter on HNSW results | P0 | PP | Given DiskANN index + metadata columns, When agent generates filtered vector search, Then DiskANN's native filtered traversal used instead of post-filtering pattern | Agents generate two-phase search: filter then vector, or vector then filter. DiskANN does both simultaneously. | 3x faster filtered search — the most common RAG pattern (filter by tenant/category + vector similarity). |
| 8 | I can generate embeddings using azure_openai.create_embeddings() in SQL instead of app-side OpenAI API round-trips | P0 | PP | Given azure_ai extension configured, When agent generates embedding code, Then in-database SQL pattern used (SELECT azure_openai.create_embeddings(...)) instead of Python/Node API calls | Every agent generates app-side embedding code: call OpenAI API from Python/Node, INSERT result. In-database function eliminates entire layer. | Eliminates entire application layer. In-database embeddings reduce pipeline from ~50 lines Python to one SQL statement. |
| 8-ii | I can batch-embed existing text columns into vector columns using in-database SQL UPDATE instead of writing a Python ETL script | P0 | PP | Given table with text data, When agent generates bulk embedding, Then UPDATE ... SET embedding = azure_openai.create_embeddings(...) pattern used with batch size guidance | Agents generate per-row INSERT loops (app-side pattern carry-over). In-database batch pattern is a single SQL statement. | 10-100x throughput improvement for initial data ingestion. |
| 9 | I can run semantic similarity search using DiskANN-indexed vectors with correct pgvector distance operators (<=>, <->, <#>) | P0 | PP | Given DiskANN-indexed table, When agent generates search query, Then correct cosine/L2/inner-product operators used with proper ORDER BY and LIMIT | Agents use only cosine distance operator. Don't know correct DiskANN query patterns or when to use L2 vs inner product. | Enables optimal index type (DiskANN) that agents cannot suggest. |
| 11 | I can set up a complete RAG pipeline end-to-end (allowlist extensions -> configure azure_ai -> create embeddings table -> DiskANN index -> retrieval query) via guided skill | P0 | PP | Given empty database, When agent runs RAG setup, Then full Azure-specific pipeline configured with in-database embeddings, DiskANN, and retrieval patterns | Agents build Python/Node orchestration layers with 3-4 external service calls. In-database pipeline is a single SQL function. | Eliminates 3-4 external service calls and orchestration code connecting them. |
| 12 | I can run hybrid search combining vector similarity (DiskANN) + full-text search (tsvector) + SQL WHERE filters instead of vector-only retrieval | P0 | PP | Given RAG-enabled database, When agent generates search, Then RRF-fused results returned combining vector distance, text relevance, and metadata filters | Agents use only ORDER BY embedding <=> query_vector. Ignore full-text relevance and metadata filters entirely. | Relevant retrieval vs numerically-close-but-wrong — the difference between useful and frustrating RAG app. |
| 12-ii | I can set up Reciprocal Rank Fusion (RRF) scoring to merge DiskANN vector results with tsvector BM25 results | P0 | PP | Given vector + text search results, When agent generates fusion, Then correct RRF formula applied in SQL with tunable k parameter | No agent generates RRF for PostgreSQL. They suggest complex app-side re-ranking. In-database RRF is a single SQL query. | Eliminates application-side re-ranking code. Better retrieval quality from a single SQL query. |


#### Skills: Azure AI Extension (ROI — most differentiated feature, 100% agent failure without skill)
*No agent can generate correct `azure_ai` extension usage. The in-database LLM invocation pattern does not exist in training data at sufficient volume. Every agent defaults to app-side API calls. Skills 11-12 cover setup and invocation.*


| ID | Requirement | Priority | Release Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 8a | I can configure the azure_ai extension endpoint, API key binding, and model deployment mapping instead of the agent saying "I don't know this extension" | P0 | PP | Given Azure AI endpoint, When agent sets up azure_ai, Then correct endpoint binding (azure_ai.set_setting()), API key config, and model deployment mapping configured with working SQL examples | Agents don't know the azure_ai extension exists. Never generate prerequisite config step. Developer gets "endpoint not configured" error. | Unblocks in-database AI entirely — without this config, zero azure_ai functions work. |
| 8a-ii | I can configure Managed Identity auth for azure_ai instead of hardcoded API keys, so my production workload passes security review | P0 | PP | Given system-assigned managed identity, When agent configures azure_ai, Then azure_ai.set_setting('azure_openai.subscription_key', 'MANAGED_IDENTITY') used instead of raw API key | Agents always use API keys. Production workloads should use managed identity — no agent suggests this pattern. | Production-grade security from day one instead of hardcoded API keys. |
| 8a-iv | I can check and update the azure_ai extension version to access newer functions like generate() | P0 | PP | Given azure_ai installed, When agent checks version, Then azure_ai.version() called, upgrade path shown if outdated | Agents don't mention version checking. Developer may be on older version lacking needed functions (e.g., generate()). | Prevents "function does not exist" errors caused by running older extension version. |
| 8b | I can chain azure_ai operations in a single SQL query (embed + classify + store) instead of multi-step Python pipelines with intermediate storage | P0 | PP | Given azure_ai configured, When agent generates ingestion pipeline, Then single INSERT...SELECT chains create_embeddings() + analyze_sentiment() + detect_language() in one statement | No agent generates multi-function chaining in SQL. They build multi-step Python pipelines with intermediate storage. | Replaces a 100-line Python ingestion pipeline with a single SQL INSERT...SELECT. |


#### Skills: AI Functions (ROI — in preview, agents produce zero correct output)
*Brand-new SQL functions (`extract()`, `rank()`, `is_true()`, `generate()`) that did not exist in any training data. Agents either refuse, hallucinate wrong syntax, or confuse with PostgreSQL's built-in `extract()` for date/time. Skill 13 covers all operator scenarios.*

| ID | Requirement | Priority | Release Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | I can use AI functions (generate(), extract(), rank(), is_true()) with correct syntax, disambiguated from PostgreSQL's built-in extract() for date/time | P0 | PP | Given azure_ai extension, When agent invokes semantic operators, Then correct Azure-specific function signatures used with model endpoint config, not PostgreSQL date extraction | Agents confuse Azure's extract() with PostgreSQL's EXTRACT(YEAR FROM...). Generate regex/string-splitting instead of semantic operators. | Replaces fragile regex/NLP extraction pipelines with a single SQL function call. |
| 10a | I can chain AI functions (extract() output -> AGE graph -> rank() for retrieval) with correct parameter types and model configuration | P0 | PP | Given semantic operators + AGE, When agent generates multi-step pipeline, Then correct operator chaining with working examples and Azure AI model config | No agent has seen chaining patterns for these operators. They treat each as standalone. Real power is composing them. | Enables multi-step semantic data processing entirely in SQL. |
| 10b | I can use generate() for in-database text generation (summarization, Q&A) with correct model binding and token limit configuration | P0 | PP | Given azure_ai configured with a generative model, When agent generates summarization SQL, Then azure_ai.generate() used with correct model reference, max_tokens, and temperature parameters | Agents generate app-side generation loops: fetch rows, call LLM per row, write back. SQL operator processes entire table without data movement. | Eliminates the fetch-generate-writeback loop for per-row text generation. |
| 10c | I can use is_true() for in-database boolean classification (spam detection, content moderation) without building a separate ML pipeline | P0 | PP | Given azure_ai configured, When agent generates classification logic, Then azure_ai.is_true() used inline in WHERE/CASE with correct prompt and model binding | Agents generate keyword-based filtering or app-side LLM classification loops instead of native SQL WHERE predicate. | Semantic filtering as a native SQL WHERE predicate. |
| 10d | I can use rank() to re-rank search results by semantic relevance within SQL instead of building application-side reranking | P0 | PP | Given initial retrieval set, When agent generates reranking, Then azure_ai.rank() used in ORDER BY with correct query/document parameter signatures | No agent generates in-database semantic re-ranking. They suggest app-side LLM re-ranking or vector similarity only. | In-database semantic re-ranking without exporting data to an application layer. |
| 10e | I can combine AI functions with DiskANN vector search for a complete retrieve-then-rerank pipeline in a single SQL query | P0 | PP | Given DiskANN index + azure_ai, When agent generates retrieval + reranking, Then CTE chains vector search -> rank() reranking in one statement | No agent chains vector search with semantic re-ranking in SQL. They build multi-service architectures for what's a single CTE query. | CTE chains vector search → rank() reranking in one statement. |


#### Skills: Connection, Auth & Operations (ROI — constant developer friction)
*Not glamorous, but agents get Azure-specific connection and operations patterns wrong every time. Password-based instead of passwordless, app-side pooling instead of built-in PgBouncer, manual indexes instead of intelligent tuning. Skills 14-16 cover auth-connectivity, connection-pooling, and operations.*

| ID | Requirement | Priority | Release Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 6l | I can get correct Entra ID passwordless auth patterns per language (Node.js: @azure/identity + pg; Python: azure-identity + psycopg2) instead of password-based connection strings | P0 | PP | Given production deployment, When agent generates connection code, Then managed identity token-based pattern used, not postgres://user:password@host/db | Agents generate postgres://user:password@host/db. Azure production uses managed identity token-based auth. | Production-grade auth from day one. Eliminates password rotation burden and security review failures. |
| 6l-ii | I can get correct Managed Identity token acquisition and refresh patterns, because the token expires and agents generate one-shot code without refresh logic | P0 | PP | Given MI-based auth, When agent generates connection code, Then includes DefaultAzureCredential with get_token() call and token refresh handling (tokens expire in ~1h) | Agents generate one-shot token code without refresh logic. Tokens expire in ~1h; long-running connections fail. | Correct token refresh handling for long-running connections and connection pools. |
| 6m | I can get correct SSL configuration and certificate trust per language instead of plaintext connections that fail with "SSL connection is required" | P0 | PP | Given new server connection, When agent generates connection code, Then SSL enforced with correct certificate download (DigiCertGlobalRootG2.crt.pem), trust configuration, and sslmode=verify-full | Agents generate connections without SSL. Falls back to plaintext or fails with cryptic pg_hba errors. | Prevents connection failures and security vulnerabilities from missing SSL. |
| 6n | I can get the correct azure_pg_admin role behavior instead of the agent generating ALTER ROLE ... SUPERUSER (which fails on managed PostgreSQL) | P0 | PP | Given role management task, When agent generates privilege commands, Then azure_pg_admin used correctly, no superuser references, reserved connections explained | Agents generate ALTER ROLE ... SUPERUSER — fails on Azure. Don't know azure_pg_admin capabilities. | Prevents confusion about privilege model on managed PostgreSQL. |
| 6b | I can configure PgBouncer built-in connection pooling on port 6432 instead of the agent recommending app-level pooling libraries (pg-pool, SQLAlchemy pool) | P0 | PP | Given server, When agent advises on connection pooling, Then built-in PgBouncer recommended with transaction-mode vs session-mode decision tree and port 6432 connection strings | Agents recommend app-level pooling (pg-pool, SQLAlchemy pool). Azure has built-in PgBouncer — a server config, not app code. | Eliminates an entire application dependency and connection exhaustion bugs. |
| 6b-ii | I can get correct pool_mode guidance (transaction vs session) based on workload type, because agents default to session mode which wastes connections | P0 | PP | Given workload description, When agent recommends pool mode, Then transaction mode recommended for short-lived queries; session mode only for advisory locks, prepared statements, or temp tables | Agents don't specify pooling mode. Transaction mode default breaks SET commands, prepared statements, advisory locks. | Prevents subtle session-state bugs that only appear under load. |
| 6k | I can enable Query Store and intelligent tuning for automated index recommendations instead of manual CREATE INDEX and manual vacuum tuning | P0 | PP | Given production server, When agent advises on performance, Then pg_qs.query_capture_mode enabled, intelligent tuning activated, portal Performance Insight referenced | No agent suggests enabling Query Store. They recommend manual EXPLAIN ANALYZE for each slow query. | Automated query performance baseline instead of manual per-query analysis. |
| 6k-ii | I can view and apply intelligent tuning recommendations (auto-index, auto-vacuum) via agent instead of manually trawling the portal | P0 | PP | Given Query Store enabled, When agent queries recommendations, Then pending index/vacuum recommendations shown with one-command apply scripts | Agents generate manual index creation based on guesswork. Azure's intelligent tuning analyzes actual query patterns. | Automated index recommendations based on real workload data, not guesswork. |
| 6k-iii | I can identify slow queries via Query Store top-N analysis instead of manually running EXPLAIN ANALYZE on guessed queries | P0 | PP | Given Query Store enabled, When agent runs slow query analysis, Then top-N queries by total time/calls returned with execution plans and optimization suggestions | Agents generate per-query EXPLAIN ANALYZE. pg_stat_statements + Query Store provides workload-wide visibility. | Workload-wide performance visibility vs one-query-at-a-time analysis. |


#### Skills: Graph / Apache AGE (ROI — smaller population, near 100% agent failure rate)
*Every LLM was trained on Neo4j Cypher, not Apache AGE Cypher. AGE is a subset of openCypher with specific incompatibilities that agents silently generate and developers spend hours debugging. Skills 17-18 cover core AGE Cypher compatibility and advanced graph patterns.*

| ID | Requirement | Priority | Release Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 13 | I can enable Apache AGE with correct session initialization (LOAD 'age' or SET search_path = ag_catalog) instead of hitting "access to library 'age' is not allowed" | P1 | PuP | Given server, When agent sets up graph, Then AGE loaded with correct session config, search_path set, named graph created via create_graph() | Agents omit session setup entirely. First Cypher call fails with library access error giving no hint about solution. | Eliminates the single most common AGE setup error. |
| 13-ii | I can get AGE-specific shared_preload_libraries configuration, because AGE requires both allowlisting AND preloading (two-gate model) unlike vector which only needs allowlisting | P1 | PuP | Given new server, When agent configures AGE, Then both azure.extensions allowlist and shared_preload_libraries updated, restart warning issued | AGE requires both allowlisting AND preloading (two-gate). Agents skip the preloading step — unique to AGE. | Prevents "access to library 'age' is not allowed" from missing preloading config. |
| 14 | I can get AGE-compatible Cypher syntax instead of Neo4j Cypher that silently fails (no MERGE ... ON CREATE SET, no datetime(), no EXISTS { subquery }) | P1 | PuP | Given graph query task, When agent generates Cypher, Then AGE-compatible patterns used; incompatibility table consulted; MERGE workaround patterns provided | Every LLM generates Neo4j Cypher. AGE is a subset with specific incompatibilities that fail silently or with cryptic errors. | Prevents 30+ minute debugging cycles per incompatibility. Developers hit 3-5 per session. |
| 14-ii | I can get correct ag_catalog.cypher() wrapper syntax with agtype return casting, because this SQL-wrapping pattern is unique to AGE and no agent generates it | P1 | PuP | Given Cypher query, When agent generates execution code, Then SELECT * FROM ag_catalog.cypher('graph', $$ ... $$) AS (v agtype) pattern used with correct agtype casting | No agent wraps Cypher in ag_catalog.cypher(). They generate bare Cypher as standalone — AGE requires SQL wrapping for every query. | Fundamental correctness. Without this wrapper, zero Cypher queries execute on AGE. |
| 15 | I can write mixed SQL + Cypher joins using CTE + ag_catalog.cypher() + regular SQL JOINs on extracted agtype properties | P1 | PuP | Given graph + relational data, When agent generates join query, Then CTE wraps cypher() result, JOIN with SQL tables on agtype_to_text() extracted properties | Agents use pure Cypher (losing SQL join) or pure SQL (losing graph traversal). CTE + JOIN pattern is unique to AGE. | Unlocks AGE's unique value: graph queries joined with relational data in a single query. |
| 16 | I can set up a full Graph-augmented RAG pipeline combining AGE graph traversal + pgvector similarity + RRF fusion with correct AGE patterns (not Neo4j) | P1 | PuP | Given database with AGE and pgvector, When agent runs graphrag_setup, Then pipeline configured with AGE-compatible Cypher, DiskANN vectors, and RRF ranking | No agent generates graph + vector hybrid queries. AGE + pgvector combination is unique to PostgreSQL. | Most advanced RAG pattern: leverages Azure PostgreSQL's unique AGE + pgvector combination. |
| 16-ii | I can create and query property indexes on AGE graph nodes for performant graph lookups instead of full graph scans | P1 | PuP | Given large graph, When agent generates index, Then GIN index on ag_catalog.agtype_access_operator used; correct CREATE INDEX syntax for graph properties shown | Agents generate Neo4j CREATE INDEX syntax. AGE uses PostgreSQL index syntax on underlying table's properties column. | Graph query performance at scale. Without indexes, traversals degrade linearly. |


#### Plugin Authentication and Security

| ID | Requirement | Priority | Release Milestone | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| 17 | I can authenticate via Entra ID OAuth 2.0 when installing the plugin from a marketplace | P0 | PP | Given Codex/Claude marketplace install, When OAuth flow triggers, Then Entra ID token acquired and stored securely |
| 18 | I can connect using Managed Identity for Azure-hosted agents | P0 | PP | Given Azure-hosted agent with MI, When agent connects, Then zero-secret auth succeeds |
| 19 | I can fall back to connection string auth for quick-start development | P0 | PP | Given connection string, When agent connects, Then connection established (with security warning) |


#### Distribution and Packaging

| ID | Requirement | Priority | Release Milestone | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| 26 | I can find and install Azure PostgreSQL skills from the Claude Plugin Marketplace | P0 | PP | Given Claude Plugin Directory (claude.com/plugins), When user browses or searches, Then plugin listed and installable (bundled MCP server + skills). |
| 26a | I can find and install Azure PostgreSQL skills as a GitHub Copilot plugin via their marketplace | P0 | PP | Given GitHub MCP Registry (github.com/mcp), When user browses or searches, Then plugin listed and installable as a Copilot extension (bundled MCP server + skills). |
| 24 | I can install Azure PostgreSQL agent skills via npx skills add on any AgentSkills.io-compatible agent | P1 | PuP | Given any compatible agent (18+), When user runs npx skills add Azure/azure-postgresql-agent-skills, Then skills installed and available |
| 25 | I can find and install Azure PostgreSQL skills from the Codex marketplace | P1 | PuP | Given Codex marketplace, When user browses or searches, Then plugin listed and installable (bundled MCP server + skills) |
| 25a | I can find and install Azure PostgreSQL skills from the Cursor Marketplace | P2 | GA | Given Cursor Marketplace (cursor.com/marketplace), When user browses or searches, Then plugin listed with one-click install (bundled skills + rules + MCP server). |
| 27 | I can connect to a hosted MCP endpoint for zero-install demos | P2 | GA | Given MCP-compatible client, When user points to hosted URL, Then tools available without local install |


#### Phase 2 (Future)

| ID | Requirement | Priority | Release Milestone | Acceptance Criteria | Why Agents Fail | ROI Delta |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | I can get DBA-level performance tuning recommendations via agent skill | P2 | GA | DBA skills with slow query analysis, index recommendations | DBA-level analysis requires Azure-specific monitoring context agents lack. | Expert-level performance tuning accessible via conversational agent. |
| 31 | I can get cost optimization recommendations (SKU right-sizing, reserved capacity) | P2 | GA | Cost skill with usage analysis and recommendations | Cost optimization needs SKU-specific knowledge and Azure pricing models. | Identifies cost savings from SKU right-sizing and reserved capacity. |
| 32 | I can generate TypeScript/Python types from my database schema | P2 | GA | Schema-to-types generation via agent | Schema-to-types needs live database introspection — agents generate from guessed schemas. | Eliminates manual type definition maintenance as schemas evolve. |
| 33 | I can use Azure PostgreSQL agent skills from Gemini CLI | P2 | GA | MCP Toolbox format compatibility | Gemini CLI MCP Toolbox compatibility extends reach to Google's agent ecosystem. | Cross-ecosystem reach via same MCP package — zero incremental effort. |
| 20 | I can execute DML operations in a transaction-wrapped sandbox with user confirmation before commit | P3 | Future | Given sandbox session, When agent runs INSERT/UPDATE/DELETE, Then changes held in savepoint until user confirms | Transaction sandboxing prevents accidental data modification during agent exploration. | Safe DML exploration without risk of production data corruption. |
| 21 | I can run DDL operations in an isolated schema sandbox | P3 | Future | Given sandbox session, When agent runs CREATE/ALTER TABLE, Then changes applied in temp schema, promotable on confirm | DDL isolation prevents schema corruption during agent-driven development. | Safe schema iteration without risk to production tables. |
| 22 | I can dry-run any SQL statement to see the execution plan without executing | P3 | Future | Given any SQL, When agent runs dry-run mode, Then EXPLAIN output returned without data modification | Dry-run EXPLAIN requires understanding Azure PostgreSQL's query planner behavior. | Risk-free query analysis for learning and optimization. |


### 3.4 Non-Functional Requirements

| Category | Requirement / Target | Priority | Validation Method |
| --- | --- | --- | --- |
| Security | No secrets stored in plugin configuration files | P0 | Security review + pen test |
| Security | Token refresh handled automatically; Conditional Access support | P0 | Auth flow testing |
| Security | Audit logging of all agent operations via Azure Monitor | P0 | Integration testing |
| Security | Principle of least privilege: agent gets only needed RBAC roles | P0 | RBAC validation |
| Performance | SQL execution returns results within 5s at p95 for standard queries | P0 | Load testing |
| Performance | Schema isolation sandbox adds < 50ms overhead per operation | Future | Perf benchmarks |
| Reliability | Destructive operation detection catches all DROP/TRUNCATE/unfiltered DELETE patterns | P0 | Pattern matching tests |
| Reliability | Session timeout auto-rollback for abandoned sandbox sessions | P1 | Integration testing |
| Compatibility | SKILL.md format passes AgentSkills.io validation for all 18+ supported agents | P0 | Cross-agent testing |
| Compatibility | Plugin works on Codex, Copilot CLI, Claude Code, Cursor, VS Code when launched | P0,P1,P2 | Multi-platform testing |


## 4. Release Plan
### Private Preview
•  **Scope:**
•  Foundational PostgreSQL Skills (P0)
•  Getting Started — Extension Lifecycle, Server Parameters, First Connection
•  Provisioning — IaC, CLI, SKU Selection
• HA and Disaster Recovery
• Auth and Connectivity
• Operations — Monitoring, Tuning, Upgrades
• RAG on Azure Postgres, Azure AI extension and AI functions
•  Claude Plugin Directory listing (FR 26)
•  GitHub Copilot Plugin marketplace listing 
### Public Preview
•  **Scope:**
•  Foundational PostgreSQL Skills (P1)
•  Fleet Management
•  Migrations
•  Graph
•  Codex marketplace listing
•  `npx skills add` cross-platform distribution
•  skills.sh leaderboard publishing
### General Availability
•  **Scope:**
•  Foundational PostgreSQL Skills (P2)
•  Cursor Marketplace listing
•  Hosted MCP endpoint for zero-install access
### Phase 2 (Future)
•  **Scope:**
•  DBA skills
## 5. User Experience
### Scenario 1: Full-Stack App Developer Building a RAG Application
**Persona:** Eva, a full-stack developer at a SaaS company. She uses Codex daily for app development. Her team chose Azure PostgreSQL for
**Today (without Agent Skills):**
Eva opens the Azure Portal to provision a server and configure firewall rules, then switches to psql to create her database and tables, reads
The workflow requires 6+ context switches between tools.
**With Agent Skills:**
**1.  **In Codex: Prompt "Create a new Azure PostgreSQL server with vector search enabled in East US"
**2.  **Agent provisions server, configures networking, enables pgvector and azure_ai extensions
**3.  **Prompt "Create a schema for a support ticket RAG system with vector embeddings"
**4.  **Agent creates tables, configures embedding generation
**5.  **Prompt "Show me how to query similar tickets using DiskANN"
**6.  **Agent generates optimized vector search queries with DiskANN index
**7.  **Zero context switches. Time savings: 60-80%.
### Scenario 2: Developer Building a Knowledge Graph Application
**Persona:** Marcus, a backend developer building a vendor relationship management system. He wants to use Apache AGE for graph queries.
**Today (without Agent Skills):** Must learn Cypher syntax, figure out AGE extension loading, manually write graph construction SQL, and debug graph queries across multiple documentation pages.
**With Agent Skills:**
**1.  **Prompt "Enable Apache AGE on my PostgreSQL database and create a graph called vendor_network"
**2.  **Agent loads AGE, creates the graph, confirms setup
**3.  **Prompt "Add vendors Auth0 and Salesforce connected to project Customer-Portal"
**4.  **Agent generates Cypher MERGE statements, executes, confirms results
**5.  **Prompt "Query all vendor relationships for Customer-Portal"
**6.  **Agent writes and runs the MATCH query, returns structured results
## 6. Billing
•  **Billing model:** Agent skills package is free and open source. Underlying Azure PostgreSQL resource usage follows standard Azure pricing (compute, storage, IOPS). Agent-provisioned resources use the same billing as portal-provisioned resources.
•  **Metering:** No additional metering for skill invocations. Azure resource consumption metered as usual.
•  **Cost guardrails (TBD):** Consider default SKU/tier for agent-provisioned servers to prevent cost surprises (see Open Items).
## 7. Monitoring
**Customer-facing monitoring:**
•  Agent operation audit log via Azure Monitor (all skill invocations logged)
•  Server metrics accessible via `get_server_metrics` tool (CPU, memory, IOPS, connections)
**Internal monitoring:**
•  Skill invocation telemetry (which skills (P0), frequency (P2), errors (P2))
•  Marketplace install counts (Codex, Cursor, Claude, npx skills add)
•  Hosted MCP endpoint connection metrics
## 8. Telemetry and Success Metrics
### Leading Indicators (short-term)

| Metric | Target | Timeframe | Measurement |
| --- | --- | --- | --- |
| GitHub Copilot CLI marketplace installs | 1,000 | 120 days post-launch | Marketplace analytics |
| Claude Marketplace installs | 1,000 | 120 days post-launch | Marketplace analytics |
| Codex marketplace installs | 1,000 | 120 days post-launch | Marketplace analytics |
| Cursor Marketplace installs | 1,000 | 120 days post-launch | Marketplace analytics |
| npx skills add installs | 2,000 | 120 days post-launch | npm download counts |
| Hosted MCP endpoint connections | 500 | 120 days post-launch | Endpoint metrics |
| New Azure PostgreSQL servers provisioned via agent | 200+ | 120 days post-launch | Resource creation telemetry |
| Agent-assisted vector search setups | 100+ | 120 days post-launch | Skill invocation logs |


### Lagging Indicators (long-term)

| Metric | Target | Timeframe | Measurement |
| --- | --- | --- | --- |
| Weekly active users (WAU) | 500 | 8 weeks post-launch | Session telemetry |
| Skill invocations per user per session | 15+ | 8 weeks post-launch | Session analytics |
| Time-to-first-query reduction | 70% reduction | 90 days post-launch | Pre/post measurement |
| NPS from agent users | 60+ | 30 days post-launch | Survey |
| AI coding platform marketplace installs (sustained) | 3,000 | 240 days post-launch | Marketplace analytics |


### Telemetry Events

| Event Name | Trigger | Data Captured |
| --- | --- | --- |
| skills.installed | User installs skill package | install_method (npx/marketplace/mcp), agent_platform, skill_set |
| skill.invoked | Agent calls a skill | skill_name, duration_ms, success/failure, agent_platform |
| auth.flow | Authentication event | auth_method (entra/mi/connstring), success/failure |
| server.provisioned | New server created via agent | sku, region, agent_platform |


## 9. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| AI Coding Platform marketplace approval delays | High | Medium | Start submission process early; support plugin install by public hosted repository |
| Competitors ship more features before we launch | High | High | Launch with AI/Graph differentiators no competitor has (DiskANN, semantic operators, AGE Cypher, Entra ID auth) |
| az CLI / psql pre-install dependency | Medium | Medium | P0 execution relies on terminal tools; developers without az CLI or psql get a broken first-run. Document prerequisites clearly, add a pre-flight check skill that validates toolchain on install, and accelerate pgsqltools CLI bundling to reduce dependency |
| MCP protocol fragmentation across platforms | Medium | Medium | Each platform (Cursor, Claude, Codex, Copilot) has its own plugin manifest format and MCP quirks. Hybrid manifest strategy (section 3.1c): universal skill content layer + thin platform-specific wrappers. CI pipeline auto-generates per-platform packages from shared source |
| Low initial discoverability of npx skills add | Low | Medium | npx skills add is a cross-platform fallback, not the primary distribution channel. Marketplace plugins provide organic browse/search discovery. npx serves developers on platforms without marketplace listings (Windsurf, Gemini CLI, etc.) |
| AgentSkills.io spec changes before we adopt | Medium | Low | SKILL.md is now the de facto standard; ship as primary format, MCP server alongside |
| Azure MCP Server limitations | Medium | Low | Extend server with custom tools; contribute upstream if needed. Skills use az CLI as fallback where MCP tools do not exist |
| Unable to bundle skills + MCP server into a single marketplace plugin | High | Medium | Platform plugin formats may not support bundled executables or may impose size/policy restrictions. Fall back to pgsqltools CLI for MCP server connectivity alongside marketplace-installed skills. Pursue managed MCP endpoint (Stage 3, section 3.1f) to eliminate local binary entirely |
| Too many skills saturate the agent's context window, degrading reasoning quality and causing irrelevant or conflicting output. | Medium | Low | Ship small, focused skills under 3,000 tokens each with precise activation descriptions, recommend persona-based or function-based install profiles instead of "install all," and prune regularly based on install and activation telemetry. |
| skills.sh publishing cadence conflicts with Azure org approval | Low | Medium | Start with custom skills (@azure-postgresql) for fast iteration during PP. Graduate to official Azure org at PuP after validation (strategy in 3.1d) |
| ROI delta misjudged: skills built for low-delta scenarios | Medium | Low | Every skill must pass the litmus test (3.1b): "Does the agent fail without it?" Track agent error rates pre/post skill install. Deprecate zero-delta skills quickly |


## 10. Open Items

| ID | Question / Issue | Owner | Due Date | Status | Resolution |
| --- | --- | --- | --- | --- | --- |
| 1 | Codex marketplace submission and approval timeline? Do we need an OpenAI partnership agreement? | adig | TBD | Open | Codex official Plugin Directory is "coming soon" with no public submission path. Self-serve publishing also "coming soon". No timeline. Cursor Marketplace is live today as fallback. |
| 2 | Billing for agent-provisioned resources: default SKU/tier to prevent cost surprises? | adig | TBD | Open |  |
| 3 | **Distribution path for generic vs. Azure skills.** How should we package and publish `postgres-best-practices/` and `azure/` skills? Four options under consideration: | adig | TBD | Open | **Option 1 — Single package, scope filter.** One npm package (`@azure/postgres-skills`) with a `--scope` flag or `SKILL_SCOPE` env var to filter at runtime. Simplest CI, one version. Downside: Azure users download skills they don't need. **Option 2 — Two npm packages from one monorepo.** `@azure/postgres-best-practices` (generic only) and `@azure/postgres-azure-skills` (Azure, depends on best-practices). Clear marketplace presence, users install only what they need. Downside: version sync overhead. **Option 3 — Base + extension plugin.** `@azure/postgres-skills` as base, `@azure/postgres-skills-azure` as add-on that auto-loads base. Mirrors VS Code extension pack model. Downside: two MCP servers running. **Option 4 — Single package, auto-detect (zero config).** One package, Azure skills auto-activate only when Azure context is detected (connection string pattern, `az cli` presence). Simplest UX. Downside: less transparent, users may not realize Azure skills exist. |
| 4 | **Naming of plugin repository and skills folders.** What should the public GitHub repo name and npm package name(s) be? Needs to balance discoverability, Azure branding guidelines, and clarity for non-Azure PostgreSQL users. Options TBD. | adig | TBD | Open |  |


# 
# 
# 
# Appendix

### 1. Skills ROI Framework
*↑ Referenced from: §2.3 Proposed Solution — Skills selection by ROI delta*
**Litmus test:** For every skill candidate, ask: "If a developer uses Claude Code / Codex / Copilot to do this task without our skill installed, what happens?"
- If the agent produces working code → skip it (zero ROI).
- If the agent produces code that fails on Azure specifically → build it.
- If the agent produces a correct but dramatically suboptimal pattern because it doesn't know about an Azure-specific feature → build it.
The detailed "Why Agents Fail" and "ROI Delta" analysis for each skill is captured inline in the requirement tables in §3 Requirement Specification.
### 2. Competitor Skills Inventory
*↑ Referenced from: §2.3 Proposed Solution — Skills selection by ROI delta*
What competing Postgres providers publish as agent skills today:

| Provider | Published Skills / Plugin Content | Platforms |
| --- | --- | --- |
| Neon | Connection guidance (serverless driver, pooling, connection strings), branching workflows, database creation, SQL execution, schema migration helpers | Claude, Cursor, Codex, Copilot, npx |
| Supabase | Database management (create tables, run SQL), Edge Functions scaffolding, auth setup, storage operations, Realtime subscriptions, MCP-based project management | Claude, Cursor, Codex, Copilot, hosted MCP, npx |
| Timescale | Time-series schema design, continuous aggregates, compression policies, hypertable creation, retention policies, SQL execution | Claude, Cursor, Copilot, hosted MCP, npx |
| Google MCP Toolbox | Connection management, SQL execution, schema inspection (generic CloudSQL/AlloyDB, not skill-based) | Claude, Codex, Gemini CLI |
| Azure Cosmos DB | CRUD operations, vector search, container management, natural language to NoSQL query, database creation | Claude, Cursor, Codex, Copilot, npx |


**Key gap:** No competitor publishes skills for in-database AI (embeddings, semantic operators), graph (Apache AGE Cypher), DiskANN vector indexing. These represent our primary differentiation opportunity.

### 3. Platform Priority Analysis
*↑ Referenced from: §2.3 Proposed Solution — Platform targeting*
**Prioritization principle:** Rank by where Azure Database for PostgreSQL can win market share fastest. Factors: (1) marketplace openness (can we submit today?), (2) developer reach (how many agent developers use it?), (3) competitive gap (are Postgres competitors already there, and can we differentiate?), (4) Microsoft alignment (strategic value to the Azure ecosystem), and (5) Postgres plugin demand (proven install volume for database plugins).
Find detailed competitive analysis here - agent skills-competitive research.docx

| Platform | Priority | Rationale |
| --- | --- | --- |
| GitHub Copilot CLI / VS Code | P0 | Microsoft-owned platform with the 2nd largest agent developer base, and the single broadest channel via VS Code. GitHub Copilot is used by 67.9% of agent developers (SO 2025), second only to ChatGPT. VS Code is the dominant IDE (75.9% of all developers, SO 2025) and GitHub Copilot extensions serve both Copilot CLI and VS Code MCP users through the same GitHub MCP Registry. As a Microsoft-owned platform, we have natural integration advantages: shared auth (Entra ID), internal collaboration, co-marketing, and the ability to ship as a default recommended plugin. The GitHub MCP Registry (github.com/mcp) is live with install counts, and database plugins already have traction (Supabase: 2,639, DBHub: 2,637, Neon: 590). Azure MCP Server is already listed (3,037 installs), giving us a foundation to build on. Copilot CLI and VS Code developers skew toward professional and enterprise users, exactly the audience that values enterprise auth (Entra ID, Managed Identity) and managed database services, where Azure PostgreSQL's differentiators matter most. |
| Claude Code (Anthropic) | P0 | Highest-impact external marketplace for fastest market share capture. 3rd most used AI agent tool globally (40.8% of agent developers, SO 2025), behind only ChatGPT (81.7%) and GitHub Copilot (67.9%). Anthropic invented MCP, making Claude the native home for MCP-based plugins. The Claude Plugin Directory is live, accepting submissions, and has the highest install volumes of any agent marketplace (top plugin: 564K installs; Supabase alone has 63,510). Postgres competitors are already there: Supabase (63,510), Prisma (2,437), Neon (606), but none offer AI-native skills (vector search, DiskANN, Graph-augmented RAG, semantic operators). Azure PostgreSQL can differentiate immediately by being the only Postgres plugin with AI-native, graph, and enterprise auth skills. Claude Sonnet is the most admired AI model (67.5% admired, SO 2025) and 42.8% of all developers use it. Every week we delay, Supabase extends its 63K install lead. |
| Cursor | P2 | Lowest-friction path to a listed marketplace presence today. Cursor Marketplace is live and accepting submissions at cursor.com/marketplace/publish with manual review. AWS Databases, CockroachDB, Cosmos DB, Supabase (verified), and Neon (verified) are already listed. Our SKILL.md + MCP server packaging maps directly to Cursor's plugin format (.cursor-plugin/plugin.json + skills/ + rules/ + mcp.json) with minimal incremental work. Cursor is the fastest-growing AI IDE and the primary tool for "vibe coding" developers who build greenfield apps, the exact audience that chooses a database early. Being listed alongside AWS Databases and CockroachDB positions Azure PostgreSQL in infrastructure buying decisions at the moment developers pick a stack. No public install counts, but Cursor's rapid growth (reported $100M+ ARR) signals high reach among professional developers. We are in the process of publishing the cursor extension, giving us visibility on the platform. |
| OpenAI Codex | P1 | Largest overall agent developer base, marketplace opening soon. ChatGPT/Codex is used by 81.7% of agent developers (SO 2025), the single largest pool. Neon and Timescale are already listed on Codex; Supabase is installable. However, the official Codex Plugin Directory is "coming soon" with no public submission process or timeline. We invest in Codex readiness (plugin manifest, packaging) in parallel, but prioritize Claude and Cursor for immediate market share since those marketplaces are accepting submissions today. When Codex opens, we submit day one given the pre-built package. The Codex audience heavily overlaps with ChatGPT users who are the most numerous but also the broadest (not specifically database-focused), making differentiation through AI-native skills critical. |
| Gemini CLI | P3 | Google-owned, lower priority for Azure market share. Google's agent CLI with MCP Toolbox supporting 15+ databases. Developer reach is growing (Gemini Flash used by 35.3% of developers, SO 2025) but Gemini CLI is not yet a major agent platform. Google's MCP Toolbox already provides generic database connectivity, and Google will naturally favor SpannerGraph and AlloyDB. Azure PostgreSQL competes directly with Google's database offerings, making Gemini a lower-priority platform where our investment yields less market share per effort. Cover via npx skills add (same package, zero incremental work) and revisit if Gemini CLI adoption surges. |
| Windsurf / other IDEs | P3 | Emerging platforms, monitor before investing. Windsurf, JetBrains AI, and other IDE agents are growing but have small user bases relative to the P0 platforms. No dedicated marketplace or plugin submission process. Cover via npx skills add compatibility (AgentSkills.io format works on 18+ agents). |


### 4 Manifest Strategy Analysis
*↑ Referenced from: §2.3 Proposed Solution — Universal plugin manifest*
**Decision: Universal manifest or individual per-platform?**

| Approach | Pros | Cons |
| --- | --- | --- |
| Universal manifest (single SKILL.md + MCP config, adapt per platform at build time) | Single source of truth for skill content; one update propagates everywhere; lower maintenance burden; consistent messaging | Must target lowest-common-denominator features; can't exploit platform-specific hooks (Cursor .cursorrules, Copilot agent extensions); may need build-time transforms |
| Individual manifest per platform (separate plugin packages per marketplace) | Skill content (.md files, MCP config) maintained once; platform wrappers handle packaging/manifest format only; updates to skill content auto-propagate; platform-specific features (rules, tool hints) in wrapper only | Requires build pipeline to generate platform packages from source; initial tooling investment |


**Recommendation:** Universal manifest. Maintain a single SKILL.md + MCP server configuration as the canonical source. Each platform (Claude, Copilot CLI, Codex, Cursor) already accepts markdown-based skill definitions and standard MCP server configs natively. A universal manifest avoids the maintenance overhead of platform-specific wrappers while still being installable everywhere. If a platform later requires format-specific hooks (e.g., Cursor .cursorrules), add a lightweight build-time transform at that point rather than pre-engineering wrappers today. This keeps Day 1 shipping fast and reduces the N-platforms x M-skills update matrix to a single update propagating everywhere.

### 5. Iterative MCP Hosting Strategy
*↑ Referenced from: §2.3 Proposed Solution — Bundled MCP evolution path*
The MCP server must reach developers where they are, with progressively lower friction. We sequence hosting in three phases:
**Phase 1: pgsqltools CLI (Private Preview)**
- `pgsqltools install` downloads MCP server binaries for the user's OS
- `pgsqltools start` runs the MCP server as a local process
- Agent connects via stdio or localhost URL
- Works with every MCP-compatible client (Cursor, Claude, Copilot, etc.)
- **Trade-off:** Higher friction (requires CLI install), but full platform coverage
**Phase 2: Plugin manifest bundling (Public Preview target)**
- Investigate embedding the MCP server binary directly in platform plugin manifests
- **Cursor:** Confirmed feasible. `.cursor-plugin/plugin.json` supports bundled MCP servers. Developer installs the plugin from marketplace and the MCP server starts automatically. Zero separate install step.
- **Claude / Codex:** Feasibility TBD. Need to investigate whether their plugin formats allow bundled executables or only reference external MCP endpoints.
**Action items:**
- Prototype Cursor plugin with bundled MCP server
- File inquiries with Claude and Codex plugin teams on binary bundling support
- Evaluate size constraints (plugin size limits, binary distribution policies)
- Fall back to Phase 1 (pgsqltools CLI) for platforms that don't support bundling, or consider registering MCP to npm.
**Phase 3: Managed MCP endpoint (parallel track)**
- KK and team building a managed, hosted MCP endpoint
- Developer points any MCP client to `https://mcp.postgres.azure.com/mcp`
- Zero local install, zero binary management
- Auth via Entra ID OAuth token exchange
- **Trade-off:** Lowest friction, but requires Azure-side infrastructure and adds network latency for tool calls
- Serves as the "zero-install demo" channel (FR 27) and the long-term frictionless onboarding path

### 6.0 skills.sh Publishing Strategy
*↑ Referenced from: §2.3 Proposed Solution — P1 Publishing*
**Decision: Publish as "Azure Skills" (under Azure org) or custom skills (under team/personal org)?**

| Approach | Pros | Cons |
| --- | --- | --- |
| Azure Skills (official Azure org on skills.sh) | Brand credibility; appears alongside other Azure skills; enterprise trust signal; discoverability via Azure name search; | Azure Skills repo :Requires Azure org approval process; may have slower publishing cadence; must meet Azure branding guidelines; developers asked to copy relevant skill folders for token context optimization, reducing hallucination owing to overlapping skill scope in folders.Azure Skills plugin :Context window saturation- Adding 40 PostgreSQL skill items to a plugin that already has 25 skills pushes total token consumption past the threshold where agent reasoning quality degrades.Activation ambiguity- Overlapping skills (e.g., the all-up azure-ai skill and our azure-pg-ai-embeddings skill) force the agent to guess which one to load, producing blended, half-correct output.Publishing cadence lock- PostgreSQL feature updates (Semantic Operators GA, AGE versions, DiskANN changes) get blocked by cross-service release coordination across 25+ skills.Precedent violation- Cosmos DB and Dataverse already ship as standalone plugins. Adding PostgreSQL inline while sibling services are standalone creates an inconsistent pattern that compounds the overload problem. |
| Custom skills (e.g., @pgsqltools/azure-postgresql) | Full control over publishing cadence; faster iteration; can experiment with skill formats; independent of Azure org bureaucracy | Lower brand recognition; no "Azure official" trust signal; harder for enterprise developers to discover; may appear as community/unofficial |
| Both (recommended): Official Azure skills for GA-quality content, custom skills for preview/experimental | Best of both: enterprise trust for production skills + fast iteration for experimental ones; skills.sh allows both to coexist; can graduate custom -> Azure as skills mature | Two publishing channels to maintain; clear labeling needed to avoid confusion |


**Recommendation:** Start with custom skills (`@azure-postgresql`) during Private Preview for fast iteration. Graduate to official Azure org listing at Public Preview once skills are validated. Maintain both channels: Azure org for GA skills, custom for experimental/preview. This also translates to a standalone azure-postgresql plugin on the official marketplace, with a lightweight skill in the all-up Azure plugin for discovery.

### 7. Persona Analysis: App Developer vs. DBA
*↑ Referenced from: §2.4 Goals and Non-Goals — Target Users*
**Recommendation:** Lead with App Developer, follow with DBA.

| Factor | App Developer | DBA |
| --- | --- | --- |
| TAM / opportunity | Very high (millions of devs using Codex/Copilot) | Moderate (smaller audience) |
| Adoption friction | Low (npm install, starts coding) | Higher (security review, compliance) |
| Competitor focus | All competitors target app devs first | No competitor has DBA-specific skills |
| AI agent fit | Natural (build apps with AI assistance) | Growing (AI-assisted operations) |
| Revenue impact | Drives new workload creation | Drives retention/expansion |


**Phase 1 (Launch): App Developer persona**
- Provision databases, run migrations, query data, generate schema (P0)
- Build RAG apps, use vector search, call AI models from SQL (P0)
- Graph queries with Apache AGE, Graph-augmented RAG pipelines (P1)
**Phase 2 (Fast follow): DBA persona**
- Performance tuning recommendations
- Index optimization (DiskANN advisor)
- Security audit and Entra ID configuration
- Backup/restore management
- Cost optimization and SKU recommendations

### 8. DBAgent / SREAgent Positioning
*↑ Referenced from: §2.4 Goals and Non-Goals — Use cases enhanced*
**How do DBAgent and SREAgent differentiate from marketplace plugins?**

| Dimension | Marketplace Plugin (skills + MCP) | DBAgent | SREAgent |
| --- | --- | --- | --- |
| User | App developer building with PostgreSQL | DBA managing fleet of databases | SRE/Platform engineer on-call |
| Trigger | Developer asks agent a question | Scheduled or event-driven (alert fires, drift detected) | Incident response, performance degradation |
| Workflow | Interactive: developer codes, agent assists | Autonomous: agent runs optimization, developer reviews | Reactive: agent diagnoses, recommends, optionally remediates |
| Skill depth | Broad: provisioning, querying, RAG, graph, auth | Deep: index tuning, query plan analysis, vacuum optimization, config knobs | Deep: connection spike analysis, deadlock resolution, replication lag, failover |
| Distribution | Marketplace plugin (Claude, Copilot, Codex, Cursor) | Internal tool / Azure Portal integration / CLI | PagerDuty/Opsgenie integration / Azure Monitor action |
| Phase | Phase 1 (PP/PuP/GA) | Phase 2 (post-GA) | Phase 2 (post-GA) |


**Design principle:** The marketplace plugin ships the skill content that DBAgent and SREAgent will also consume. Skills are the shared knowledge layer; agents are the execution layer optimized for different personas and triggers.

### 9. Skills Scope: Broader PostgreSQL Ecosystem with Azure Depth
*↑ Referenced from:** §2.3 Proposed Solution — Skills Selection*

| Dimension | Generic + Azure (Recommended) — Pros | Generic + Azure — Cons | Azure-Only Alternative |
| --- | --- | --- | --- |
| Audience Reach | Captures broad PostgreSQL community (Supabase, Neon, RDS, self-hosted); drives leaderboard visibility and installs | Larger content surface to maintain and test across platforms | Serves only Azure Flexible Server developers; cedes community installs to Neon/Supabase plugins |
| Competitive Position | Matches table stakes set by Neon and Supabase; without a generic layer we lose installs to their plugins | Must keep pace with competitors' generic skill updates | Avoids direct competition with established generic plugins but loses discoverability |
| Differentiation | Azure-depth layer delivers knowledge no competitor can replicate (extensions, server parameters, HA/DR) — the upgrade path | Generic content alone is not differentiating; value depends on Azure layer | Strong differentiation on Azure, but no funnel to attract non-Azure developers |
| ROI Integrity | Generic skills still pass the litmus test for common anti-patterns (wrong index type, JSONB operator confusion); Azure skills address failures agents cannot self-correct | Some generic skills overlap with agent base knowledge — lower per-skill ROI than Azure-specific content | Every skill addresses a clear agent failure; highest per-skill ROI but smallest total addressable audience |
| Maintenance | Shared infrastructure reduces per-skill cost; generic skills are testable against any PostgreSQL instance | Two tiers to maintain, version, and publish; risk of inconsistent quality across tiers | Single tier; accuracy verified exclusively against Flexible Server |
| VS Code Alignment | Consistent with VS Code PostgreSQL extension strategy of targeting the broad community | Coordination needed between VS Code extension and skills teams | Diverges from VS Code's community-first strategy |


**Net assessment:** A two-tier approach with generic PostgreSQL skills for community reach plus Azure-specific skills for differentiated depth which aligns with our VS Code OSS strategy, matches what Neon and Supabase already offer, and positions Azure-depth content as a specialized upgrade path.
