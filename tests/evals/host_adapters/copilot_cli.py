# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Copilot CLI routing simulation."""

from __future__ import annotations

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


class CopilotCLIAdapter(HostAdapter):
    """Simulate Copilot CLI routing via .skills.json activation keywords."""

    def __init__(self, skills_json_path: Path | None = None):
        self.skills_json_path = skills_json_path

    def name(self) -> str:
        return "copilot-cli"

    def route(self, query: str, skills_root: Path) -> RoutingResult:
        manifest_path = self.skills_json_path or (skills_root / "tests" / ".skills.json")
        matched_rules = collect_matching_rules(query, parse_skills_manifest(manifest_path))
        activated_skills = unique_paths(rule.skill_path for rule in matched_rules)
        loaded_content = build_loaded_content(skills_root, activated_skills)
        return RoutingResult(
            activated_skills=activated_skills,
            loaded_content=loaded_content,
            routing_method=".skills.json activation_keywords substring match",
            confidence=confidence_from_matches(matched_rules),
        )

    def build_system_prompt(self, query: str, skill_content: str) -> str:
        return (
            "GitHub Copilot CLI loads matched skills as supplemental context.\n\n"
            f"User query: {query}\n\n"
            "Loaded skill content:\n"
            f"{skill_content}"
        )
