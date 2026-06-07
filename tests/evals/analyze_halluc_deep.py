# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""Deep hallucination analysis: test vs control overlap."""
import json
from pathlib import Path

results_path = Path("tests/evals/results/results_20260522_195729.json")
with open(results_path, encoding="utf-8") as f:
    data = json.load(f)

test_h = [e for e in data if e["group"] == "test" and e.get("hallucinations")]
ctrl_h = [e for e in data if e["group"] == "control" and e.get("hallucinations")]

print("TEST GROUP (with skill):")
print(f"  Challenges: {len(test_h)}, instances: {sum(len(e['hallucinations']) for e in test_h)}")
print()
print("CONTROL GROUP (no skill):")
print(f"  Challenges: {len(ctrl_h)}, instances: {sum(len(e['hallucinations']) for e in ctrl_h)}")
print()

test_ids = {e["challenge_id"] for e in test_h}
ctrl_ids = {e["challenge_id"] for e in ctrl_h}
both = test_ids & ctrl_ids
test_only = test_ids - ctrl_ids
ctrl_only = ctrl_ids - test_ids

print(f"Both groups hallucinate: {len(both)} challenges")
print(f"Test-only hallucinations: {len(test_only)} (skill CAUSED these)")
print(f"Control-only hallucinations: {len(ctrl_only)} (skill PREVENTED these)")
print()

def short_pattern(h):
    p = h["pattern"] if isinstance(h, dict) else str(h)
    # Simplify long regex patterns
    simple_map = {
        "pg_hba": "pg_hba.conf",
        "postgresql\\.conf": "postgresql.conf",
        "pg_basebackup": "pg_basebackup",
        "systemctl": "systemctl",
        "sudo": "sudo",
        "/var/lib/postgresql": "/var/lib/postgresql",
        "ALTER\\s+SYSTEM": "ALTER SYSTEM",
        "CREATE\\s+EXTENSION": "CREATE EXTENSION (non-allowlisted)",
        "pg_catalog": "pg_catalog (non-allowlisted)",
        "SET\\s+": "SET (postmaster param)",
    }
    for key, label in simple_map.items():
        if key in p:
            return label
    return p[:50]

print("=" * 60)
print("TEST-ONLY (skill CAUSED these - top priority to fix)")
print("=" * 60)
for e in sorted(test_h, key=lambda x: x["challenge_id"]):
    if e["challenge_id"] in test_only:
        patterns = [short_pattern(h) for h in e["hallucinations"]]
        print(f"  {e['challenge_id']}: {patterns}")

print()
print("=" * 60)
print("BOTH GROUPS (model tendency, skill did NOT prevent)")
print("=" * 60)
for e in sorted(test_h, key=lambda x: x["challenge_id"]):
    if e["challenge_id"] in both:
        # Compare counts
        ctrl_entry = next(c for c in ctrl_h if c["challenge_id"] == e["challenge_id"])
        t_count = len(e["hallucinations"])
        c_count = len(ctrl_entry["hallucinations"])
        patterns = [short_pattern(h) for h in e["hallucinations"]]
        delta = "same" if t_count == c_count else f"test={t_count} ctrl={c_count}"
        print(f"  {e['challenge_id']}: {patterns} ({delta})")

print()
print("=" * 60)
print("CONTROL-ONLY (skill PREVENTED these - success stories)")
print("=" * 60)
for e in sorted(ctrl_h, key=lambda x: x["challenge_id"]):
    if e["challenge_id"] in ctrl_only:
        patterns = [short_pattern(h) for h in e["hallucinations"]]
        print(f"  {e['challenge_id']}: {patterns}")

# Summary of which challenges the skill made WORSE
print()
print("=" * 60)
print("SUMMARY: Challenges where skill increased hallucination count")
print("=" * 60)
by_id = {}
for e in data:
    cid = e["challenge_id"]
    if cid not in by_id:
        by_id[cid] = {}
    by_id[cid][e["group"]] = len(e.get("hallucinations", []))

worse = []
for cid, groups in by_id.items():
    t = groups.get("test", 0)
    c = groups.get("control", 0)
    if t > c:
        worse.append((cid, t, c))

worse.sort(key=lambda x: -(x[1] - x[2]))
print(f"  Total: {len(worse)} challenges where test > control on hallucinations")
for cid, t, c in worse[:15]:
    print(f"  {cid}: test={t} control={c} (+{t-c})")
