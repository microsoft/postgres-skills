---
name: postgresql
description: "Core principles for working with PostgreSQL on any platform — cloud, on-prem, or local development."
tags: [postgresql, core, fundamentals, best-practices]
platform_scope: postgresql
activation:
  user_intent: ["work with PostgreSQL", "connect to postgres", "postgres best practices"]
  technical_keywords: ["psql", "postgresql", "postgres", "pg_"]
  exclusion_conditions: []
  adjacent_skills: ["advanced-indexing", "query-performance", "connection-management"]
---

# PostgreSQL — Core Principles

## 1. Features vary by PostgreSQL version — verify before implementing.

Do not assume a feature is available. Check the version first:

```sql
SELECT version();
```

Many syntax features are version-gated (e.g., `MERGE` requires PG 15+, `json_table` requires PG 17+). If a statement fails with a syntax error, check the version before debugging further.

## 2. Verify your work.

After implementing any change, run a verification query. A change without verification is incomplete.

- **Extension installed?** → `SELECT * FROM pg_extension WHERE extname = 'your_ext';`
- **Table/index created?** → `\dt` or `\di` in psql, or query `pg_class`
- **Parameter changed?** → `SHOW parameter_name;` (some require restart — check `pg_settings.pending_restart`)
- **Schema change applied?** → Query `information_schema.columns`

## 3. Recover from errors, don't loop.

If an approach fails after 2-3 attempts, stop and reconsider. Common failure patterns:

| Error pattern | Likely cause | Fix |
|---|---|---|
| `permission denied for table` | Missing role grant | `GRANT SELECT ON table TO role;` |
| `relation "x" does not exist` | Wrong schema or search_path | `SET search_path TO myschema, public;` |
| `deadlock detected` | Concurrent conflicting locks | Retry with consistent lock ordering |
| `out of shared memory` | Too many locks (bulk operation) | Batch into smaller transactions |
| `could not connect to server` | Wrong host/port or pg_hba.conf | Check `listen_addresses` and pg_hba rules |

## Available Skills

Load the relevant skill when you need detailed guidance for a specific feature area.

| Need | Skill |
|---|---|
| B-tree, GIN, GiST, BRIN, partial indexes | `advanced-indexing` |
| EXPLAIN ANALYZE, work_mem, JIT tuning | `query-performance` |
| JSONB operators, indexing, patterns | `jsonb-patterns` |
| Range, list, hash partitioning | `table-partitioning` |
| tsvector, tsquery, ranking | `full-text-search` |
| Row-level security policies | `row-level-security` |
| max_connections, idle timeout, pooling | `connection-management` |
| Publications, subscriptions, CDC | `logical-replication` |

> **Using Azure Database for PostgreSQL?** Also load the `azure-postgresql` core skill for Azure-specific principles, CLI patterns, and 11 additional Azure skills.

## Documentation

- [PostgreSQL Official Documentation](https://www.postgresql.org/docs/current/)
- [PostgreSQL Wiki](https://wiki.postgresql.org/)
- [PostgreSQL Release Notes](https://www.postgresql.org/docs/release/)
