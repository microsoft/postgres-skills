# postgres-skills plugin

The installable plugin payload for the `postgres-skills` marketplace. It bundles
the PostgreSQL skill and the `postgres-mcp` MCP server so AI-agent CLIs (GitHub Copilot CLI,
Claude Code, Codex) can route PostgreSQL work to the right guidance and tools.

## Contents

| Path | Purpose |
| --- | --- |
| `skills/postgresql-best-practices/` | The skill (SKILL.md routing table + reference docs). |
| `.mcp.json` | Declares the `postgres-mcp` MCP server (stdio, `npx -y @microsoft/postgres-mcp run`). |
| `.codex-plugin/plugin.json` | Plugin manifest required by Codex. |

## Codex compatibility: `plugin.json`

Codex requires a manifest at **`.codex-plugin/plugin.json`** inside the plugin folder.
Without it, `codex plugin add postgres-skills@postgres-skills` fails with
`Error: missing plugin.json`.

It should be updated along with the plugin field in `.github/plugin/marketplace.json`.
