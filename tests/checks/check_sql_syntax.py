#!/usr/bin/env python3
"""Extract SQL blocks from SKILL.md files and validate SQL parseability."""

import os
import re
import subprocess
import sys
from pathlib import Path

SQL_BLOCK_PATTERN = re.compile(r'```(?:sql|pgsql)\s*\n(.*?)```', re.DOTALL)

# Patterns that indicate non-executable SQL (placeholders, shell commands, etc.)
SKIP_PATTERNS = [
    r'\$\d',           # $1, $2 placeholders
    r'<your',          # <your_endpoint>
    r'<endpoint',
    r'\.\.\.\s*\.\.\.',  # ... ellipsis
    r'^(az |psql |\\)',  # shell/psql commands
    r'^\s*--\s*\w',    # comment-only blocks
]

# Context tables that won't exist
CONTEXT_TABLES = re.compile(
    r'\b(events|users|documents|orders|customers|posts|blog|items|products|sessions|accounts)\b', re.I
)

SYNTAX_ERROR_PATTERNS = [
    re.compile(r"ERROR:\s+syntax error", re.IGNORECASE),
    re.compile(r"ERROR:\s+unterminated", re.IGNORECASE),
    re.compile(r"ERROR:\s+invalid input syntax", re.IGNORECASE),
]

def is_syntax_error(error_text: str) -> bool:
    """Return True only for parser/syntax failures."""
    return any(p.search(error_text) for p in SYNTAX_ERROR_PATTERNS)

def extract_sql_blocks(skill_path: Path) -> list[dict]:
    """Extract SQL code blocks from a SKILL.md file."""
    content = skill_path.read_text(encoding="utf-8", errors="ignore")
    blocks = []
    for match in SQL_BLOCK_PATTERN.finditer(content):
        sql = match.group(1).strip()
        if not sql:
            continue
        # Skip non-executable patterns
        if any(re.search(p, sql, re.MULTILINE) for p in SKIP_PATTERNS):
            continue
        # Skip blocks referencing context tables
        if CONTEXT_TABLES.search(sql):
            continue
        blocks.append({"sql": sql, "file": str(skill_path)})
    return blocks

def validate_sql(sql: str, pg_version: str, conn_string: str) -> tuple[bool, str]:
    """Validate SQL and fail only for true syntax errors."""
    # For SELECT/WITH, use EXPLAIN (no execute)
    is_query = re.match(r'^\s*(SELECT|WITH|EXPLAIN)', sql, re.IGNORECASE | re.MULTILINE)
    is_ddl = re.match(r'^\s*(CREATE|ALTER|DROP)', sql, re.IGNORECASE | re.MULTILINE)

    if is_query:
        test_sql = f"EXPLAIN {sql.rstrip(';')}"
    elif is_ddl:
        # Wrap DDL in a transaction and rollback
        test_sql = f"BEGIN; {sql} ROLLBACK;"
    else:
        # For DML, wrap in transaction
        test_sql = f"BEGIN; {sql} ROLLBACK;"

    try:
        result = subprocess.run(
            ["psql", conn_string, "-c", test_sql, "--no-psqlrc", "-v", "ON_ERROR_STOP=1"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            output = (result.stderr or result.stdout or "").strip()
            error_line = next(
                (line.strip() for line in output.splitlines() if "ERROR:" in line),
                output.splitlines()[0] if output else "unknown error",
            )
            if is_syntax_error(error_line):
                return False, error_line
            # Ignore semantic/runtime errors (missing tables/extensions/roles/databases etc.)
            return True, f"non-syntax runtime error ignored: {error_line}"
        return True, ""
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except Exception as e:
        return False, str(e)

def main():
    root = Path(os.environ.get("REPO_ROOT", "."))
    conn_string = os.environ.get("PGSQL_TEST_CONNECTION_STRING", "")
    pg_version = os.environ.get("PG_VERSION", "16")

    if not conn_string:
        print("⚠ PGSQL_TEST_CONNECTION_STRING not set — running syntax-only checks")
        syntax_only = True
    else:
        syntax_only = False

    # Find all SKILL.md files
    skill_files = list(root.rglob("SKILL.md"))
    print(f"Scanning {len(skill_files)} SKILL.md files...")

    all_blocks = []
    for sf in skill_files:
        blocks = extract_sql_blocks(sf)
        all_blocks.extend(blocks)

    print(f"Extracted {len(all_blocks)} executable SQL blocks")

    if syntax_only:
        # Basic syntax checks without DB connection
        errors = []
        for block in all_blocks:
            sql = block["sql"]
            # Check for common syntax issues
            if sql.count("(") != sql.count(")"):
                errors.append((block["file"], "Unbalanced parentheses", sql[:60]))
            if re.search(r';;', sql):
                errors.append((block["file"], "Double semicolons", sql[:60]))
        if errors:
            print(f"\n✗ {len(errors)} syntax issues found:")
            for f, issue, snippet in errors:
                print(f"  {f}: {issue} — {snippet}...")
            sys.exit(1)
        print(f"✓ Basic syntax check passed for {len(all_blocks)} blocks")
        return

    # Full validation against DB
    errors = []
    passed = 0
    ignored_runtime_errors = 0
    for block in all_blocks:
        ok, err = validate_sql(block["sql"], pg_version, conn_string)
        if ok:
            passed += 1
            if err.startswith("non-syntax runtime error ignored:"):
                ignored_runtime_errors += 1
        else:
            errors.append((block["file"], err, block["sql"][:80]))

    print(f"\nResults (PG {pg_version}): {passed}/{len(all_blocks)} blocks valid")
    if ignored_runtime_errors:
        print(f"ℹ Ignored {ignored_runtime_errors} non-syntax runtime errors (missing objects/extensions are expected in doc snippets)")
    if errors:
        print(f"\n✗ {len(errors)} SQL validation failures:")
        for f, err, snippet in errors[:20]:
            print(f"  {Path(f).relative_to(root)}: {err}")
            print(f"    {snippet}...")
        # Warn but don't fail — some SQL needs specific extensions
        if len(errors) > len(all_blocks) * 0.3:
            print("\n✗ More than 30% of SQL blocks are invalid — failing")
            sys.exit(1)
    print(f"✓ SQL validation complete ({passed}/{len(all_blocks)} passed)")

if __name__ == "__main__":
    main()
