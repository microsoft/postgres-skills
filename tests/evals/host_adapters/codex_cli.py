# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Codex CLI routing simulation."""

from __future__ import annotations

import json
from pathlib import Path

from host_adapters import (
    HostAdapter,
    RoutingResult,
    build_loaded_content,
    collect_matching_rules,
    confidence_from_matches,
    parse_skills_manifest,
    unique_paths,
)


class CodexCLIAdapter(HostAdapter):
    """Simulate Codex CLI marketplace loading followed by .skills.json routing."""

    def __init__(self, marketplace_path: Path | None = None, skills_json_path: Path | None = None):
        self.marketplace_path = marketplace_path
        self.skills_json_path = skills_json_path

    def name(self) -> str:
        return "codex-cli"

    def route(self, query: str, skills_root: Path) -> RoutingResult:
        marketplace_path = self.marketplace_path or (skills_root / "marketplace.json")
        if marketplace_path.exists():
            with marketplace_path.open(encoding="utf-8") as handle:
                json.load(handle)
        manifest_path = self.skills_json_path or (skills_root / ".skills.json")
        matched_rules = collect_matching_rules(query, parse_skills_manifest(manifest_path))
        activated_skills = unique_paths(rule.skill_path for rule in matched_rules)
        loaded_content = build_loaded_content(skills_root, activated_skills)
        return RoutingResult(
            activated_skills=activated_skills,
            loaded_content=loaded_content,
            routing_method="marketplace.json plugin discovery -> .skills.json activation_keywords",
            confidence=confidence_from_matches(matched_rules),
        )

    def build_system_prompt(self, query: str, skill_content: str) -> str:
        return (
            "Codex CLI resolves the plugin from marketplace metadata, then injects matching skills as context.\n\n"
            f"User query: {query}\n\n"
            "Loaded skill content:\n"
            f"{skill_content}"
        )
