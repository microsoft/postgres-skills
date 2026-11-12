# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Skill/reference size and structure budgets.

Every SKILL.md and reference file must stay within the token budget, have a
minimum of structure, and contain no empty SQL fences.
"""

import re

import pytest

from conftest import ROOT

CHARS_PER_TOKEN = 4
MAX_SKILL_TOKENS = 4000
SKILL_TOKEN_BUDGETS = {
    # Preserve the imported end-to-end migration coordinator and its safety instructions.
    "plugin/skills/migrate-oracle-app/SKILL.md": 8000,
}


def _skill_files():
    files = list(ROOT.rglob("SKILL.md"))
    refs_dir = ROOT / "plugin" / "skills" / "postgresql-best-practices" / "references"
    if refs_dir.exists():
        files.extend(sorted(refs_dir.glob("*.md")))
    return files


SKILL_FILES = _skill_files()
SKILL_IDS = [str(f.relative_to(ROOT)) for f in SKILL_FILES]


def test_skill_files_found():
    assert SKILL_FILES, "no SKILL.md or reference files found"


@pytest.mark.parametrize("path", SKILL_FILES, ids=SKILL_IDS)
def test_skill_within_budget_and_structured(path):
    content = path.read_text(encoding="utf-8", errors="ignore")
    rel = path.relative_to(ROOT)

    tokens = len(content) // CHARS_PER_TOKEN
    budget = SKILL_TOKEN_BUDGETS.get(rel.as_posix(), MAX_SKILL_TOKENS)
    assert tokens <= budget, f"{rel}: ~{tokens} tokens (max {budget})"

    headers = re.findall(r"^#{1,3}\s+(.+)", content, re.MULTILINE)
    assert len(headers) >= 2, f"{rel}: too few sections (only {len(headers)} headers)"

    empty_sql = re.findall(r"```sql\s*```", content)
    assert not empty_sql, f"{rel}: contains {len(empty_sql)} empty SQL blocks"
