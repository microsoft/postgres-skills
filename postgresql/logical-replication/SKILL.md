---
name: logical-replication
description: "PostgreSQL logical replication setup, publication/subscription patterns, and conflict resolution"
version: "1.0.0"
tags: [postgresql, replication, logical, publication, subscription, cdc]
execution_mode: mutate
requires_confirmation: true
platform_scope: postgresql
---

# Logical Replication

## When to Use

**Trigger when:**
- User needs to replicate specific tables (not entire database)
- User asks about CDC (Change Data Capture) from PostgreSQL
- User wants to replicate between different PostgreSQL major versions
- User mentions "publication", "subscription", `wal_level = logical`
- User needs zero-downtime migration between servers

**Do NOT use when:**
- User needs full byte-for-byte standby (use streaming replication)
- User needs Azure read replicas with virtual endpoints (use `azure-postgresql/ha-disaster-recovery/`)
- User needs event streaming to Kafka (use Debezium on top of logical replication)

**Overlaps with:**
- `azure-postgresql/ha-disaster-recovery/` (Azure-managed replicas)

## Prerequisites

- PostgreSQL 10+ (logical replication GA)
- `wal_level = logical` on publisher (requires restart if changing)
- Tables must have a primary key or REPLICA IDENTITY set
- `psql` or MCP `execute_sql` tool

## Instructions

**Step 1: Configure publisher**

```sql
-- Verify wal_level (if not 'logical', requires restart to change)
SHOW wal_level;

-- Create publication for specific tables
CREATE PUBLICATION my_pub FOR TABLE orders, customers;

-- Or for all tables
CREATE PUBLICATION my_pub FOR ALL TABLES;
```

> **Note:** On managed PostgreSQL (Azure, RDS), change `wal_level` via the cloud portal or server parameters API, not `postgresql.conf` directly. Use `SHOW` commands to verify current settings.

**Step 2: Configure subscriber**

```sql
-- On the subscriber server
CREATE SUBSCRIPTION my_sub
    CONNECTION 'host=publisher_host dbname=mydb user=repl_user password=...'
    PUBLICATION my_pub;
```

**Step 3: Handle tables without primary keys**

```sql
-- Set replica identity for tables without PK
ALTER TABLE audit_log REPLICA IDENTITY FULL;
-- WARNING: FULL identity sends entire row on UPDATE/DELETE (slower)
```

**Step 4: Monitor replication lag**

```sql
-- On publisher: check replication slots
SELECT slot_name, active, 
       pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots;
```

## Common Mistakes

1. **Missing primary key**: Without PK or REPLICA IDENTITY, UPDATE/DELETE fail to replicate with "cannot update/delete from table without primary key"
2. **wal_level not set**: `wal_level = logical` requires server restart. Plan for downtime or set during maintenance window
3. **Slot bloat**: Inactive replication slots prevent WAL cleanup, growing disk usage. Drop unused slots
4. **Schema changes not replicated**: DDL (ALTER TABLE) is NOT replicated. Apply schema changes on both publisher and subscriber manually
5. **Referencing `postgresql.conf` on managed services**: On Azure/RDS, use the server parameters API or `ALTER DATABASE` to change settings. Never reference config files directly

## Verification

```sql
-- Publisher: confirm publication exists
SELECT * FROM pg_publication_tables WHERE pubname = 'my_pub';

-- Subscriber: confirm subscription is active
SELECT subname, subenabled, subconninfo FROM pg_subscription;

-- Check replication is flowing (lag should be near 0)
SELECT slot_name, active, 
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lag
FROM pg_replication_slots;
```

## Failure Recovery

- **Subscription stuck**: `ALTER SUBSCRIPTION my_sub DISABLE; ALTER SUBSCRIPTION my_sub ENABLE;`
- **Slot consuming disk**: If subscriber is gone, drop the orphaned slot: `SELECT pg_drop_replication_slot('my_sub')`
- **Conflict on subscriber**: Check `pg_stat_subscription` for error. Common fix: skip the conflicting transaction or resync the table
