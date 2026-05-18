---
name: row-level-security
description: "PostgreSQL Row-Level Security policies for multi-tenant isolation and data access control"
tags: [postgresql, rls, security, multi-tenant, policies]
platform_scope: postgresql
activation:
  user_intent:
    - "how to set up multi-tenant data isolation"
    - "row-level security or RLS"
    - "per-user or per-role data filtering"
    - "prevent tenants from seeing each other's data"
    - "set app.tenant_id for RLS"
  technical_keywords:
    - ROW LEVEL SECURITY
    - ENABLE ROW LEVEL SECURITY
    - FORCE ROW LEVEL SECURITY
    - CREATE POLICY
    - current_setting
    - SET LOCAL
    - USING
    - WITH CHECK
    - PERMISSIVE
    - RESTRICTIVE
    - LEAKPROOF
    - pg_policies
  exclusion_conditions:
    - "when need schema-level isolation (separate schemas per tenant), do not use this skill"
  adjacent_skills:
    - "`postgresql/query-performance/`"
---

# Row-Level Security (RLS)

## Instructions

**Step 1: Enable RLS + set tenant context per transaction**

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;  -- also enforce on owner

-- With connection poolers: SET LOCAL (transaction-scoped, not session)
BEGIN;
SET LOCAL app.current_tenant = 'tenant_123';
-- ... queries ...
COMMIT;
```

**Step 2: Policy with pooler-safe pattern**

```sql
CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant'));

-- Separate INSERT policy
CREATE POLICY insert_own ON orders FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant'));
```

### Verify

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

## Common Mistakes

1. **[CRITICAL] Forgetting FORCE on owner**: Table owner bypasses RLS silently. Always `ALTER TABLE t FORCE ROW LEVEL SECURITY`

2. **[CRITICAL] `current_setting` with connection poolers**: PgBouncer transaction-mode resets session variables between transactions

   ❌ Wrong:
   ```sql
   -- Set once per connection (lost on next transaction in pool)
   SET app.current_tenant = 'tenant_A';
   SELECT * FROM orders;
   ```

   ✅ Right:
   ```sql
   -- SET LOCAL scoped to transaction; safe with poolers
   BEGIN;
   SET LOCAL app.current_tenant = 'tenant_A';
   SELECT * FROM orders;
   COMMIT;
   ```

3. **[HIGH] Policy stacking logic**: Multiple policies for same command are OR'd. Use a SINGLE policy with combined logic for AND behavior

4. **[HIGH] Leakproof function requirement**: Non-LEAKPROOF functions in policies may leak rows via error messages. Mark security functions as `LEAKPROOF`

5. **[CRITICAL] RLS + pg_dump/pg_restore**: `pg_dump` runs as superuser (bypasses RLS). `COPY` in application code respects RLS. Mismatched expectations cause data loss

6. **[HIGH] Permissive vs Restrictive policies (PG 10+)**: Default is PERMISSIVE (OR'd). Use `CREATE POLICY ... AS RESTRICTIVE` for mandatory AND constraints

7. **[CRITICAL] SECURITY DEFINER functions bypass RLS**: Functions run as function owner, silently bypassing RLS

   ❌ Wrong:
   ```sql
   CREATE FUNCTION get_all_orders() RETURNS SETOF orders
   LANGUAGE sql SECURITY DEFINER  -- runs as owner, bypasses RLS!
   AS $$ SELECT * FROM orders; $$;
   ```

   ✅ Right:
   ```sql
   CREATE FUNCTION get_all_orders() RETURNS SETOF orders
   LANGUAGE sql SECURITY INVOKER  -- respects caller's RLS policies
   AS $$ SELECT * FROM orders; $$;
   ```

8. **[MEDIUM] Locked out (no rows returned)**: Connect as table owner (bypasses RLS) and fix policy

9. **[MEDIUM] Performance degradation from RLS**: Add index on policy column. Check EXPLAIN for seq scan with filter

10. **[MEDIUM] Policy blocks migrations**: Temporarily `ALTER TABLE t DISABLE ROW LEVEL SECURITY` during migrations
