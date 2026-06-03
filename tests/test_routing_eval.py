# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Routing-accuracy smoke test across all host adapters.

Native port of the former ``tests/evals/routing_eval.py`` invocation (previously
run via subprocess). Loads the routing challenge set and drives every host adapter
(Copilot CLI, Claude Code, Codex CLI) over every challenge, asserting the adapters
load and route end-to-end without error and return well-formed results.
"""

import sys
from pathlib import Path

import pytest
import yaml

from conftest import ROOT

EVALS_DIR = ROOT / "tests" / "evals"
sys.path.insert(0, str(EVALS_DIR))

from host_adapters import RoutingResult  # noqa: E402
from host_adapters.claude_code import ClaudeCodeAdapter  # noqa: E402
from host_adapters.codex_cli import CodexCLIAdapter  # noqa: E402
from host_adapters.copilot_cli import CopilotCLIAdapter  # noqa: E402

SKILLS_JSON = ROOT / "tests" / ".skills.json"
SKILL_MD = ROOT / "plugin" / "skills" / "postgresql-best-practices" / "SKILL.md"
MARKETPLACE = ROOT / ".github" / "plugin" / "marketplace.json"
CHALLENGES = EVALS_DIR / "challenges" / "routing_challenges.yaml"


def _load_challenges():
    data = yaml.safe_load(CHALLENGES.read_text(encoding="utf-8")) or {}
    return [(e["id"], e["query"]) for e in data.get("routing_challenges", [])]


def _adapters():
    return {
        "copilot-cli": CopilotCLIAdapter(skills_json_path=SKILLS_JSON),
        "claude-code": ClaudeCodeAdapter(skill_md_path=SKILL_MD),
        "codex-cli": CodexCLIAdapter(marketplace_path=MARKETPLACE, skills_json_path=SKILLS_JSON),
    }


CHALLENGES_LIST = _load_challenges()


def test_routing_challenges_present():
    assert CHALLENGES_LIST, "no routing challenges loaded"


@pytest.mark.parametrize("host", ["copilot-cli", "claude-code", "codex-cli"])
def test_host_routes_all_challenges(host):
    adapter = _adapters()[host]
    for cid, query in CHALLENGES_LIST:
        result = adapter.route(query, ROOT)
        assert isinstance(result, RoutingResult), f"{host}/{cid}: no RoutingResult"
        assert isinstance(result.activated_skills, list), f"{host}/{cid}: activated_skills not a list"
        assert isinstance(result.routing_method, str), f"{host}/{cid}: routing_method not a str"
        assert isinstance(result.confidence, (int, float)), f"{host}/{cid}: confidence not numeric"
        assert all(isinstance(s, str) for s in result.activated_skills), f"{host}/{cid}: non-str skill"
