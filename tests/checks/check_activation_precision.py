#!/usr/bin/env python3
"""Test activation keyword precision: feed prompts and verify correct skill routing."""

import json
import os
import re
import sys
from pathlib import Path

def load_skills_manifest(root: Path) -> dict:
    """Load .skills.json and build keyword-to-skill mapping."""
    manifest_path = root / ".skills.json"
    with open(manifest_path) as f:
        manifest = json.load(f)
    return manifest

def match_skills(prompt: str, skills: list[dict]) -> list[str]:
    """Simulate skill activation based on keyword matching."""
    activated = []
    prompt_lower = prompt.lower()
    for skill in skills:
        if skill.get("always_load"):
            continue
        keywords = skill.get("activation_keywords", [])
        for kw in keywords:
            if kw.lower() in prompt_lower:
                activated.append(skill["id"])
                break
    return activated

# Test cases: (prompt, expected_skills, should_not_activate)
TEST_CASES = [
    # True positives: should activate the right skill
    {
        "prompt": "How do I create a GIN index on a JSONB column in PostgreSQL?",
        "should_activate": ["advanced-indexing", "jsonb-patterns"],
        "should_not_activate": [],
    },
    {
        "prompt": "Set up row level security for multi-tenant app",
        "should_activate": ["row-level-security"],
        "should_not_activate": ["table-partitioning"],
    },
    {
        "prompt": "How to use tsvector and tsquery for full text search?",
        "should_activate": ["full-text-search"],
        "should_not_activate": [],
    },
    {
        "prompt": "Configure DiskANN index for vector similarity search on Azure",
        "should_activate": ["vector-diskann"],
        "should_not_activate": [],
    },
    {
        "prompt": "How to install pg_cron extension on Azure Flexible Server?",
        "should_activate": ["extension-lifecycle"],
        "should_not_activate": [],
    },
    {
        "prompt": "Set up range partition for time-series data in PostgreSQL",
        "should_activate": ["table-partitioning"],
        "should_not_activate": [],
    },
    {
        "prompt": "How to configure connection pooling with PgBouncer?",
        "should_activate": ["connection-management"],
        "should_not_activate": [],
    },
    {
        "prompt": "Set up logical replication between two PostgreSQL servers",
        "should_activate": ["replication"],
        "should_not_activate": [],
    },
    {
        "prompt": "How to authenticate with Entra ID managed identity to Azure PostgreSQL?",
        "should_activate": ["entra-id-auth"],
        "should_not_activate": [],
    },
    {
        "prompt": "Build a RAG application with pgvector embeddings and Azure OpenAI",
        "should_activate": ["genai-patterns"],
        "should_not_activate": [],
    },

    # True negatives: should NOT activate PostgreSQL skills
    {
        "prompt": "How do I iterate over an array index in JavaScript?",
        "should_activate": [],
        "should_not_activate": ["advanced-indexing"],
    },
    {
        "prompt": "I want to partition my React app into micro-frontends",
        "should_activate": [],
        "should_not_activate": ["table-partitioning"],
    },
    {
        "prompt": "How do I search for text in a file using grep?",
        "should_activate": [],
        "should_not_activate": ["full-text-search"],
    },
    {
        "prompt": "What's the best way to manage database connections in Django?",
        "should_activate": [],
        "should_not_activate": ["connection-management"],
    },
    {
        "prompt": "How do I create a Python virtual environment?",
        "should_activate": [],
        "should_not_activate": ["extension-lifecycle"],
    },
    {
        "prompt": "Configure nginx reverse proxy with SSL termination",
        "should_activate": [],
        "should_not_activate": ["networking-ssl"],
    },
    {
        "prompt": "How to replicate a MongoDB collection to another cluster?",
        "should_activate": [],
        "should_not_activate": ["replication"],
    },
    {
        "prompt": "Set up Azure Active Directory for my web application",
        "should_activate": [],
        "should_not_activate": ["entra-id-auth"],
    },
    {
        "prompt": "How do I extend a TypeScript interface with generics?",
        "should_activate": [],
        "should_not_activate": ["extension-lifecycle"],
    },
    {
        "prompt": "I need to tune the JVM garbage collector for my Java app",
        "should_activate": [],
        "should_not_activate": ["query-performance"],
    },

    # Edge cases: domain-adjacent prompts
    {
        "prompt": "Optimize slow PostgreSQL query with EXPLAIN ANALYZE",
        "should_activate": ["query-performance"],
        "should_not_activate": [],
    },
    {
        "prompt": "How to store JSON data in PostgreSQL jsonb column?",
        "should_activate": ["jsonb-patterns"],
        "should_not_activate": [],
    },
    {
        "prompt": "Provision a new Azure Database for PostgreSQL Flexible Server",
        "should_activate": ["provisioning"],
        "should_not_activate": [],
    },
    {
        "prompt": "Set up high availability with zone redundant deployment",
        "should_activate": ["ha-disaster-recovery"],
        "should_not_activate": [],
    },
    {
        "prompt": "How to use azure_ai extension to call OpenAI from SQL?",
        "should_activate": ["azure-ai"],
        "should_not_activate": [],
    },
]

def main():
    root = Path(os.environ.get("REPO_ROOT", "."))
    manifest = load_skills_manifest(root)
    skills = manifest.get("skills", [])

    print(f"Testing activation precision with {len(TEST_CASES)} prompts against {len(skills)} skills...\n")

    true_positives = 0
    false_negatives = 0
    true_negatives = 0
    false_positives = 0
    errors = []

    for tc in TEST_CASES:
        activated = match_skills(tc["prompt"], skills)

        # Check should_activate (true positives)
        for expected in tc["should_activate"]:
            if expected in activated:
                true_positives += 1
            else:
                false_negatives += 1
                errors.append(f"  FN: \"{tc['prompt'][:60]}...\" should activate [{expected}] but didn't")

        # Check should_not_activate (true negatives / false positives)
        for blocked in tc["should_not_activate"]:
            if blocked in activated:
                false_positives += 1
                errors.append(f"  FP: \"{tc['prompt'][:60]}...\" activated [{blocked}] (should not)")
            else:
                true_negatives += 1

    total = true_positives + false_negatives + true_negatives + false_positives
    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 1.0
    recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 1.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

    print(f"Results:")
    print(f"  True Positives:  {true_positives}")
    print(f"  True Negatives:  {true_negatives}")
    print(f"  False Positives: {false_positives}")
    print(f"  False Negatives: {false_negatives}")
    print(f"  Precision:       {precision:.3f}")
    print(f"  Recall:          {recall:.3f}")
    print(f"  F1 Score:        {f1:.3f}")

    if errors:
        print(f"\n✗ {len(errors)} activation errors:")
        for e in errors:
            print(e)

    # Thresholds
    if precision < 0.90:
        print(f"\n✗ FAIL: Precision {precision:.3f} < 0.90 threshold")
        sys.exit(1)
    if recall < 0.80:
        print(f"\n✗ FAIL: Recall {recall:.3f} < 0.80 threshold")
        sys.exit(1)
    if false_positives > 2:
        print(f"\n✗ FAIL: {false_positives} false positives (max 2 allowed)")
        sys.exit(1)

    print(f"\n✓ Activation precision test passed (F1={f1:.3f})")

if __name__ == "__main__":
    main()
