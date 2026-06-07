# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""Show remaining hallucinations with matched text."""
import json
from pathlib import Path

with open("tests/evals/results/results_20260522_213335.json", encoding="utf-8") as f:
    data = json.load(f)

test_h = [e for e in data if e["group"] == "test" and e.get("hallucinations")]
ctrl_h = [e for e in data if e["group"] == "control" and e.get("hallucinations")]

test_ids = {e["challenge_id"] for e in test_h}
ctrl_ids = {e["challenge_id"] for e in ctrl_h}
test_only = test_ids - ctrl_ids

t_inst = sum(len(e["hallucinations"]) for e in test_h)
c_inst = sum(len(e["hallucinations"]) for e in ctrl_h)
print(f"Test: {len(test_h)} challenges, {t_inst} instances")
print(f"Control: {len(ctrl_h)} challenges, {c_inst} instances")
print(f"Test-only (skill caused): {len(test_only)}")
print(f"Control-only (skill prevented): {len(ctrl_ids - test_ids)}")
print()

print("=" * 60)
print("ALL TEST HALLUCINATIONS")
print("=" * 60)
for e in sorted(test_h, key=lambda x: x["challenge_id"]):
    caused = " [SKILL CAUSED]" if e["challenge_id"] in test_only else " [both groups]"
    print(f"\n{e['challenge_id']}{caused}:")
    for h in e["hallucinations"]:
        if isinstance(h, dict):
            examples = h.get("examples", [])[:2]
            reason = h.get("reason", "")
            occ = h.get("occurrences", 0)
            print(f"  {reason} (x{occ}): {examples}")
