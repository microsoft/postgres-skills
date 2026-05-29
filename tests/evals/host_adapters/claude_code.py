# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Claude Code routing simulation."""

from __future__ import annotations

from pathlib import Path

from host_adapters import (
    HostAdapter,
    RoutingResult,
    build_loaded_content,
    collect_matching_rules,
    confidence_from_matches,
    parse_skill_routing_table,
    unique_paths,
)


class ClaudeCodeAdapter(HostAdapter):
    """Simulate Claude Code reading SKILL.md and routing from its table."""

    def __init__(self, skill_md_path: Path | None = None):
        self.skill_md_path = skill_md_path

    def name(self) -> str:
        return "claude-code"

    def route(self, query: str, skills_root: Path) -> RoutingResult:
        skill_md_path = self.skill_md_path or (skills_root / "skills" / "SKILL.md")
        matched_rules = collect_matching_rules(query, parse_skill_routing_table(skill_md_path))
        activated_skills = unique_paths(rule.skill_path for rule in matched_rules)
        loaded_content = build_loaded_content(skills_root, activated_skills, include_root_skill=True)
        return RoutingResult(
            activated_skills=activated_skills,
            loaded_content=loaded_content,
            routing_method="SKILL.md routing-table trigger simulation (approximation)",
            confidence=confidence_from_matches(matched_rules),
        )

    def build_system_prompt(self, query: str, skill_content: str) -> str:
        return (
            "Claude Code receives SKILL.md as routing context and relevant references as supplemental material.\n\n"
            f"User query: {query}\n\n"
            "Routing context:\n"
            f"{skill_content}"
        )
