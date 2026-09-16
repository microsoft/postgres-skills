# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Repository structure and manifest validation.

Ported from the inline Python/bash in the ci.yml ``validate-manifests`` job:
marketplace manifests must be valid JSON, the single-plugin layout must contain
all required files, and there must be a healthy number of reference files.
"""

import json

import pytest

from conftest import ROOT

MARKETPLACE_MANIFESTS = [
    ".github/plugin/marketplace.json",
    ".claude-plugin/marketplace.json",
    ".agents/plugins/marketplace.json",
]

JSON_FILES = [
    "plugin/.mcp.json",
    "plugin/.claude-plugin/plugin.json",
    "plugin/.codex-plugin/plugin.json",
    "tests/.skills.json",
]

REQUIRED_FILES = [
    "README.md",
    "plugin/.mcp.json",
    "plugin/SETUP.md",
    "plugin/.claude-plugin/plugin.json",
    "plugin/skills/postgresql-best-practices/SKILL.md",
]

MIN_REFERENCE_FILES = 10


@pytest.mark.parametrize("rel", MARKETPLACE_MANIFESTS + JSON_FILES)
def test_json_is_parseable(rel):
    path = ROOT / rel
    assert path.exists(), f"missing JSON file: {rel}"
    assert not path.is_symlink(), f"marketplace manifests must be regular files: {rel}"
    json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("rel", REQUIRED_FILES)
def test_required_file_exists(rel):
    assert (ROOT / rel).is_file(), f"missing required file: {rel}"


def test_reference_file_count():
    refs_dir = ROOT / "plugin" / "skills" / "postgresql-best-practices" / "references"
    refs = list(refs_dir.glob("*.md"))
    assert len(refs) >= MIN_REFERENCE_FILES, (
        f"expected at least {MIN_REFERENCE_FILES} reference files, found {len(refs)}"
    )


def test_release_versions_match():
    marketplace = json.loads(
        (ROOT / ".github" / "plugin" / "marketplace.json").read_text(encoding="utf-8")
    )
    claude_plugin = json.loads(
        (ROOT / "plugin" / ".claude-plugin" / "plugin.json").read_text(
            encoding="utf-8"
        )
    )
    codex_plugin = json.loads(
        (ROOT / "plugin" / ".codex-plugin" / "plugin.json").read_text(
            encoding="utf-8"
        )
    )

    versions = {
        marketplace["metadata"]["version"],
        marketplace["plugins"][0]["version"],
        claude_plugin["version"],
        codex_plugin["version"],
    }
    assert len(versions) == 1, f"release versions must match, found: {sorted(versions)}"


def test_marketplace_manifests_match():
    manifests = [
        json.loads((ROOT / rel).read_text(encoding="utf-8"))
        for rel in MARKETPLACE_MANIFESTS
    ]
    assert all(manifest == manifests[0] for manifest in manifests[1:]), (
        "marketplace manifests must remain identical across supported hosts"
    )
