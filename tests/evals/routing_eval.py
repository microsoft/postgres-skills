# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""
Routing Eval: Measures skill activation accuracy.
Tests whether the correct skill is loaded for a given user query.

Usage:
    python tests/evals/routing_eval.py [--skills-json PATH] [--challenges PATH] [--host HOST]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

EVALS_DIR = Path(__file__).resolve().parent
REPO_ROOT = EVALS_DIR.parents[1]
DEFAULT_SKILLS_JSON = REPO_ROOT / ".skills.json"
DEFAULT_SKILL_MD = REPO_ROOT / "skills" / "SKILL.md"
DEFAULT_MARKETPLACE = REPO_ROOT / "marketplace.json"
DEFAULT_CHALLENGES = EVALS_DIR / "challenges" / "routing_challenges.yaml"
DEFAULT_RESULTS = EVALS_DIR / "results" / "routing_latest.json"

sys.path.insert(0, str(EVALS_DIR))
from host_adapters import (  # noqa: E402
    normalize_skill_path,
    parse_skill_routing_table,
    parse_skills_manifest,
    unique_paths,
)
from host_adapters.claude_code import ClaudeCodeAdapter  # noqa: E402
from host_adapters.codex_cli import CodexCLIAdapter  # noqa: E402
from host_adapters.copilot_cli import CopilotCLIAdapter  # noqa: E402


APPROXIMATE_HOSTS = {"claude-code"}


@dataclass
class RoutingChallenge:
    id: str
    query: str
    expected_skill: str | None
    difficulty: str
    notes: str = ""
    expected_not: list[str] | None = None


@dataclass
class ChallengeEvaluation:
    id: str
    query: str
    expected_skill: str | None
    activated_skills: list[str]
    matched: bool
    misroute: bool
    no_match_failure: bool
    unexpected_activations: list[str]
    forbidden_hits: list[str]
    routing_method: str
    confidence: float
    notes: str


@dataclass
class HostMetrics:
    host: str
    total_challenges: int
    positive_challenges: int
    total_activations: int
    correct_activations: int
    misroutes: int
    no_match_failures: int
    precision: float
    recall: float
    f1: float
    false_routing_rate: float
    no_match_rate: float
    evaluations: list[ChallengeEvaluation]


def load_challenges(path: Path) -> list[RoutingChallenge]:
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    challenges = []
    for entry in data.get("routing_challenges", []):
        expected_not = entry.get("expected_not")
        if isinstance(expected_not, str):
            expected_not = [expected_not]
        challenges.append(
            RoutingChallenge(
                id=entry["id"],
                query=entry["query"],
                expected_skill=normalize_skill_path(entry["expected_skill"]) if entry.get("expected_skill") else None,
                difficulty=entry.get("difficulty", "unknown"),
                notes=entry.get("notes", ""),
                expected_not=[normalize_skill_path(item) for item in expected_not] if expected_not else [],
            )
        )
    return challenges


def get_adapter(host: str, skills_json_path: Path, skill_md_path: Path, marketplace_path: Path):
    if host == "copilot-cli":
        return CopilotCLIAdapter(skills_json_path=skills_json_path)
    if host == "claude-code":
        return ClaudeCodeAdapter(skill_md_path=skill_md_path)
    if host == "codex-cli":
        return CodexCLIAdapter(marketplace_path=marketplace_path, skills_json_path=skills_json_path)
    raise ValueError(f"Unsupported host: {host}")


