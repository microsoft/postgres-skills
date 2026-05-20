"""Cursor routing simulation."""

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


class CursorAdapter(HostAdapter):
    """Simulate Cursor using SKILL.md as rules context."""

    def __init__(self, skill_md_path: Path | None = None):
        self.skill_md_path = skill_md_path

    def name(self) -> str:
        return "cursor"

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
            "Cursor keeps SKILL.md in context and routes references from its keyword table.\n\n"
            f"User query: {query}\n\n"
            "Routing context:\n"
            f"{skill_content}"
        )
