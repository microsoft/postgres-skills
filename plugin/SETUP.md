# PostgreSQL Skills setup

This plugin starts `@microsoft/postgres-mcp` as a local stdio process through
`npx`. It does not include database credentials or connect to a database until
you select and connect a profile.

## Prerequisites

1. Install Node.js with `npx` available on `PATH`.
2. Install the plugin and review the MCP server entry before enabling it.
3. Use a dedicated, least-privilege PostgreSQL role. Prefer a read-only role and
   a read-only connection profile for exploration.
4. For Azure control-plane operations, install the Azure CLI and authenticate
   with `az login` yourself. The plugin must not initiate an interactive login.

## Configure a database connection

The recommended method is a saved connection profile. Profile metadata is
stored under `~/.postgres-mcp/`; passwords are stored separately in the
operating-system keyring.

```sh
npx -y @microsoft/postgres-mcp connection add my-database \
  "host=db.example.com user=agent_user dbname=app sslmode=verify-full" \
  --access-mode ro
npx -y @microsoft/postgres-mcp connection set-password my-database
npx -y @microsoft/postgres-mcp connection list
```

The password command uses a hidden prompt. Do not put passwords in plugin
configuration, prompts, source files, command arguments, or shell history.

After creating the profile, ask Claude to list the available PostgreSQL
profiles and connect to `my-database`.

## Permissions and approvals

- The PostgreSQL role is the effective security boundary. The MCP server can do
  anything that role is allowed to do.
- Keep profiles read-only unless the task requires writes. Use both
  `--access-mode ro` and database-level read-only privileges.
- Claude may run read-only inspection after you select a connection.
- Claude must describe and request confirmation before any data, schema, role,
  extension, configuration, file-import, or Azure resource change.
- Review the target, SQL, command, and expected impact before approving a
  change. Do not enable blanket approval for write tools.
- Prefer development or anonymized data over production data.

## Data access and privacy

The local MCP process can access the selected database and return schema
metadata, query results, and diagnostics to Claude. That information becomes
part of your Claude interaction and is handled according to your Anthropic
account and organization settings.

CSV tools can read only approved local paths. Keep the allowlist narrow and set
`POSTGRES_MCP_DISABLE_CWD_ACCESS=1` if the MCP startup directory should not be
readable.

This plugin starts postgres-mcp with `--no-telemetry` and does not transmit
database content to Microsoft for plugin telemetry. Installing or updating the
MCP package requires access to the npm registry. Azure workflows may communicate
with Azure services through the Azure CLI after you authenticate.

Review the postgres-mcp
[usage and security documentation](https://github.com/microsoft/postgres-mcp/blob/main/USAGE.md)
before connecting sensitive or production databases.

## Remove access

Disconnect the active profile, then remove it:

```sh
npx -y @microsoft/postgres-mcp connection remove my-database
```

Review the operating-system keyring and `~/.postgres-mcp/` if you also need to
remove locally stored credentials or configuration.
