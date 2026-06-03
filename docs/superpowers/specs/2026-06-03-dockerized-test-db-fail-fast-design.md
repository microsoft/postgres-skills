# Dockerized Test DB + Fail-Fast DB/LLM Gating — Design

Date: 2026-06-03
Status: Approved (design)
Context: Follow-up hardening to PR #14 ("Restructure test suite: single-command
pytest + CI consolidation").

## Problem

The restructured pytest suite self-**skips** DB-backed and integration tests when
`PGSQL_TEST_CONNECTION_STRING` (and, for the AI dogfood test, Azure OpenAI
credentials) are absent. The `integration` CI lane relies on a repo secret for the
connection string and explicitly continues with a warning when it is unset, so the
lane can report green without running any regression assertions:

- `.github/workflows/ci.yml` integration job: soft warning + `pytest -m integration`
  with no Postgres service.
- `tests/conftest.py` `_require_conn_string()` → `pytest.skip(...)` when unset.
- `tests/test_sql_syntax.py` `@pytest.mark.skipif(not CONN_STRING, ...)`.

This produces a false-green risk: fork PRs (no secrets) and any secret
rotation/rename silently skip the regression signal instead of failing.

## Goal

Make the DB-backed and integration suites **fail, never skip**, by providing a
Dockerized PostgreSQL (with pgvector) that is identical locally and in CI, and a
hardcoded default connection string so a DB is always expected to be present.

## Decisions (from brainstorming)

1. **No skip anywhere.** DB-backed tests fail if the DB is unreachable. Integration
   / AI dogfood tests fail if Azure OpenAI credentials are absent — locally **and**
   in CI.
2. **Docker mechanism:** `tests/docker-compose.yml` (no Dockerfile — the
   `pgvector/pgvector` image is referenced directly), started with
   `docker compose up -d --wait` in CI and locally.
3. **Default connection string** hardcoded in test config (conftest), matching the
   compose service and the existing `sql-validation` lane:
   `host=localhost user=testuser password=testpass dbname=testdb`.
4. **Unify the PG 14–17 matrix onto Docker/compose** by selecting the
   `pgvector/pgvector:pg${PG_VERSION}` image tag (14, 15, 16, 17). This replaces the
   current `sql-validation` setup, which installs `postgresql-N-pgvector` on the
   runner host (not inside the service container) with `|| true` — so `vector` is
   effectively unavailable there today and failures are masked. Docker gives real
   pgvector across all versions, a single mechanism, and local reproducibility of
   any version.

## Components

### 1. `tests/docker-compose.yml` + `tests/init-vector.sql`
- `tests/init-vector.sql`: a single statement — `CREATE EXTENSION IF NOT EXISTS vector;`.
- Service `postgres`:
  - `image: pgvector/pgvector:pg${PG_VERSION:-16}` (no build step).
  - env `POSTGRES_USER=testuser`, `POSTGRES_PASSWORD=testpass`,
    `POSTGRES_DB=testdb`.
  - ports `5432:5432`.
  - volume `./init-vector.sql:/docker-entrypoint-initdb.d/init.sql:ro` so the
    extension is created on first boot.
  - healthcheck `pg_isready -U testuser -d testdb`.

### 2. `tests/conftest.py`
- Add `DEFAULT_CONN_STRING = "host=localhost user=testuser password=testpass dbname=testdb"`.
- `_require_conn_string()` returns `PGSQL_TEST_CONNECTION_STRING` if set, else
  `DEFAULT_CONN_STRING`. Remove `pytest.skip`. Connection failure surfaces as a
  test failure.
- Update the collection-time skip annotations (lines ~40–48) so they no longer
  advertise "skipped unless ... set".

### 3. `tests/test_sql_syntax.py`
- Replace `CONN_STRING = os.environ.get(..., "")` + `skipif(not CONN_STRING)` with
  the shared default; `pg`-marked tests fail (not skip) when no DB is reachable.

### 4. `tests/test_ai_app.py` (AI dogfood)
- DB operations target the Docker DB (pgvector is native, removing the
  `azure.extensions=vector` allowlist blocker that kept the PR in draft).
- Require Azure OpenAI credentials (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`,
  `AZURE_OPENAI_DEPLOYMENT`): if any is absent, **fail** with a clear message — no
  skip, locally or in CI.

### 5. `.github/workflows/ci.yml`
**`sql-validation` (pg) lane:**
- Drop the `services.postgres` block and the host `apt-get ... pgvector || true`
  step.
- Per matrix cell, run `PG_VERSION=${{ matrix.pg_version }} docker compose
  -f tests/docker-compose.yml up -d --wait`, then `pytest -m pg`.
- Tear down compose in a final `always()` step.

**`integration` lane:**
- Add a step: `docker compose -f tests/docker-compose.yml up -d --wait` (defaults
  to PG 16).
- Rely on the conftest default connection string; keep `AZURE_OPENAI_*` from
  secrets, and remove the soft-warning branch.
- Tear down compose in a final `always()` step.

### 6. Docs (`CONTRIBUTING.md`, `README.md`)
- Local flow: `docker compose -f tests/docker-compose.yml up -d --wait` then
  `python -m pytest`. Note that `-m integration` additionally requires
  `AZURE_OPENAI_*` env vars.

## Consequences / Trade-offs

- **Fork PRs fail the integration lane** (no Azure secrets). This is the accepted
  consequence of requiring Azure creds (user decision). DB-only lanes (`pg`,
  default) do **not** require secrets and still pass on forks.
- Local contributors must run Docker and provide Azure creds to run the integration
  suite. The default (`not pg and not integration`) suite is unaffected and needs
  neither.

## Out of Scope

- The other review findings from PR #14 (routing-eval expectations, FTS assertion
  strength, SQL connection/auth preflight, Codex manifest validation, duplicate SQL
  fence parsers). Tracked separately.

## Verification

- `docker compose -f tests/docker-compose.yml up -d --wait` succeeds; `vector`
  extension present in `testdb`.
- With Docker up and no `PGSQL_TEST_CONNECTION_STRING`: `pytest -m pg` and
  `pytest -m integration` connect to the Docker DB.
- With Docker **down**: those suites **fail** (not skip).
- Without `AZURE_OPENAI_*`: `pytest -m integration` fails on the dogfood test with a
  clear credentials message.
