---
name: entra-id-auth
description: "Configure Microsoft Entra ID (Azure AD) authentication for Azure Database for PostgreSQL Flexible Server with managed identities and token-based access"
tags: [azure, postgresql, entra-id, azure-ad, managed-identity, authentication]
platform_scope: azure-postgresql
activation:
  user_intent:
    - "set up passwordless authentication to Azure PostgreSQL"
    - "configure managed identity or Entra ID or Azure AD for PostgreSQL"
    - "replace password-based auth with token-based auth"
    - "authenticate application without storing credentials"
    - "fix password authentication failed when using token auth"
  technical_keywords:
    - pgaadauth_create_principal
    - pgaadauth_list_principals
    - managed identity
    - Entra ID
    - Azure AD
    - service principal
    - DefaultAzureCredential
    - "https://ossrdbms-aad.database.windows.net/.default"
    - active-directory-auth
    - "password authentication failed"
  exclusion_conditions:
    - "when user needs SSL/TLS certificate configuration, use `azure-postgresql/networking-ssl/` instead"
    - "when user needs standard PostgreSQL role management, use `postgresql/row-level-security/` instead"
    - "when user asks about connection pooling with managed identity, use `azure-postgresql/connection-pooling/` instead"
  adjacent_skills:
    - "`azure-postgresql/networking-ssl/`"
    - "`azure-postgresql/connection-pooling/`"
---

# Entra ID Authentication

## Prerequisites

- Azure Database for PostgreSQL Flexible Server
- Entra ID authentication enabled on the server
- User-assigned or system-assigned managed identity (for applications)

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

### Verify

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

## Common Mistakes

1. **[CRITICAL] Token resource scope**: The resource for PostgreSQL tokens is `https://ossrdbms-aad.database.windows.net/.default` — not the generic `https://management.azure.com`. Wrong scope gives valid token that is rejected by PostgreSQL

   ❌ Wrong:
   ```python
   token = credential.get_token("https://management.azure.com/.default")
   # Valid token but REJECTED by PostgreSQL — wrong audience
   ```

   ✅ Right:
   ```python
   token = credential.get_token("https://ossrdbms-aad.database.windows.net/.default")
   # Correct scope for Azure Database for PostgreSQL
   ```

2. **[HIGH] Token refresh before expiry**: Entra tokens expire in ~1 hour. Cache and refresh when `expires_on - time.time() < 300`. Stale tokens give `FATAL: password authentication failed` with no hint about expiry
3. **[CRITICAL] `pgaadauth_create_principal` required**: Azure Contributor role manages the server resource but does NOT grant database login. Must run `SELECT * FROM pgaadauth_create_principal('myapp', false, false)` as Entra admin for each identity

   ❌ Wrong:
   ```sql
   -- Assuming Azure RBAC Contributor = database access
   -- App connects → FATAL: password authentication failed for user "myapp"
   ```

   ✅ Right:
   ```sql
   -- As Entra admin, explicitly create the database principal
   SELECT * FROM pgaadauth_create_principal('myapp', false, false);
   GRANT CONNECT ON DATABASE mydb TO "myapp";
   ```

4. **[MEDIUM] Group-based role mapping**: Create Entra group, then `SELECT pgaadauth_create_principal('group-name', false, true)` (last param = isGroup). All members inherit the PostgreSQL role without per-user grants
5. **[HIGH] PgBouncer session mode required**: Token auth fails in transaction pooling mode because auth context is per-connection. Set `pgbouncer.pool_mode = session` for token auth, or use password auth for PgBouncer
6. **[HIGH] Username format matrix**: Managed identity = client ID or object ID. User = `user@domain.com`. Service principal = application (client) ID. Group = display name. Mismatch gives generic auth failure

   ❌ Wrong:
   ```python
   conn = psycopg2.connect(user="my-managed-identity")  # display name
   # FATAL: password authentication failed
   ```

   ✅ Right:
   ```python
   conn = psycopg2.connect(user="a1b2c3d4-e5f6-...")  # client ID or object ID
   ```

7. **[MEDIUM] Hybrid migration path**: Enable both `password_auth` and `active_directory_auth`. Migrate apps one-by-one. Track remaining password connections: `SELECT * FROM pg_stat_activity` filtered by application_name
8. **[HIGH] Token expired mid-session**: Refresh with `az account get-access-token --resource-type oss-rdbms`. For long-running applications, implement token refresh logic that acquires a new token before the current one expires
9. **[HIGH] Principal not found after granting Contributor**: Run `pgaadauth_create_principal()` as Entra admin. Azure resource-level permissions do not automatically create database-level principals

## References
- [Microsoft Entra authentication with Azure Database for PostgreSQL](https://learn.microsoft.com/azure/postgresql/flexible-server/concepts-azure-ad-authentication)
- [Configure Entra ID authentication](https://learn.microsoft.com/azure/postgresql/flexible-server/how-to-configure-sign-in-azure-ad-authentication)