def compute_f1(precision: float, recall: float) -> float:
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def evaluate_host(host: str, challenges: list[RoutingChallenge], skills_root: Path, skills_json_path: Path, skill_md_path: Path, marketplace_path: Path) -> HostMetrics:
    adapter = get_adapter(host, skills_json_path, skill_md_path, marketplace_path)
    evaluations: list[ChallengeEvaluation] = []
    total_activations = 0
    correct_activations = 0
    misroutes = 0
    no_match_failures = 0
    positive_challenges = sum(1 for challenge in challenges if challenge.expected_skill)

    for challenge in challenges:
        routing_result = adapter.route(challenge.query, skills_root)
        activated = unique_paths(routing_result.activated_skills)
        matched = bool(challenge.expected_skill and challenge.expected_skill in activated)
        unexpected = []
        if challenge.expected_skill:
            unexpected = [skill for skill in activated if skill != challenge.expected_skill]
        else:
            unexpected = list(activated)
        forbidden_hits = [skill for skill in activated if skill in (challenge.expected_not or [])]
        misroute = bool(unexpected or forbidden_hits)
        no_match_failure = bool(challenge.expected_skill and not activated)

        total_activations += len(activated)
        correct_activations += int(matched)
        misroutes += int(misroute)
        no_match_failures += int(no_match_failure)

        evaluations.append(
            ChallengeEvaluation(
                id=challenge.id,
                query=challenge.query,
                expected_skill=challenge.expected_skill,
                activated_skills=activated,
                matched=matched,
                misroute=misroute,
                no_match_failure=no_match_failure,
                unexpected_activations=unexpected,
                forbidden_hits=forbidden_hits,
                routing_method=routing_result.routing_method,
                confidence=routing_result.confidence,
                notes=challenge.notes,
            )
        )

    precision = (correct_activations / total_activations) if total_activations else 0.0
    recall = (correct_activations / positive_challenges) if positive_challenges else 0.0
    f1 = compute_f1(precision, recall)

    return HostMetrics(
        host=host,
        total_challenges=len(challenges),
        positive_challenges=positive_challenges,
        total_activations=total_activations,
        correct_activations=correct_activations,
        misroutes=misroutes,
        no_match_failures=no_match_failures,
        precision=precision,
        recall=recall,
        f1=f1,
        false_routing_rate=(misroutes / len(challenges)) if challenges else 0.0,
        no_match_rate=(no_match_failures / len(challenges)) if challenges else 0.0,
        evaluations=evaluations,
    )


def collect_ruleset_disagreements(challenges: list[RoutingChallenge], skills_json_path: Path, skill_md_path: Path) -> list[dict[str, Any]]:
    manifest_rules = parse_skills_manifest(skills_json_path)
    skill_table_rules = parse_skill_routing_table(skill_md_path)
    disagreements: list[dict[str, Any]] = []

    for challenge in challenges:
        manifest_matches = unique_paths(rule.skill_path for rule in manifest_rules if any(keyword and keyword in challenge.query.lower() for keyword in rule.keywords))
        skill_table_matches = unique_paths(rule.skill_path for rule in skill_table_rules if any(keyword and keyword in challenge.query.lower() for keyword in rule.keywords))
        if manifest_matches != skill_table_matches:
            disagreements.append(
                {
                    "id": challenge.id,
                    "query": challenge.query,
                    "manifest_matches": manifest_matches,
                    "skill_md_matches": skill_table_matches,
                }
            )
    return disagreements


def print_host_report(metrics: HostMetrics) -> None:
    print(f"ROUTING EVAL RESULTS — {metrics.host}")
    print("=" * (24 + len(metrics.host)))
    print(f"Total challenges: {metrics.total_challenges}")
    print(f"Precision: {metrics.precision * 100:.1f}%")
    print(f"Recall: {metrics.recall * 100:.1f}%")
    print(f"F1: {metrics.f1 * 100:.1f}%")
    print(f"False routing: {metrics.misroutes}/{metrics.total_challenges} ({metrics.false_routing_rate * 100:.1f}%)")
    print(f"No-match failures: {metrics.no_match_failures}/{metrics.total_challenges} ({metrics.no_match_rate * 100:.1f}%)")
    if metrics.host in APPROXIMATE_HOSTS:
        print("Note: This host is approximated with keyword simulation because actual routing is LLM-mediated.")

    misroutes = [evaluation for evaluation in metrics.evaluations if evaluation.misroute]
    unrouted = [evaluation for evaluation in metrics.evaluations if evaluation.no_match_failure]

    if misroutes:
        print("\nMISROUTES:")
        for evaluation in misroutes[:10]:
            expected = evaluation.expected_skill or "null"
            got = ", ".join(evaluation.activated_skills) or "none"
            print(f"  {evaluation.id}: expected={expected}, got={got}")
    if unrouted:
        print("\nUNROUTED (expected skill but nothing matched):")
        for evaluation in unrouted[:10]:
            print(f"  {evaluation.id}: expected={evaluation.expected_skill}, query=\"{evaluation.query}\"")
    print()


