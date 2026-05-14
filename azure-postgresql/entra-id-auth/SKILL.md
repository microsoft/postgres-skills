---
name: entra-id-auth
description: "Configure Microsoft Entra ID (Azure AD) authentication for Azure Database for PostgreSQL Flexible Server with managed identities and token-based access"
version: "1.0.0"
tags: [azure, postgresql, entra-id, azure-ad, managed-identity, authentication]
execution_mode: mutate
requires_confirmation: true
platform_scope: azure-postgresql
---

# Entra ID Authentication

## When to Use

**Trigger when:**
- User asks about passwordless authentication to Azure PostgreSQL
- User mentions "managed identity", "Entra ID", "Azure AD", or "service principal"
- User wants to replace password-based auth with token-based auth
- User asks how an application authenticates without storing credentials
- Error: "password authentication failed" when using token auth

**Do NOT use when:**
- User needs SSL/TLS certificate configuration (use `azure-postgresql/networking-ssl/`)
- User needs standard PostgreSQL role management (use `postgresql/row-level-security/`)
- User asks about connection pooling with managed identity (use `azure-postgresql/connection-pooling/`)

**Overlaps with:**
- `azure-postgresql/networking-ssl/` (both are auth/security related)
- `azure-postgresql/connection-pooling/` (PgBouncer token passthrough)

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Entra ID authentication enabled on the server
- User-assigned or system-assigned managed identity (for applications)
- `az CLI` and `psql`

## Instructions

**Step 1: Enable Entra ID auth on the server**

```bash
az postgres flexible-server update \
    --resource-group myRG --name myserver \
    --active-directory-auth Enabled
```

**Step 2: Set an Entra admin**

```bash
az postgres flexible-server ad-admin create \
    --resource-group myRG --server-name myserver \
    --display-name "DBA Team" \
    --object-id "<entra-group-object-id>"
```

**Step 3: Connect with Entra token (interactive user)**

```bash
# Get access token
export PGPASSWORD=$(az account get-access-token \
    --resource-type oss-rdbms --query accessToken -o tsv)

psql "host=myserver.postgres.database.azure.com dbname=postgres \
    user=user@domain.com sslmode=require"
```

**Step 4: Application with managed identity**

```python
from azure.identity import DefaultAzureCredential
import psycopg2

credential = DefaultAzureCredential()
token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default")

conn = psycopg2.connect(
    host="myserver.postgres.database.azure.com",
    dbname="mydb",
    user="my-managed-identity-name",
    password=token.token,
    sslmode="require"
)
```

**Step 5: Create database roles for Entra identities**

```sql
-- As Entra admin, create role for managed identity
SELECT * FROM pgaadauth_create_principal('my-managed-identity-name', false, false);
GRANT ALL ON DATABASE mydb TO "my-managed-identity-name";
```

## Common Mistakes

1. **Token resource scope**: The resource for PostgreSQL tokens is `https://ossrdbms-aad.database.windows.net/.default` — not the generic `https://management.azure.com`. Wrong scope gives valid token that is rejected by PostgreSQL
2. **Token refresh before expiry**: Entra tokens expire in ~1 hour. Cache and refresh when `expires_on - time.time() < 300`. Stale tokens give `FATAL: password authentication failed` with no hint about expiry
3. **`pgaadauth_create_principal` required**: Azure Contributor role manages the server resource but does NOT grant database login. Must run `SELECT * FROM pgaadauth_create_principal('myapp', false, false)` as Entra admin for each identity
4. **Group-based role mapping**: Create Entra group, then `SELECT pgaadauth_create_principal('group-name', false, true)` (last param = isGroup). All members inherit the PostgreSQL role without per-user grants
5. **PgBouncer session mode required**: Token auth fails in transaction pooling mode because auth context is per-connection. Set `pgbouncer.pool_mode = session` for token auth, or use password auth for PgBouncer
6. **Username format matrix**: Managed identity = client ID or object ID. User = `user@domain.com`. Service principal = application (client) ID. Group = display name. Mismatch gives generic auth failure
7. **Hybrid migration path**: Enable both `password_auth` and `active_directory_auth`. Migrate apps one-by-one. Track remaining password connections: `SELECT * FROM pg_stat_activity` filtered by application_name

## Verification

```sql
-- Check if Entra auth is working
SELECT * FROM pgaadauth_list_principals();

-- Verify current session auth method
SELECT usename, application_name FROM pg_stat_activity WHERE pid = pg_backend_pid();
```

```bash
# Verify Entra admin is set
az postgres flexible-server ad-admin list --resource-group myRG --server-name myserver
```

## Failure Recovery

- **Token expired**: Refresh with `az account get-access-token --resource-type oss-rdbms`
- **Principal not found**: Run `pgaadauth_create_principal()` as Entra admin
- **"password authentication failed"**: Ensure Entra auth is enabled and you are using a token, not a password
