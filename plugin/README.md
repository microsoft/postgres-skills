# pgsql-tools — Copilot CLI plugin

Bring PostgreSQL to your [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli)
sessions. Once installed, Copilot can:

- Inspect your database schema (tables, columns, indexes, foreign keys, …)
- Run read-only queries on your behalf
- Help you write, debug, and explain SQL
- Manage multiple connection profiles for different databases

All without leaving the terminal.

## Prerequisites

The plugin ships a Node launcher (`run_mcp.js`) that ensures the
pinned version of the `pgsql-tools` CLI is installed before starting
the MCP server. The launcher uses only Node's standard library — no
extra system tools required:

- **Node.js** is the only requirement.

On first launch (or after the plugin is updated to a new pinned
version), the launcher downloads `pgsql-tools` from
[`microsoft/pgsql-tools`](https://github.com/microsoft/pgsql-tools)
into `~/.pgsql-tools-cli` (POSIX) or
`%USERPROFILE%\.pgsql-tools-cli` (Windows).
Saved connection profiles at the config root are preserved across
upgrades.

### Installing the CLI manually (optional)

If you'd rather pre-install the CLI yourself — for offline use, to
share one install across multiple plugin versions, or to put
`pgsql-tools` on your shell `PATH` for direct use — run the
canonical installer with the version the plugin pins (see
[`PGSQL_TOOLS_CLI_VERSION`](./PGSQL_TOOLS_CLI_VERSION)):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/microsoft/pgsql-tools/main/cli/install.sh | bash -s v0.0.1
```

```powershell
# Windows
$v = "v0.0.1"; iwr -useb https://raw.githubusercontent.com/microsoft/pgsql-tools/main/cli/install.ps1 -OutFile $env:TEMP\install.ps1; & $env:TEMP\install.ps1 $v
```

Open a new terminal afterwards, then verify:

```bash
pgsql-tools --version
```

See [`cli/README.md`](../cli/README.md) for full CLI documentation.

## Install the plugin

```bash
copilot plugin marketplace add microsoft/pgsql-tools
copilot plugin install pgsql-tools@pgsql-tools
```

That's it. Restart Copilot CLI and the `pgsql-tools` MCP server is wired
in.

Verify in a Copilot CLI session:

```
/plugin list             # pgsql-tools should be listed
/mcp                     # pgsql-tools server should be connected
```

## Connect to your database

There are three ways to add a connection. They all store host/user/db
info in `~/.pgsql-tools-cli/connections.yaml` and the password in your
OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret
Service) — not in plain text.

### Option 1 — Ask Copilot to add it

Tell Copilot what to connect to:

> *"Add a connection called `my-db` to `postgresql://postgres@localhost/mydb`."*

Copilot saves the profile. It **won't** ask you for the password —
passwords are only ever entered in your terminal. After Copilot
confirms the profile, set the password yourself:

```bash
pgsql-tools connection set-password my-db
```

That's it. Ask Copilot to query the database and it'll pick up the new
profile.

### Option 2 — Add it from the terminal

If you'd rather drive the CLI directly:

```bash
pgsql-tools connection add my-db "postgresql://postgres@localhost/mydb"
pgsql-tools connection set-password my-db
pgsql-tools connection list
```

### Option 3 — Quick one-off (no saved profile)

For ad-hoc use, set `PGSQL_CONNECTION_STRING` before launching Copilot
CLI:

```bash
export PGSQL_CONNECTION_STRING="postgresql://user:password@host/db"
```

Once you have at least one connection (saved or via env var), just ask:

> *"List the tables in my-db and show me the schema for `users`."*

## Configuration

### Query timeout

Long-running queries are capped at **9 minutes** by default so a runaway
SELECT doesn't tie up your database. Override per user:

```bash
# macOS / Linux — set in your shell rc
export PGSQL_TOOLS_QUERY_TIMEOUT_MS=900000   # 15 minutes
```

```powershell
# Windows
setx PGSQL_TOOLS_QUERY_TIMEOUT_MS 900000
```

Set to `0` to disable the cap entirely. Restart Copilot CLI to pick up
the change.

## Troubleshooting

- **Plugin doesn't show up after install** — restart Copilot CLI.
- **MCP server fails to connect** — run `/mcp show pgsql-tools` to see
  the server's diagnostics on stderr (`pgsql-tools` not on `PATH`,
  network errors, auth failures, etc.).
- **Need to start fresh** — uninstall and reinstall:
  ```bash
  copilot plugin uninstall pgsql-tools
  copilot plugin install pgsql-tools@pgsql-tools
  ```

## Uninstall

```bash
copilot plugin uninstall pgsql-tools
copilot plugin marketplace remove pgsql-tools
rm -rf ~/.pgsql-tools-cli   # remove the downloaded binary (optional)
```

If you'd **also** installed `pgsql-tools` standalone (via `curl … | bash`
or the PowerShell installer), the installer appended a `PATH` line to
your shell rc. Remove it manually:

- macOS / Linux: delete the `# pgsql-tools-cli` block (and the
  `export PATH="$HOME/.pgsql-tools-cli/bin:$PATH"` line below it)
  from `~/.zshrc`, `~/.bashrc`, or `~/.bash_profile` (whichever the
  installer modified).
- Windows: remove `%USERPROFILE%\.pgsql-tools-cli\bin` from the user
  `Path` (Settings → Edit environment variables for your account, or
  `setx Path "..."`).

The plugin itself does not modify your shell rc, so this step is **only
needed if you used the standalone installer separately.**
