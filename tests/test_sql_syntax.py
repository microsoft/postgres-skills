# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""SQL-syntax validation of skill SQL fences against a live PostgreSQL.

Native port of the former ``tests/checks/check_sql_syntax.py``. Extracts every
executable ``sql``/``pgsql`` fence from SKILL.md and reference files, then
validates parseability via ``psql`` (EXPLAIN for queries, BEGIN…ROLLBACK for
DDL/DML). Only true parser/syntax errors count as failures, and — matching the
original — the build fails only when more than 30% of blocks are invalid.

The CI ``sql-validation`` job runs this across a PG 14–17 service matrix; locally
and on PRs without a database it skips automatically via the ``pg`` marker.
"""

import os
import re
import subprocess

import pytest

from conftest import ROOT

SQL_BLOCK_PATTERN = re.compile(r"```(?:sql|pgsql)\s*\n(.*?)```", re.DOTALL)

SKIP_PATTERNS = [
    r"\$\d",
    r"<your",
    r"<endpoint",
    r"\.\.\.\s*\.\.\.",
    r"^(az |psql |\\)",
    r"^\s*--\s*\w",
]

CONTEXT_TABLES = re.compile(
    r"\b(events|users|documents|orders|customers|posts|blog|items|products|sessions|accounts)\b",
    re.I,
)

SYNTAX_ERROR_PATTERNS = [
    re.compile(r"ERROR:\s+syntax error", re.IGNORECASE),
    re.compile(r"ERROR:\s+unterminated", re.IGNORECASE),
    re.compile(r"ERROR:\s+invalid input syntax", re.IGNORECASE),
]

CONN_STRING = os.environ.get("PGSQL_TEST_CONNECTION_STRING", "")


def _is_syntax_error(error_text):
    return any(p.search(error_text) for p in SYNTAX_ERROR_PATTERNS)


def _extract_sql_blocks(path):
    content = path.read_text(encoding="utf-8", errors="ignore")
    blocks = []
    for match in SQL_BLOCK_PATTERN.finditer(content):
        sql = match.group(1).strip()
        if not sql:
            continue
        if any(re.search(p, sql, re.MULTILINE) for p in SKIP_PATTERNS):
            continue
        if CONTEXT_TABLES.search(sql):
            continue
        blocks.append(sql)
    return blocks


def _validate_sql(sql, conn_string):
    is_query = re.match(r"^\s*(SELECT|WITH|EXPLAIN)", sql, re.IGNORECASE | re.MULTILINE)
    if is_query:
        test_sql = f"EXPLAIN {sql.rstrip(';')}"
    else:
        test_sql = f"BEGIN; {sql} ROLLBACK;"
    try:
        result = subprocess.run(
            ["psql", conn_string, "-c", test_sql, "--no-psqlrc", "-v", "ON_ERROR_STOP=1"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            output = (result.stderr or result.stdout or "").strip()
            error_line = next(
                (line.strip() for line in output.splitlines() if "ERROR:" in line),
                output.splitlines()[0] if output else "unknown error",
            )
            if _is_syntax_error(error_line):
                return False, error_line
            return True, ""
        return True, ""
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _collect_blocks():
    files = list(ROOT.rglob("SKILL.md"))
    refs = ROOT / "plugin" / "skills" / "postgresql-best-practices" / "references"
    if refs.exists():
        files.extend(refs.glob("*.md"))
    blocks = []
    for f in files:
        blocks.extend(_extract_sql_blocks(f))
    return blocks


@pytest.mark.pg
@pytest.mark.skipif(not CONN_STRING, reason="PGSQL_TEST_CONNECTION_STRING not set")
def test_sql_blocks_parse():
    blocks = _collect_blocks()
    assert blocks, "no executable SQL blocks extracted"
    failures = []
    for sql in blocks:
        ok, err = _validate_sql(sql, CONN_STRING)
        if not ok:
            failures.append(f"{err}: {sql[:80]}")
    ratio = len(failures) / len(blocks)
    assert ratio <= 0.3, (
        f"{len(failures)}/{len(blocks)} SQL blocks failed syntax validation "
        f"({ratio:.0%} > 30%):\n" + "\n".join(failures[:20])
    )


def test_sql_blocks_structural():
    """No-database structural lint of SQL fences.

    Ports the database-independent ``syntax-only`` path of the former
    ``tests/checks/check_sql_syntax.py`` so obvious authoring mistakes are caught
    in the default (no ``pg``) lane without a live PostgreSQL. Flags balanced-
    parenthesis violations and accidental empty statements (``;;``).
    """
    blocks = _collect_blocks()
    assert blocks, "no executable SQL blocks extracted"
    failures = []
    for sql in blocks:
        if sql.count("(") != sql.count(")"):
            failures.append(f"unbalanced parentheses: {sql[:80]}")
        if re.search(r";;", sql):
            failures.append(f"double semicolon (empty statement): {sql[:80]}")
    assert not failures, (
        f"{len(failures)} SQL blocks failed structural validation:\n"
        + "\n".join(failures[:20])
    )
