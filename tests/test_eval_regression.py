# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Eval-score regression guard.

Ported from the inline Python in the ci.yml ``eval-pipeline`` job. After the
judge pipeline writes ``tests/evals/results/latest.json``, no skill/reference
may have a critically low average judge score. Skips when the results file is
absent (e.g. PRs that don't run the Azure-backed pipeline).
"""

import json

import pytest

from conftest import ROOT

LATEST = ROOT / "tests" / "evals" / "results" / "latest.json"
MIN_JUDGE_SCORE = 0.5


@pytest.mark.skipif(not LATEST.exists(), reason="no eval results (latest.json absent)")
def test_no_critical_judge_regressions():
    results = json.loads(LATEST.read_text(encoding="utf-8"))
    per_skill = results.get("per_skill", {})
    regressions = {
        sid: m["avg_judge_score"]
        for sid, m in per_skill.items()
        if m.get("avg_judge_score") is not None and m["avg_judge_score"] < MIN_JUDGE_SCORE
    }
    assert not regressions, (
        "skills with critically low judge scores (< 0.50): "
        + ", ".join(f"{s}={v:.3f}" for s, v in sorted(regressions.items(), key=lambda x: x[1]))
    )
