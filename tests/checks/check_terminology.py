# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""Validate brand terminology and spelling consistency across skill files."""

import os
import re
import sys
from pathlib import Path

# Terminology rules: (wrong_pattern, correct_form, description)
TERMINOLOGY_RULES = [
    # Azure branding
    (r'\bazure\s+ad\b(?!\s*B2C)', "Entra ID", "Azure AD renamed to Entra ID (except Azure AD B2C)"),
    (r'\bflexible\s+server\b(?![\s\.])', "Flexible Server", "Capitalize: Flexible Server"),
    (r'\bsingle\s+server\b', "Single Server", "Single Server is retired; remove references entirely"),
    (r'\bAzure\s+Database\s+for\s+Postgresql\b', "Azure Database for PostgreSQL", "Capital SQL in PostgreSQL"),
    (r'\bpostgresql\b(?=[^_\-/])', None, None),  # skip — too many valid lowercase uses

    # Product names
    (r'\bPgBouncer\b', None, None),  # correct as-is
    (r'(?<![-_/])\bpgbouncer\b(?![\._\-/]|\s*\.conf)', "PgBouncer", "Capitalize PgBouncer"),
    (r'(?<![-_/])\bdiskann\b(?![\._\-/])', "DiskANN", "Capitalize: DiskANN (except in code/identifiers)"),
    (r'(?<![-_/])\bhnsw\b(?![\._\-/])', "HNSW", "All caps: HNSW"),
    (r'\bGithub\b', "GitHub", "Capital H: GitHub"),

    # Common misspellings in PG context
    (r'\bpostgress\b', "PostgreSQL/Postgres", "Misspelling: postgress"),
    (r'\bpostges\b', "PostgreSQL/Postgres", "Misspelling: postges"),
    (r'\brecieve\b', "receive", "Misspelling: recieve"),
    (r'\boccured\b', "occurred", "Misspelling: occured"),
    (r'\bseperately\b', "separately", "Misspelling: seperately"),
]

# Patterns to skip (code blocks, URLs, file paths)
CODE_BLOCK_PATTERN = re.compile(r'```.*?```', re.DOTALL)
INLINE_CODE_PATTERN = re.compile(r'`[^`]+`')
URL_PATTERN = re.compile(r'https?://\S+')
FRONTMATTER_PATTERN = re.compile(r'^---\n.*?\n---\n', re.DOTALL)

def strip_code(content: str) -> str:
    """Remove code blocks and inline code from content for terminology checks."""
    content = FRONTMATTER_PATTERN.sub(' ', content, count=1)
    content = CODE_BLOCK_PATTERN.sub(' ', content)
    content = INLINE_CODE_PATTERN.sub(' ', content)
    content = URL_PATTERN.sub(' ', content)
    return content

def check_file(file_path: Path, root: Path) -> list[tuple[str, int, str, str]]:
    """Check a file for terminology issues. Returns (file, line, found, suggestion)."""
    content = file_path.read_text(encoding="utf-8", errors="ignore")
    clean_content = strip_code(content)
    lines = clean_content.splitlines()
    rel_path = str(file_path.relative_to(root))

    issues = []
    for line_no, line in enumerate(lines, 1):
        for pattern, correct, desc in TERMINOLOGY_RULES:
            if correct is None:
                continue
            matches = re.finditer(pattern, line, re.IGNORECASE)
            for match in matches:
                # Skip if already correct
                if match.group(0) == correct:
                    continue
                issues.append((rel_path, line_no, match.group(0), f"{correct} ({desc})"))

    return issues

def main():
    root = Path(os.environ.get("REPO_ROOT", "."))
    md_files = list(root.rglob("*.md"))
    # Exclude node_modules, .git, etc.
    md_files = [f for f in md_files if ".git" not in str(f) and "node_modules" not in str(f)]

    print(f"Checking terminology in {len(md_files)} markdown files...")

    all_issues = []
    for f in md_files:
        issues = check_file(f, root)
        all_issues.extend(issues)

    if all_issues:
        print(f"\n✗ {len(all_issues)} terminology issues found:\n")
        for file_path, line_no, found, suggestion in sorted(all_issues)[:50]:
            print(f"  {file_path}:{line_no} — \"{found}\" → {suggestion}")
        if len(all_issues) > 50:
            print(f"  ... and {len(all_issues) - 50} more")
        sys.exit(1)
    else:
        print(f"✓ Terminology consistent across {len(md_files)} files")

if __name__ == "__main__":
    main()
