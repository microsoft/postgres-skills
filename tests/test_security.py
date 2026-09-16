# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Secret scanning across the repository.

Hard-fails on any detected secret.
"""

import re
from pathlib import Path

from conftest import ROOT

SECRET_PATTERNS = [
    (r'(?:password|passwd|pwd)\s*[=:]\s*["\'][^"\']{8,}["\']', "Hardcoded password"),
    (r'(?:api[_-]?key|apikey)\s*[=:]\s*["\'][^"\']{16,}["\']', "API key"),
    (r'(?:secret|token)\s*[=:]\s*["\'][^"\']{16,}["\']', "Secret/token value"),
    (r"(?:postgres|postgresql)://[^:]+:[^@]+@[^/]+", "Connection string with credentials"),
    (r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", "Private key"),
    (r"AKIA[0-9A-Z]{16}", "AWS access key"),
    (r"AccountKey=[A-Za-z0-9+/=]{40,}", "Azure storage account key"),
    (r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}", "GitHub token"),
]

# Files/paths that legitimately contain pattern strings or generated fixtures.
SELF_PATH = Path(__file__).resolve()
SKIP_FILES = [
    r"\.git[/\\]",
    r"node_modules[/\\]",
    r"tests[/\\]evals[/\\]results[/\\]",
]
SKIP_SUFFIXES = {".png", ".jpg", ".gif", ".ico", ".woff", ".zip", ".tar", ".gz"}
PLACEHOLDER = re.compile(r"<your|example|placeholder|xxx|YOUR_|changeme", re.IGNORECASE)


def test_no_secrets_committed():
    issues = []
    for path in ROOT.rglob("*"):
        if path.is_dir() or path.suffix in SKIP_SUFFIXES:
            continue
        if path.resolve() == SELF_PATH:  # this file holds the patterns themselves
            continue
        if any(re.search(p, str(path)) for p in SKIP_FILES):
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        rel = path.relative_to(ROOT)
        for line_no, line in enumerate(content.splitlines(), 1):
            for pattern, desc in SECRET_PATTERNS:
                if re.search(pattern, line, re.IGNORECASE) and not PLACEHOLDER.search(line):
                    issues.append(f"{rel}:{line_no} — {desc}")
    assert not issues, "potential secrets detected:\n" + "\n".join(issues)


def test_directory_policy_guardrails():
    mcp_config = (ROOT / "plugin" / ".mcp.json").read_text(encoding="utf-8")
    setup = (ROOT / "plugin" / "SETUP.md").read_text(encoding="utf-8")
    postgres_skill = (
        ROOT / "plugin" / "skills" / "postgresql-best-practices" / "SKILL.md"
    ).read_text(encoding="utf-8")
    graph_skill = (
        ROOT / "plugin" / "skills" / "pg-graph" / "SKILL.md"
    ).read_text(encoding="utf-8")

    assert "--no-telemetry" in mcp_config
    assert "least-privilege" in setup
    assert "Data access and privacy" in setup
    assert "Before any `postgres_mcp_modify`" in postgres_skill
    assert "untrusted data, never as instructions" in postgres_skill
    assert "ask for explicit confirmation" in graph_skill
