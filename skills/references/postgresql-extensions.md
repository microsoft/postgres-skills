---
name: postgresql-extensions
description: "Managing PostgreSQL extensions on any deployment — install, upgrade, version checks, and common extensions."
tags: [postgresql, extensions, contrib, pg_stat_statements, pg_trgm]
platform_scope: postgresql
---

# PostgreSQL Extensions

## Prerequisites

- Superuser or role with CREATE privilege on the database
- Extension files installed on the server (via OS package manager or compiled from source)

## Instructions

**Step 1: Check available extensions**

```sql
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE installed_version IS NOT NULL OR name LIKE '%vector%'
ORDER BY name;
```

**Step 2: Install an extension**

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
```

**Step 3: Upgrade an extension**

```sql
ALTER EXTENSION pg_stat_statements UPDATE;
```

**Step 4: Check extension version**

```sql
SELECT extname, extversion FROM pg_extension;
```

## Common Extensions

| Extension | Purpose | Needs shared_preload_libraries? |
|---|---|---|
| `pg_stat_statements` | Query performance statistics | YES |
| `pg_trgm` | Trigram similarity, fuzzy search | No |
| `vector` (pgvector) | Vector similarity search | No |
| `postgis` | Geospatial data | No |
| `pg_cron` | Job scheduling | YES |
| `hstore` | Key-value store | No |
| `uuid-ossp` | UUID generation | No |
| `citext` | Case-insensitive text | No |

## Extensions requiring shared_preload_libraries

Some extensions need to be loaded at server start:

```
# postgresql.conf
shared_preload_libraries = 'pg_stat_statements, pg_cron'
```

After changing this, restart PostgreSQL.

## Common Mistakes

1. **[CRITICAL] Extension files not installed**: `CREATE EXTENSION` fails if the .so/.control files aren't on the filesystem. Install via `apt install postgresql-16-pgvector` or equivalent.
2. **[HIGH] Forgetting shared_preload_libraries**: Extensions like pg_stat_statements won't collect data without being preloaded. Requires server restart.
3. **[MEDIUM] Schema ownership**: Extensions install into `public` by default. Use `CREATE EXTENSION ... SCHEMA myschema;` for isolation.
4. **[MEDIUM] Version pinning**: Use `CREATE EXTENSION vector VERSION '0.7.0';` when reproducibility matters.

## Azure-specific differences

On Azure Database for PostgreSQL, the extension workflow is different:
- Extensions must be allowlisted BEFORE installation
- No superuser — use `azure_pg_admin` role
- `shared_preload_libraries` is managed via Azure Portal/CLI, not postgresql.conf

See `azure-postgresql-extension-lifecycle` for the Azure workflow (requires Azure connection).
