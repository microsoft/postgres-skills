---
name: row-level-security
description: "PostgreSQL Row-Level Security policies for multi-tenant isolation and data access control"
version: "1.0.0"
tags: [postgresql, rls, security, multi-tenant, policies]
execution_mode: mutate
requires_confirmation: true
platform_scope: postgresql
---

# Row-Level Security (RLS)

## When to Use

**Trigger when:**
- User asks about multi-tenant data isolation
- User mentions "row-level security", "RLS", or "tenant isolation"
- Application needs per-user or per-role data filtering
- User asks "how to prevent tenants from seeing each other's data"
- User mentions `current_setting()`, `SET app.tenant_id`

**Do NOT use when:**
- Need schema-level isolation (separate schemas per tenant)
- Application already filters in WHERE clause and trusts the app layer
- User needs Azure-specific auth patterns (use `azure-postgresql/entra-id-auth/`)

**Overlaps with:**
- `azure-postgresql/entra-id-auth/` (role management on Azure)
- `postgresql/query-performance/` (RLS adds predicate overhead)

## Prerequisites

- PostgreSQL 9.5+ (basic RLS), 12+ recommended
- Table owner role (to enable/alter policies)
- `psql` or MCP `execute_sql` tool

## Instructions

**Step 1: Enable RLS on table**

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- Table owner bypasses RLS by default. To enforce on owner too:
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
```

**Step 2: Create policy using session variable**

```sql
-- Set tenant context per connection
SET app.current_tenant = 'tenant_123';

-- Policy filters rows by tenant
CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant'));
```

**Step 3: Multi-operation policies**

```sql
-- Separate policies for SELECT vs INSERT
CREATE POLICY read_own ON orders FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant'));

CREATE POLICY insert_own ON orders FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant'));
```

## Common Mistakes

1. **Forgetting FORCE on owner**: Table owner bypasses RLS silently. Use `FORCE ROW LEVEL SECURITY` if owner queries too
2. **No default-deny**: If no policy exists for a role, RLS blocks ALL rows (secure by default). Add explicit policies
3. **Missing `current_setting` GUC**: If `app.current_tenant` is not set, `current_setting()` throws ERROR. Use `current_setting('app.current_tenant', true)` (returns NULL if unset)
4. **Performance**: RLS adds a filter to every query. Index the policy column (e.g., `tenant_id`) to avoid seq scans

## Verification

```sql
-- Test as a non-owner role
SET ROLE app_user;
SET app.current_tenant = 'tenant_A';
SELECT count(*) FROM orders;  -- Should only see tenant_A rows

SET app.current_tenant = 'tenant_B';
SELECT count(*) FROM orders;  -- Should only see tenant_B rows

-- Verify policy exists
SELECT * FROM pg_policies WHERE tablename = 'orders';
```

## Failure Recovery

- **Locked out (no rows returned)**: Policy is too restrictive. Connect as table owner (bypasses RLS) and fix policy
- **Performance degradation**: Add index on policy column. Check EXPLAIN for "Filter: (tenant_id = ...)" on seq scan
- **Policy blocks migrations**: Temporarily `ALTER TABLE t DISABLE ROW LEVEL SECURITY` during schema migrations, re-enable after
