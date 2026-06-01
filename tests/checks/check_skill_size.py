# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""Validate skill files stay within token budgets and size limits."""

import os
import re
import sys
from pathlib import Path

# Approximate token count: ~4 chars per token for English text
CHARS_PER_TOKEN = 4
MAX_SKILL_TOKENS = 4000  # Skills above this get truncated by agents
WARN_SKILL_TOKENS = 3000  # Warn when approaching limit

def count_tokens_approx(text: str) -> int:
    """Approximate token count (conservative estimate)."""
    return len(text) // CHARS_PER_TOKEN

def check_required_sections(content: str, file_path: str) -> list[str]:
    """Check that SKILL.md has expected structure."""
    issues = []
    headers = re.findall(r'^#{1,3}\s+(.+)', content, re.MULTILINE)
    header_lower = [h.lower() for h in headers]

    # Every skill should have at least a title and some structure
    if len(headers) < 2:
        issues.append(f"{file_path}: Too few sections (only {len(headers)} headers)")

    return issues

def main():
    root = Path(os.environ.get("REPO_ROOT", "."))
    skill_files = list(root.rglob("SKILL.md"))
    # Also include reference files
    refs_dir = root / "plugin" / "skills" / "postgresql-best-practices" / "references"
    if refs_dir.exists():
        skill_files.extend(refs_dir.glob("*.md"))
    print(f"Checking {len(skill_files)} skill/reference files for size limits...")

    errors = []
    warnings = []

    for sf in skill_files:
        content = sf.read_text(encoding="utf-8", errors="ignore")
        tokens = count_tokens_approx(content)
        rel_path = str(sf.relative_to(root))

        if tokens > MAX_SKILL_TOKENS:
            errors.append(f"  ✗ {rel_path}: ~{tokens} tokens (max {MAX_SKILL_TOKENS})")
        elif tokens > WARN_SKILL_TOKENS:
            warnings.append(f"  ⚠ {rel_path}: ~{tokens} tokens (approaching {MAX_SKILL_TOKENS} limit)")

        # Structure checks
        section_issues = check_required_sections(content, rel_path)
        errors.extend(section_issues)

        # Check for empty SQL blocks
        empty_sql = re.findall(r'```sql\s*```', content)
        if empty_sql:
            errors.append(f"  ✗ {rel_path}: Contains {len(empty_sql)} empty SQL blocks")

        # Check for TODO/FIXME/HACK markers
        todos = re.findall(r'\b(TODO|FIXME|HACK|XXX)\b', content)
        if todos:
            warnings.append(f"  ⚠ {rel_path}: Contains {len(todos)} TODO/FIXME markers")

    # Report
    if warnings:
        print(f"\n⚠ {len(warnings)} warnings:")
        for w in warnings:
            print(w)

    if errors:
        print(f"\n✗ {len(errors)} errors:")
        for e in errors:
            print(e)
        sys.exit(1)

    print(f"✓ All {len(skill_files)} skills within token budget (max ~{MAX_SKILL_TOKENS} tokens)")

if __name__ == "__main__":
    main()
