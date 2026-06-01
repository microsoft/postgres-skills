# postgresql-agent-skills plugin

The installable plugin payload for the `postgresql-agent-skills` marketplace. It bundles
the PostgreSQL skill and the `pgsql-tools` MCP server so AI-agent CLIs (GitHub Copilot CLI,
Claude Code, Codex) can route PostgreSQL work to the right guidance and tools.

## Contents

| Path | Purpose |
| --- | --- |
| `skills/postgresql-best-practices/` | The skill (SKILL.md routing table + reference docs). |
| `.mcp.json` | Declares the `pgsql-tools` MCP server (stdio, `node ${PLUGIN_ROOT}/run_mcp.js`). |
| `run_mcp.js` | Launcher for the `pgsql-tools` MCP server. |
| `PGSQL_TOOLS_CLI_VERSION` | Pinned `pgsql-tools` CLI version. |
| `.codex-plugin/plugin.json` | Plugin manifest required by Codex. |

## Codex compatibility: `plugin.json`

Codex requires a manifest at **`.codex-plugin/plugin.json`** inside the plugin folder.
Without it, `codex plugin add postgresql-agent-skills@postgresql-agent-skills` fails with
`Error: missing plugin.json`.

It should be updated along with the plugin field in `.github/plugin/marketplace.json`.
