---
title: "Azure PostgreSQL Entra ID Auth"
description: "Configure Microsoft Entra ID (Azure AD) authentication for Azure Database for PostgreSQL Flexible Server with managed identities and token-based access"
tags: [azure, postgresql, entra-id, azure-ad, managed-identity, authentication]
---

# Entra ID Authentication

## When to use this skill

Use for Azure PostgreSQL issues involving:
- Token-based (passwordless) authentication setup
- Managed identity RBAC configuration
- Token scope errors and auth failures
- pgaadauth_create_principal workflow
- PgBouncer + token auth conflicts

Avoid explaining basic Azure CLI commands or generic identity concepts. The base model knows these. Focus on PostgreSQL-specific token auth patterns and failure modes.

> **NEVER suggest for Azure:** `pg_hba.conf` edits, `/var/lib/postgresql` paths, or `postgresql.conf` changes. Auth configuration is via `az postgres flexible-server ad-admin` and server parameters API.

## ⚠️ Confident Hallucination Corrections

- **❌ WRONG: "Use the managed identity display name as the database username."** ✅ CORRECT: The PostgreSQL username for managed identity must be the **client ID** (or object ID), NOT the display name or app name. Display names are not unique and will fail auth.
- **❌ WRONG: "PgBouncer transaction mode works with token auth."** ✅ CORRECT: **Session pool mode is required** for Entra token auth. Transaction mode drops auth context between transactions.

## Key Facts (what models get wrong)

| Fact | Detail |
|------|--------|
| Token resource scope | `https://ossrdbms-aad.database.windows.net/.default` — NOT `https://management.azure.com` |
| Token expiry | ~1 hour. Must refresh before expiry or connection fails with generic auth error |
| pgaadauth_create_principal required | Azure RBAC Contributor does NOT grant database login. Must explicitly create principal |
| Username format varies | Managed identity = client/object ID. User = `user@domain.com`. Service principal = application ID |
| PgBouncer requires session mode | Transaction mode breaks token auth (auth context is per-connection) |
| Propagation delay | RBAC role assignment takes up to **10 minutes** to propagate |
| Entra group propagation | Group membership changes take up to **60 minutes** to propagate to PostgreSQL |
| Entra admin is mandatory | Must set an Entra admin before any token-based login works |

## Critical Code Pattern: Managed Identity Connection

```python
from azure.identity import DefaultAzureCredential
import psycopg2

credential = DefaultAzureCredential()
token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default")

conn = psycopg2.connect(
    host="myserver.postgres.database.azure.com",
    dbname="mydb",
    user="my-managed-identity-client-id",  # client ID, NOT display name
    password=token.token,
    sslmode="require"
)
```

## Critical Code Pattern: Create Database Principal

```sql
-- As Entra admin — required for each identity that needs DB access
SELECT * FROM pgaadauth_create_principal('my-managed-identity-name', false, false);
GRANT ALL ON DATABASE mydb TO "my-managed-identity-name";
```

## Common Mistakes

1. **[CRITICAL] Token resource scope**: The resource for PostgreSQL tokens is `https://ossrdbms-aad.database.windows.net/.default` not the generic `https://management.azure.com`. Wrong scope gives valid token that is rejected by PostgreSQL

   Wrong:
   ```python
   token = credential.get_token("https://management.azure.com/.default")
   # Valid token but REJECTED by PostgreSQL wrong audience
   ```

   Right:
   ```python
   token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default")
   # Correct scope for Azure Database for PostgreSQL
   ```

2. **[HIGH] Token refresh before expiry**: Entra tokens expire in ~1 hour. Cache and refresh when `expires_on - time.time() < 300`. Stale tokens give `FATAL: password authentication failed` with no hint about expiry
3. **[CRITICAL] `pgaadauth_create_principal` required**: Azure Contributor role manages the server resource but does NOT grant database login. Must run `SELECT * FROM pgaadauth_create_principal('myapp', false, false)` as Entra admin for each identity

   Wrong:
   ```sql
   -- Assuming Azure RBAC Contributor = database access
   -- App connects FATAL: password authentication failed for user "myapp"
   ```

   Right:
   ```sql
   -- As Entra admin, explicitly create the database principal
   SELECT * FROM pgaadauth_create_principal('myapp', false, false);
   GRANT CONNECT ON DATABASE mydb TO "myapp";
   ```

4. **[MEDIUM] Group-based role mapping**: Create Entra group, then `SELECT pgaadauth_create_principal('group-name', false, true)` (last param = isGroup). All members inherit the PostgreSQL role without per-user grants
5. **[HIGH] PgBouncer session mode required**: Token auth fails in transaction pooling mode because auth context is per-connection. Set `pgbouncer.pool_mode = session` for token auth, or use password auth for PgBouncer
6. **[HIGH] Username format matrix**: Managed identity = client ID or object ID. User = `user@domain.com`. Service principal = application (client) ID. Group = display name. Mismatch gives generic auth failure

   Wrong:
   ```python
   conn = psycopg2.connect(user="my-managed-identity")  # display name
   # FATAL: password authentication failed
   ```

   Right:
   ```python
   conn = psycopg2.connect(user="a1b2c3d4-e5f6-...")  # client ID or object ID
   ```

7. **[MEDIUM] Hybrid migration path**: Enable both `password_auth` and `active_directory_auth`. Migrate apps one-by-one. Track remaining password connections: `SELECT * FROM pg_stat_activity` filtered by application_name
8. **[HIGH] Token expired mid-session**: Refresh with `az account get-access-token --resource-type oss-rdbms`. For long-running applications, implement token refresh logic that acquires a new token before the current one expires
9. **[HIGH] Principal not found after granting Contributor**: Run `pgaadauth_create_principal()` as Entra admin. Azure resource-level permissions do not automatically create database-level principals
10. **[HIGH] Token refresh in pooled long-lived apps**: PgBouncer reuses backends, so an expired token can surface on the next checkout. Refresh at ~50% of token lifetime, not at expiry
11. **[MEDIUM] Group membership propagation delay**: Entra group membership can take up to 60 minutes to reach PostgreSQL role grants. Warn users before troubleshooting grants too early
12. **[MEDIUM] Driver-specific auth quirks**: Match token injection to the driver: psycopg2 uses `password=token`, Npgsql uses `Password`, JDBC uses `authenticationPluginClassName`

## References
- [Microsoft Entra authentication with Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-azure-ad-authentication)
- [Configure Entra ID authentication](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-configure-sign-in-azure-ad-authentication)