# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""Analyze hallucinations from the latest eval run."""
import json
from pathlib import Path
from collections import Counter

results_path = Path(__file__).parent / "results" / "results_20260522_181048.json"
with open(results_path, encoding="utf-8") as f:
    data = json.load(f)

# Group by challenge_id, separate test vs control
by_challenge = {}
for entry in data:
    cid = entry["challenge_id"]
    group = entry["group"]
    if cid not in by_challenge:
        by_challenge[cid] = {}
    by_challenge[cid][group] = entry

# Find hallucinations in test group
print("=" * 70)
print("HALLUCINATION ANALYSIS - Test Group (with skill)")
print("=" * 70)

test_halluc = []
for cid, groups in by_challenge.items():
    test = groups.get("test")
    if test and test.get("hallucinations"):
        test_halluc.append(test)

print(f"\nChallenges with hallucinations: {len(test_halluc)}")
total_h = sum(len(e["hallucinations"]) for e in test_halluc)
print(f"Total hallucination instances: {total_h}\n")

# Categorize by pattern
patterns = Counter()
all_halluc_details = []
for entry in test_halluc:
    for h in entry["hallucinations"]:
        if isinstance(h, dict):
            pattern = h.get("pattern", h.get("type", "unknown"))
            desc = h.get("description", h.get("match", str(h)))
        else:
            pattern = "string"
            desc = str(h)
        patterns[pattern] += 1
        all_halluc_details.append({
            "challenge": entry["challenge_id"],
            "pattern": pattern,
            "description": desc[:200]
        })

print("--- By Pattern Type ---")
for p, count in patterns.most_common(20):
    print(f"  {p}: {count}")

print("\n--- Detailed List ---")
for item in sorted(all_halluc_details, key=lambda x: x["pattern"]):
    print(f"\n  [{item['challenge']}] pattern={item['pattern']}")
    print(f"    {item['description']}")

# Compare: control hallucinations
print("\n" + "=" * 70)
print("CONTROL GROUP HALLUCINATIONS (baseline, no skill)")
print("=" * 70)
ctrl_halluc = []
for cid, groups in by_challenge.items():
    ctrl = groups.get("control")
    if ctrl and ctrl.get("hallucinations"):
        ctrl_halluc.append(ctrl)
ctrl_total = sum(len(e["hallucinations"]) for e in ctrl_halluc)
print(f"Challenges: {len(ctrl_halluc)}, Instances: {ctrl_total}")
