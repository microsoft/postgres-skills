# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""
Eval-score regression guard.

After the judge pipeline writes ``tests/evals/results/latest.json``, no
skill/reference may have a critically low average judge score. Exits non-zero
when any skill falls below the threshold; exits 0 (with a note) when the results
file is absent.

Usage:
    python tests/evals/eval_regression.py [--results PATH] [--min-score FLOAT]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

EVALS_DIR = Path(__file__).resolve().parent
DEFAULT_RESULTS = EVALS_DIR / "results" / "latest.json"
DEFAULT_MIN_JUDGE_SCORE = 0.5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Guard against eval judge-score regressions.")
    parser.add_argument("--results", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--min-score", type=float, default=DEFAULT_MIN_JUDGE_SCORE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.results.exists():
        print(f"No eval results ({args.results} absent) — skipping regression guard.")
        return 0

    results = json.loads(args.results.read_text(encoding="utf-8"))
    per_skill = results.get("per_skill", {})
    regressions = {
        sid: m["avg_judge_score"]
        for sid, m in per_skill.items()
        if m.get("avg_judge_score") is not None and m["avg_judge_score"] < args.min_score
    }

    if regressions:
        print(f"FAIL — skills with critically low judge scores (< {args.min_score:.2f}):")
        for sid, score in sorted(regressions.items(), key=lambda x: x[1]):
            print(f"  {sid}={score:.3f}")
        return 1

    print(f"PASS — all {len(per_skill)} skills meet the minimum judge score ({args.min_score:.2f}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