def print_host_comparison(metrics_by_host: dict[str, HostMetrics]) -> None:
    print("HOST ROUTING COMPARISON")
    print("=======================")
    print(f"{'Host':<13} {'Precision':<10} {'Recall':<8} {'F1':<7} Misroutes")
    for host, metrics in metrics_by_host.items():
        print(
            f"{host:<13} "
            f"{metrics.precision * 100:>6.1f}%   "
            f"{metrics.recall * 100:>6.1f}% "
            f"{metrics.f1 * 100:>6.1f}% "
            f"{metrics.misroutes:>9}"
        )
    print()
    approx_hosts = [host for host in metrics_by_host if host in APPROXIMATE_HOSTS]
    if approx_hosts:
        print("Approximation note:")
        print(f"  {', '.join(approx_hosts)} simulate LLM-driven routing with keyword matching against SKILL.md.")
        print()


def print_disagreements(disagreements: list[dict[str, Any]]) -> None:
    print("RULESET DISAGREEMENTS (.skills.json vs SKILL.md)")
    print("=============================================")
    print(f"Queries with different matches: {len(disagreements)}")
    for item in disagreements[:10]:
        print(f"  {item['id']}: manifest={item['manifest_matches'] or ['none']} | skill_md={item['skill_md_matches'] or ['none']}")
    print()


def save_results(path: Path, args: argparse.Namespace, challenges: list[RoutingChallenge], metrics_by_host: dict[str, HostMetrics], disagreements: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "host": args.host,
        "skills_json": str(args.skills_json),
        "challenges": str(args.challenges),
        "total_challenges": len(challenges),
        "hosts": {
            host: {
                **{key: value for key, value in asdict(metrics).items() if key != "evaluations"},
                "evaluations": [asdict(evaluation) for evaluation in metrics.evaluations],
            }
            for host, metrics in metrics_by_host.items()
        },
        "ruleset_disagreements": disagreements,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate routing accuracy across hosts.")
    parser.add_argument("--skills-json", type=Path, default=DEFAULT_SKILLS_JSON)
    parser.add_argument("--challenges", type=Path, default=DEFAULT_CHALLENGES)
    parser.add_argument("--host", choices=["copilot-cli", "claude-code", "codex-cli", "all"], default="all")
    parser.add_argument("--output", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--skill-md", type=Path, default=DEFAULT_SKILL_MD)
    parser.add_argument("--marketplace", type=Path, default=DEFAULT_MARKETPLACE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    challenges = load_challenges(args.challenges)
    if not challenges:
        print("No routing challenges found.", file=sys.stderr)
        return 1

    hosts = [args.host] if args.host != "all" else ["copilot-cli", "claude-code", "codex-cli"]
    metrics_by_host = {
        host: evaluate_host(
            host=host,
            challenges=challenges,
            skills_root=REPO_ROOT,
            skills_json_path=args.skills_json,
            skill_md_path=args.skill_md,
            marketplace_path=args.marketplace,
        )
        for host in hosts
    }
    disagreements = collect_ruleset_disagreements(challenges, args.skills_json, args.skill_md)

    if args.host == "all":
        print_host_comparison(metrics_by_host)
        for host in hosts:
            print_host_report(metrics_by_host[host])
    else:
        print_host_report(metrics_by_host[args.host])
    print_disagreements(disagreements)
    save_results(args.output, args, challenges, metrics_by_host, disagreements)
    print(f"Saved routing results to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
