# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Brand terminology and spelling consistency across markdown files.

Code blocks, inline code, URLs, and front matter are stripped before matching so
only prose is checked.
"""

import re

import pytest

from conftest import ROOT

# (wrong_pattern, correct_form, description); correct_form None => informational only
TERMINOLOGY_RULES = [
    (r"\bazure\s+ad\b(?!\s*B2C)", "Entra ID", "Azure AD renamed to Entra ID (except Azure AD B2C)"),
    (r"\bflexible\s+server\b(?![\s\.])", "Flexible Server", "Capitalize: Flexible Server"),
    (r"\bsingle\s+server\b", "Single Server", "Single Server is retired; remove references entirely"),
    (r"\bAzure\s+Database\s+for\s+Postgresql\b", "Azure Database for PostgreSQL", "Capital SQL in PostgreSQL"),
    (r"\bpostgresql\b(?=[^_\-/])", None, None),
    (r"\bPgBouncer\b", None, None),
    (r"(?<![-_/])\bpgbouncer\b(?![\._\-/]|\s*\.conf)", "PgBouncer", "Capitalize PgBouncer"),
    (r"(?<![-_/])\bdiskann\b(?![\._\-/])", "DiskANN", "Capitalize: DiskANN (except in code/identifiers)"),
    (r"(?<![-_/])\bhnsw\b(?![\._\-/])", "HNSW", "All caps: HNSW"),
    (r"\bGithub\b", "GitHub", "Capital H: GitHub"),
    (r"\bpostgress\b", "PostgreSQL/Postgres", "Misspelling: postgress"),
    (r"\bpostges\b", "PostgreSQL/Postgres", "Misspelling: postges"),
    (r"\brecieve\b", "receive", "Misspelling: recieve"),
    (r"\boccured\b", "occurred", "Misspelling: occured"),
    (r"\bseperately\b", "separately", "Misspelling: seperately"),
]

CODE_BLOCK_PATTERN = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_PATTERN = re.compile(r"`[^`]+`")
URL_PATTERN = re.compile(r"https?://\S+")
FRONTMATTER_PATTERN = re.compile(r"^---\r?\n.*?\r?\n---\r?\n", re.DOTALL)

def _strip_code(content: str) -> str:
    content = FRONTMATTER_PATTERN.sub(" ", content, count=1)
    content = CODE_BLOCK_PATTERN.sub(" ", content)
    content = INLINE_CODE_PATTERN.sub(" ", content)
    content = URL_PATTERN.sub(" ", content)
    return content


def _md_files():
    files = ROOT.rglob("*.md")
    return [f for f in files if ".git" not in str(f) and "node_modules" not in str(f)]


MD_FILES = _md_files()
MD_IDS = [str(f.relative_to(ROOT)) for f in MD_FILES]


@pytest.mark.parametrize("path", MD_FILES, ids=MD_IDS)
def test_terminology_consistent(path):
    clean = _strip_code(path.read_text(encoding="utf-8", errors="ignore"))
    issues = []
    for line_no, line in enumerate(clean.splitlines(), 1):
        for pattern, correct, desc in TERMINOLOGY_RULES:
            if correct is None:
                continue
            for match in re.finditer(pattern, line, re.IGNORECASE):
                if match.group(0) == correct:
                    continue
                issues.append(f'{path.relative_to(ROOT)}:{line_no} — "{match.group(0)}" → {correct} ({desc})')
    assert not issues, "terminology issues:\n" + "\n".join(issues)
