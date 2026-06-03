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
│   ├── conftest.py                      # pytest fixtures + MCP client + routing engine
│   ├── test_mcp_protocol.py             # MCP protocol conformance (no DB)
│   ├── test_skill_routing.py            # Skill routing + content contracts (no DB)
│   ├── test_mcp_e2e.py                  # End-to-end MCP queries (integration)
│   └── test_ai_app.py                   # AI-application dogfood (integration)
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

The entire test suite is pytest-based and lives in `tests/`, sharing fixtures via
`tests/conftest.py`. CI runs everything with a single `python -m pytest` command.
Install dependencies once with `pip install -r tests/requirements.txt`, then run
from the repo root.

```bash
# Run the whole suite. Integration tests self-skip without a database; the SQL
# fence checks (marker: pg) self-skip without PGSQL_TEST_CONNECTION_STRING.
python -m pytest

# Fast loop — skip the database-backed integration tests:
python -m pytest -m "not integration"
```

The pytest suite wraps the standalone check scripts (token budgets, terminology,
links, activation precision, licenses, security) and the routing eval, plus native
tests for manifests/structure, MCP protocol, skill routing, performance budget,
binary integrity, and eval regression. The check scripts are still runnable
directly when you want a focused report:

```bash
python tests/checks/check_skill_size.py           # token budgets
python tests/checks/check_terminology.py          # terminology
python tests/checks/check_links.py                # reference links
python tests/checks/check_activation_precision.py # activation-keyword precision
python tests/checks/check_licenses.py             # license headers
python tests/checks/check_security.py             # security guardrails
python tests/evals/routing_eval.py --host all     # routing eval
```

The integration tests and the SQL fence validation require a live PostgreSQL
database, supplied via the `PGSQL_TEST_CONNECTION_STRING` env var (libpq or
postgres URL). They are skipped automatically when the variable is unset (and in
CI unless the matching secret/service is configured):

```bash
export PGSQL_TEST_CONNECTION_STRING="host=... port=5432 dbname=... user=... password=... sslmode=require"

python -m pytest -m integration        # end-to-end MCP queries + AI-application dogfood
python -m pytest tests/test_sql_syntax.py -m pg   # SQL in reference fences against a real database
# Or target a single file:
python -m pytest tests/test_mcp_e2e.py # end-to-end MCP queries against a real database
python -m pytest tests/test_ai_app.py  # AI-application dogfood
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
