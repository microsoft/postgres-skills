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

## When to use this skill

Use for production PostgreSQL issues involving:
- Multi-tenant data isolation with RLS policies
- Connection pooler safety (SET LOCAL vs SET)
- FORCE ROW LEVEL SECURITY on table owner
- SECURITY DEFINER function bypass risks
- Permissive vs Restrictive policy stacking (PG 10+)

Include runnable policy examples. Focus on multi-tenant patterns, pooler-safe session variables, and common bypass mistakes.

## Response focus

Prioritize pooler-safe patterns, bypass risks, and policy stacking logic. The base model knows basic RLS setup.

## Critical pattern: Pooler-safe tenant isolation

```sql
-- With connection poolers: SET LOCAL (transaction-scoped, not session)
BEGIN;
SET LOCAL app.current_tenant = 'tenant_123';
-- ... queries ...
COMMIT;

-- Policy using current_setting
CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.current_tenant'));
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
