# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""
Host adapters simulate how different AI coding agents load and route skills.
Each adapter implements the same interface but with host-specific loading logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
import json
import re
from typing import Iterable


@dataclass
class RoutingResult:
    """Result of host routing for a given query."""

    activated_skills: list[str]
    loaded_content: str
    routing_method: str
    confidence: float


@dataclass(frozen=True)
class RoutingRule:
    """Keyword rule resolved to a repo-relative skill path."""

    skill_path: str
    keywords: tuple[str, ...]
    source: str


class HostAdapter(ABC):
    """Base class for host-specific skill loading simulation."""

    @abstractmethod
    def name(self) -> str:
        """Host name (for example, 'copilot-cli')."""

    @abstractmethod
    def route(self, query: str, skills_root: Path) -> RoutingResult:
        """Given a user query, determine which skills to load."""

    @abstractmethod
    def build_system_prompt(self, query: str, skill_content: str) -> str:
        """Build the system prompt as this host would construct it."""


def normalize_skill_path(path: str) -> str:
    """Normalize a skill or reference path to repo-relative form without .md."""

    normalized = path.replace("\\", "/").strip().lstrip("./")
    if normalized.startswith("references/"):
        normalized = f"plugin/skills/postgresql-best-practices/{normalized}"
    if normalized.endswith(".md"):
        normalized = normalized[:-3]
    return normalized


def unique_paths(paths: Iterable[str]) -> list[str]:
    """Return a stable, de-duplicated list of normalized paths."""

    seen: set[str] = set()
    ordered: list[str] = []
    for path in paths:
        normalized = normalize_skill_path(path)
        if normalized and normalized not in seen:
            seen.add(normalized)
            ordered.append(normalized)
    return ordered


def load_skill_content(skills_root: Path, skill_path: str) -> str:
    """Load repo-relative skill content, returning an empty string when missing."""

    normalized = normalize_skill_path(skill_path)
    candidates = [skills_root / f"{normalized}.md"]
    if normalized.endswith("/SKILL"):
        candidates.insert(0, skills_root / normalized)
    for candidate in candidates:
        if candidate.exists():
            return candidate.read_text(encoding="utf-8")
    return ""


def build_loaded_content(skills_root: Path, skill_paths: Iterable[str], include_root_skill: bool = False) -> str:
    """Combine loaded skill content into one string."""

    parts: list[str] = []
    if include_root_skill:
        root_content = load_skill_content(skills_root, "plugin/skills/postgresql-best-practices/SKILL")
        if root_content:
            parts.append(root_content)
    for skill_path in unique_paths(skill_paths):
        content = load_skill_content(skills_root, skill_path)
        if content:
            parts.append(content)
    return "\n\n".join(parts)


def _split_keywords(raw_keywords: str) -> tuple[str, ...]:
    keywords = []
    for chunk in re.split(r",|\n", raw_keywords):
        keyword = chunk.strip().strip("`").strip()
        if keyword:
            keywords.append(keyword.lower())
    return tuple(keywords)


def parse_skills_manifest(manifest_path: Path) -> list[RoutingRule]:
    """Parse .skills.json activation keywords into routing rules."""

    with manifest_path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    rules: list[RoutingRule] = []
    for skill in data.get("skills", []):
        rules.append(
            RoutingRule(
                skill_path=normalize_skill_path(skill.get("path", "")),
                keywords=tuple(str(keyword).lower() for keyword in skill.get("activation_keywords", [])),
                source=".skills.json",
            )
        )
    return rules


def parse_skill_routing_table(skill_md_path: Path) -> list[RoutingRule]:
    """Parse keyword triggers from plugin/skills/postgresql-best-practices/SKILL.md markdown tables."""

    content = skill_md_path.read_text(encoding="utf-8")
    pattern = re.compile(r"^\|\s*(.+?)\s*\|\s*\[[^\]]+\]\((references/[^)]+\.md)\)\s*\|", re.MULTILINE)

    rules: list[RoutingRule] = []
    for match in pattern.finditer(content):
        keywords_cell = match.group(1).strip()
        if keywords_cell.startswith("---"):
            continue
        rules.append(
            RoutingRule(
                skill_path=normalize_skill_path(match.group(2)),
                keywords=_split_keywords(keywords_cell),
                source="plugin/skills/postgresql-best-practices/SKILL.md",
            )
        )
    return rules


def collect_matching_rules(query: str, rules: Iterable[RoutingRule]) -> list[RoutingRule]:
    """Return rules whose keywords appear in the query via substring match."""

    query_lower = query.lower()
    matched: list[RoutingRule] = []
    for rule in rules:
        if any(keyword and keyword in query_lower for keyword in rule.keywords):
            matched.append(rule)
    return matched


def confidence_from_matches(matches: Iterable[RoutingRule]) -> float:
    """Compute a coarse confidence score from the number of matching rules."""

    match_count = sum(1 for _ in matches)
    if match_count <= 0:
        return 0.0
    return min(1.0, 0.5 + (0.15 * match_count))


__all__ = [
    "HostAdapter",
    "RoutingResult",
    "RoutingRule",
    "build_loaded_content",
    "collect_matching_rules",
    "confidence_from_matches",
    "load_skill_content",
    "normalize_skill_path",
    "parse_skill_routing_table",
    "parse_skills_manifest",
    "unique_paths",
]
