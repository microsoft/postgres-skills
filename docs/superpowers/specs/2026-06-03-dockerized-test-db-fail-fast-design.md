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
2. **Docker mechanism:** `tests/Dockerfile` + `tests/docker-compose.yml`, started
   with `docker compose up -d --wait` in CI and locally.
3. **Default connection string** hardcoded in test config (conftest), matching the
   compose service and the existing `sql-validation` lane:
   `host=localhost user=testuser password=testpass dbname=testdb`.
4. The existing `sql-validation` (pg) lane keeps its PG 14–17 service-container
   matrix (preserves version coverage); it is not folded into compose.

## Components

### 1. `tests/Dockerfile`
- `FROM pgvector/pgvector:pg16`.
- Copy an init script into `/docker-entrypoint-initdb.d/` that runs
  `CREATE EXTENSION IF NOT EXISTS vector;` against `testdb`.

### 2. `tests/docker-compose.yml`
- Service `postgres`:
  - build context `.` (uses `tests/Dockerfile`).
  - env `POSTGRES_USER=testuser`, `POSTGRES_PASSWORD=testpass`,
    `POSTGRES_DB=testdb`.
  - ports `5432:5432`.
  - healthcheck `pg_isready -U testuser -d testdb`.

### 3. `tests/conftest.py`
- Add `DEFAULT_CONN_STRING = "host=localhost user=testuser password=testpass dbname=testdb"`.
- `_require_conn_string()` returns `PGSQL_TEST_CONNECTION_STRING` if set, else
  `DEFAULT_CONN_STRING`. Remove `pytest.skip`. Connection failure surfaces as a
  test failure.
- Update the collection-time skip annotations (lines ~40–48) so they no longer
  advertise "skipped unless ... set".

### 4. `tests/test_sql_syntax.py`
- Replace `CONN_STRING = os.environ.get(..., "")` + `skipif(not CONN_STRING)` with
  the shared default; `pg`-marked tests fail (not skip) when no DB is reachable.

### 5. `tests/test_ai_app.py` (AI dogfood)
- DB operations target the Docker DB (pgvector is native, removing the
  `azure.extensions=vector` allowlist blocker that kept the PR in draft).
- Require Azure OpenAI credentials (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`,
  `AZURE_OPENAI_DEPLOYMENT`): if any is absent, **fail** with a clear message — no
  skip, locally or in CI.

### 6. `.github/workflows/ci.yml` — `integration` lane
- Add a step: `docker compose -f tests/docker-compose.yml up -d --wait`.
- Set `PGSQL_TEST_CONNECTION_STRING` to the default (or rely on the conftest
  default), keep `AZURE_OPENAI_*` from secrets, and remove the soft-warning branch.
- Tear down compose in a final `always()` step.

### 7. Docs (`CONTRIBUTING.md`, `README.md`)
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
