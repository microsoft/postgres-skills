---
title: "PostgreSQL Row Level Security"
description: "PostgreSQL Row-Level Security policies for multi-tenant isolation and data access control"
tags: [postgresql, rls, security, multi-tenant, policies]
---

# Row-Level Security (RLS)

> **Response focus:** Prioritize owner bypass, `FORCE ROW LEVEL SECURITY`, pooler-safe tenant context, `SECURITY DEFINER` risk, and `WITH CHECK` failures.

## Version History

| Version | Feature | Notes |
|---------|---------|-------|
| PG 9.5 | RLS introduced | `ENABLE ROW LEVEL SECURITY`, policies, `FORCE` available |
| PG 10 | `AS RESTRICTIVE` policies | Enables AND-style mandatory filters |
| PG 15 | `security_invoker = true` views | Lets views respect caller RLS instead of owner context |

## Parameter Correctness

| Setting or construct | Correct value or pattern | Why it matters |
|----------------------|--------------------------|----------------|
| Table setting | `ALTER TABLE orders ENABLE ROW LEVEL SECURITY;` | Without this, policies exist but do nothing |
| Owner enforcement | `ALTER TABLE orders FORCE ROW LEVEL SECURITY;` | Table owner otherwise bypasses policies |
| Tenant context with poolers | `SET LOCAL app.current_tenant = 'tenant_123';` inside a transaction | Session `SET` is unsafe with transaction pooling |
| Policy reads | `current_setting('app.current_tenant', true)` | `missing_ok = true` avoids hard failure when unset |
| Role attribute | Avoid granting `BYPASSRLS` unless deliberate | Bypasses all table policies |

## Feature Interactions

- **RLS + table owner**: Owner bypasses unless you `FORCE ROW LEVEL SECURITY`.
- **RLS + `SECURITY DEFINER`**: Function runs with owner privileges and can bypass tenant isolation.
- **RLS + views**: View owner context applies unless you use `security_invoker = true` on PG 15+.
- **RLS + connection poolers**: Use `SET LOCAL`, not session `SET`, in transaction pooling.
- **RLS + INSERT/UPDATE**: `USING` filters reads; `WITH CHECK` governs allowed new rows. A policy with only `USING` implicitly copies it to `WITH CHECK` for `ALL` commands. But a `SELECT`-only policy does NOT enable INSERT; you need a separate policy for INSERT with explicit `WITH CHECK`.
- **RLS + separate command policies**: Best practice is separate policies per command (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) for clarity. Avoid one `ALL` policy when check logic differs between reads and writes.
- **RLS + dump or restore**: Superusers and roles with `BYPASSRLS` do not see the same behavior as the app role.

## Diagnostic Checklist

| Symptom | Run | Look for | Fix |
|---------|-----|----------|-----|
| Owner sees rows others do not | `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'orders'::regclass;` | `relforcerowsecurity = false` | `ALTER TABLE orders FORCE ROW LEVEL SECURITY;` |
| App gets zero rows | `SELECT * FROM pg_policies WHERE tablename = 'orders';` | Missing or overly strict `USING` policy | Fix policy logic |
| INSERT fails under RLS | Inspect policy for `WITH CHECK` | Read policy exists but write check missing | Add `WITH CHECK` that matches tenant rule |
| Pooler mixes tenant context | `SHOW pool_mode;` in PgBouncer and inspect app transaction boundaries | Transaction pooling with session `SET` | Use `BEGIN; SET LOCAL ...; COMMIT;` |
| Suspect bypass roles | `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('app_user','owner_role');` | `rolbypassrls = true` | Remove `BYPASSRLS` unless required |

```sql
-- Pooler-safe tenant context
BEGIN;
SET LOCAL app.current_tenant = 'tenant_123';
SELECT * FROM orders;
COMMIT;

-- Verify policies
SELECT policyname, cmd, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orders';
```

## Error Messages

| Error | Root cause | Fix |
|-------|------------|-----|
| `new row violates row-level security policy for table "orders"` | `INSERT` or `UPDATE` fails `WITH CHECK` | Add or fix `WITH CHECK` for allowed tenant rows |
| `query would be affected by row-level security policy for table "orders"` | `row_security = off` while query would filter rows | Run with `row_security = on` or a deliberate bypass role |

## Common Mistakes / Gotchas

- **Forget `FORCE`**: Tests pass as owner and fail in production for app roles.
- **Use session `SET` with PgBouncer transaction mode**: Tenant context disappears on the next statement.
- **Rely on multiple permissive policies for AND logic**: Same-command permissive policies OR together.
- **Use `SECURITY DEFINER` casually**: It can bypass RLS and leak cross-tenant data.
- **Skip `WITH CHECK`**: Reads work, writes fail.
- **Turn on RLS before adding a policy**: Non-owner roles get default deny immediately.
- **Ignore indexes on policy columns**: RLS can turn every request into a filtered Seq Scan.

```sql
-- Minimal gotcha example: read and write rules are different
CREATE POLICY orders_tenant_select ON orders
    USING (tenant_id = current_setting('app.current_tenant', true));

CREATE POLICY orders_tenant_write ON orders
    FOR INSERT, UPDATE
    USING (tenant_id = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
```
## Anti-Hallucination Rules

- Do not claim table owners obey RLS unless `FORCE ROW LEVEL SECURITY` is enabled.
- Do not claim `USING` alone controls INSERT or UPDATE acceptance.
- Do not treat `SECURITY DEFINER` as RLS-safe by default.
- Do not assume views respect caller RLS on PG versions before `security_invoker = true` views.
- Do not recommend session `SET` for tenant context behind transaction pooling.
