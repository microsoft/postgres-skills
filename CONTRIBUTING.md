# Contributing to PostgreSQL Agent Skills

Thank you for your interest in improving these skills! This guide covers how to add new skills or improve existing ones.

## Contributor License Agreement

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Repository layout

```
postgresql-agent-skills/
├── .github/plugin/marketplace.json     # Canonical marketplace manifest (Copilot)
├── plugin/                             # Plugin root (MCP launcher + skills)
│   ├── .mcp.json
│   ├── run_mcp.js                      # MCP server entry point
│   └── skills/
│       ├── postgresql-best-practices/SKILL.md   # Routing table + principles
│       └── postgresql-best-practices/references/ # 22 detailed reference files
├── tests/
│   ├── .skills.json                     # Routing fixture (used by tests + evals only)
│   ├── checks/                          # CI checks (routing precision, size, security)
│   ├── evals/                           # Eval pipeline (300 challenges, LLM-as-judge)
│   │   ├── pipeline.py                  # Main eval orchestrator
│   │   ├── challenges/challenges.yaml   # 300 test challenges
│   │   └── results/latest.json          # Auto-committed eval results
│   └── test_ai_app.js                   # 90-check dogfood test
├── .github/workflows/ci.yml             # 16-job CI pipeline
└── README.md
```

## How routing works

1. Agent loads `plugin/skills/postgresql-best-practices/SKILL.md` (lightweight routing table)
2. Routing table matches user's question to a reference file via keyword triggers
3. Azure references are gated: `pgsql_get_server_capabilities` must confirm `isAzure: true`
4. Agent loads the specific reference file and combines it with its own knowledge
5. Reference provides Azure-specific constraints, decision guides, and anti-hallucination guardrails

## Adding or editing a skill

This repo ships a **single skill**, `postgresql-best-practices`, made up of:

- `plugin/skills/postgresql-best-practices/SKILL.md` — the lightweight routing table that loads first
- `plugin/skills/postgresql-best-practices/references/*.md` — 22 detailed reference files (11 generic + 11 Azure)

Most contributions add or improve a **reference file**. Two steps:

1. **Add the reference** at `plugin/skills/postgresql-best-practices/references/<name>.md`, following the naming convention:
   - `postgresql-*` — generic, works on any PostgreSQL deployment (always available)
   - `azure-postgresql-*` — Azure Database for PostgreSQL (gated by `isAzure: true`)

2. **Register it in the routing table** in `SKILL.md` by adding a row under the matching section
   ("PostgreSQL Skills (always available)" or "Azure PostgreSQL Skills"):

   ```
   | keyword, triggers, here | [<name>](references/<name>.md) | when to use it |
   ```

### Reference file template

```yaml
---
title: "Human-Readable Title"
description: "One-line description of what this reference covers."
tags: [postgresql, topic]
---
```

### Recommended sections

References are supplemental context, so focus on what LLMs get wrong. Common sections used across existing references:

1. **When to use** — trigger conditions and when to route elsewhere
2. **Key Facts (what models get wrong)** — version-gated features, correct parameters
3. **Common Mistakes** — pitfalls and anti-patterns
4. **Anti-Hallucination Rules** — managed-service constraints, what NOT to suggest

## Quality Standards

- Token budget: keep each reference under ~3,000 tokens (CI warns above this)
- Hard cap: 4,000 tokens — `tests/checks/check_skill_size.py` fails the build above this (estimated as `characters / 4`)
- Use `CREATE EXTENSION vector` (binary name), not `CREATE EXTENSION pgvector`
- Azure references must use the `azure_pg_admin` role, never `SUPERUSER`
- Never suggest `ALTER SYSTEM` or OS-level access for Azure Flexible Server — use `az ... parameter set` or the portal
- Include non-reversible operation warnings BEFORE the command
- No diagnostic loops (no pre-query role checks)

## Testing

Validate your changes before submitting (run from the repo root):

```bash
# Static checks — no database or API key needed (all run in CI)
python tests/checks/check_skill_size.py           # token budgets
python tests/checks/check_terminology.py          # terminology
python tests/checks/check_links.py                # reference links
python tests/checks/check_activation_precision.py # activation-keyword precision
python tests/checks/check_licenses.py             # license headers
python tests/checks/check_security.py             # security guardrails
python tests/checks/check_sql_syntax.py           # SQL in reference fences

# Routing eval (no API key needed)
python tests/evals/routing_eval.py --host all

# MCP server protocol conformance (no database needed)
node tests/checks/check_mcp_conformance.js
node tests/test_mcp.js
```

The following integration tests require a live PostgreSQL database, supplied via the
`PGSQL_TEST_CONNECTION_STRING` env var (libpq format). They are skipped in CI unless the
`PGSQL_TEST_CONNECTION_STRING` secret is configured:

```bash
export PGSQL_TEST_CONNECTION_STRING="host=... port=5432 dbname=... user=... password=... sslmode=require"

node tests/test_e2e.js     # end-to-end MCP queries against a real database
node tests/test_plugin.js  # skill routing + MCP tools together
node tests/test_ai_app.js  # AI-application dogfood (90 checks)
```

### Manual testing (local install)

Install the plugin from your local checkout to test changes end-to-end before submitting. Re-adding the marketplace picks up edits to `SKILL.md`, references, and `marketplace.json`. Run from the repo root:

```bash
# GitHub Copilot CLI
copilot plugin marketplace remove postgresql-agent-skills --force
copilot plugin marketplace add "$(pwd)"
copilot plugin install postgresql-agent-skills@postgresql-agent-skills

# Claude Code CLI
claude plugin marketplace remove postgresql-agent-skills
claude plugin marketplace add "$(pwd)"
claude plugin install postgresql-agent-skills@postgresql-agent-skills

# Codex CLI
codex plugin marketplace remove postgresql-agent-skills
codex plugin marketplace add "$(pwd)"
codex plugin add postgresql-agent-skills@postgresql-agent-skills
```

### Running the full eval pipeline

Every skill is continuously evaluated against 300 test challenges across generic PostgreSQL and Azure-specific scenarios. CI runs on manual trigger (`workflow_dispatch`).

```bash
# Run evals (requires Azure OpenAI key)
cd tests/evals
python pipeline.py --provider azure --model gpt-5.4 --concurrency 3

# Run generic-only subset
python pipeline.py --provider azure --model gpt-5.4 --concurrency 3 --challenges challenges/generic_only.yaml

# Dry run (no API calls, validates structure)
python pipeline.py --dry-run
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Add or modify skill(s)
4. Run the validation checks (see [Testing](#testing)) to validate token budgets and structure
5. Submit a PR with a clear description of what the skill teaches
