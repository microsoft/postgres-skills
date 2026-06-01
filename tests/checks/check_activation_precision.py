# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

#!/usr/bin/env python3
"""
Routing Table Precision Test
Validates that prompts route to the correct reference file(s) via the SKILL.md routing table.
Tests both generic routing and Azure-gated routing logic.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SKILL_MD = REPO_ROOT / "plugin" / "skills" / "postgresql-best-practices" / "SKILL.md"
REFERENCES_DIR = REPO_ROOT / "plugin" / "skills" / "postgresql-best-practices" / "references"


def parse_routing_table(skill_md_path):
    """Extract keyword→reference mappings from the routing table in SKILL.md."""
    content = skill_md_path.read_text(encoding="utf-8")
    
    # Find routing table rows: | keywords | [name](references/file.md) | description |
    table_pattern = re.compile(
        r"^\|\s*(.+?)\s*\|\s*\[[\w-]+\]\(references/([\w-]+\.md)\)\s*\|", re.MULTILINE
    )
    
    routes = []
    for match in table_pattern.finditer(content):
        keywords_cell = match.group(1).strip()
        reference_file = match.group(2).strip()
        
        # Skip header rows
        if keywords_cell.startswith("---") or keywords_cell.lower() == "keywords":
            continue
            
        # Parse keywords (comma or pipe separated, with backticks)
        keywords = [
            k.strip().strip("`").lower()
            for k in re.split(r"[,|]", keywords_cell)
            if k.strip().strip("`")
        ]
        
        is_azure = reference_file.startswith("azure-postgresql-")
        routes.append({
            "keywords": keywords,
            "reference": reference_file,
            "is_azure": is_azure,
        })
    
    return routes


def match_prompt_to_routes(prompt, routes, is_azure_session=False):
    """Simulate routing: find which references a prompt would activate."""
    prompt_lower = prompt.lower()
    activated = []
    
    for route in routes:
        if route["is_azure"] and not is_azure_session:
            continue
        
        # A route matches if any keyword appears in the prompt
        for keyword in route["keywords"]:
            if keyword in prompt_lower:
                activated.append(route["reference"])
                break
    
    return activated


# Test cases: (prompt, expected_references, should_not_route, azure_session)
TEST_CASES = [
    # Generic PostgreSQL routing (no Azure session)
    {
        "prompt": "How do I create a GIN index on a JSONB column?",
        "should_route": ["postgresql-advanced-indexing.md"],
        "should_not_route": ["azure-postgresql-intelligent-tuning.md"],
        "azure_session": False,
    },
    {
        "prompt": "Set up row level security for multi-tenant app",
        "should_route": ["postgresql-row-level-security.md"],
        "should_not_route": ["postgresql-table-partitioning.md"],
        "azure_session": False,
    },
    {
        "prompt": "How to use tsvector and tsquery for full text search?",
        "should_route": ["postgresql-full-text-search.md"],
        "should_not_route": [],
        "azure_session": False,
    },
    {
        "prompt": "Configure pgvector HNSW index for similarity search",
        "should_route": ["postgresql-vector-search.md"],
        "should_not_route": ["azure-postgresql-vector-diskann.md"],
        "azure_session": False,
    },
    {
        "prompt": "Set up range partition for time-series data",
        "should_route": ["postgresql-table-partitioning.md"],
        "should_not_route": [],
        "azure_session": False,
    },
    {
        "prompt": "How to configure connection pooling with PgBouncer?",
        "should_route": ["postgresql-connection-management.md"],
        "should_not_route": [],
        "azure_session": False,
    },
    {
        "prompt": "Set up logical replication between two PostgreSQL servers",
        "should_route": ["postgresql-replication.md"],
        "should_not_route": [],
        "azure_session": False,
    },
    {
        "prompt": "Build a RAG application with pgvector embeddings",
        "should_route": ["postgresql-genai-rag.md"],
        "should_not_route": ["azure-postgresql-genai-rag.md"],
        "azure_session": False,
    },
    {
        "prompt": "How to manage extensions in PostgreSQL?",
        "should_route": ["postgresql-extensions.md"],
        "should_not_route": ["azure-postgresql-extension-lifecycle.md"],
        "azure_session": False,
    },
    # Azure session routing (should activate Azure-specific references)
    {
        "prompt": "Configure DiskANN index for vector search on Azure",
        "should_route": ["azure-postgresql-vector-diskann.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "How to install pg_cron extension on Azure Flexible Server?",
        "should_route": ["azure-postgresql-extension-lifecycle.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Authenticate with Entra ID managed identity",
        "should_route": ["azure-postgresql-entra-id-auth.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Build in-database RAG pipeline with azure_ai and pgvector",
        "should_route": ["azure-postgresql-genai-patterns.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Configure intelligent tuning for query performance on Azure",
        "should_route": ["azure-postgresql-intelligent-tuning.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    # Azure-gating: Azure skills should NOT activate without Azure session
    {
        "prompt": "Configure DiskANN index for vector search",
        "should_route": [],
        "should_not_route": ["azure-postgresql-vector-diskann.md"],
        "azure_session": False,
    },
    {
        "prompt": "Authenticate with Entra ID",
        "should_route": [],
        "should_not_route": ["azure-postgresql-entra-id-auth.md"],
        "azure_session": False,
    },
    {
        "prompt": "Use intelligent tuning for slow queries",
        "should_route": [],
        "should_not_route": ["azure-postgresql-intelligent-tuning.md"],
        "azure_session": False,
    },
    {
        "prompt": "How to allowlist azure.extensions on my server?",
        "should_route": [],
        "should_not_route": ["azure-postgresql-extension-lifecycle.md"],
        "azure_session": False,
    },
    {
        "prompt": "Set up built-in PgBouncer azure connection pooling",
        "should_route": [],
        "should_not_route": ["azure-postgresql-connection-pooling.md"],
        "azure_session": False,
    },
    {
        "prompt": "Provision a new Flexible Server with GeneralPurpose tier",
        "should_route": [],
        "should_not_route": ["azure-postgresql-provisioning.md"],
        "azure_session": False,
    },
    {
        "prompt": "Configure zone redundant HA with failover",
        "should_route": [],
        "should_not_route": ["azure-postgresql-ha-disaster-recovery.md"],
        "azure_session": False,
    },
    {
        "prompt": "Set up Private Link and VNet for my database",
        "should_route": [],
        "should_not_route": ["azure-postgresql-networking-ssl.md"],
        "azure_session": False,
    },
    {
        "prompt": "Schedule a major version upgrade with maintenance window",
        "should_route": [],
        "should_not_route": ["azure-postgresql-upgrades-maintenance.md"],
        "azure_session": False,
    },
    {
        "prompt": "Use azure_ai ai.embed to generate embeddings from SQL",
        "should_route": [],
        "should_not_route": ["azure-postgresql-azure-ai.md"],
        "azure_session": False,
    },
    {
        "prompt": "Build azure genai in-database RAG pipeline",
        "should_route": [],
        "should_not_route": ["azure-postgresql-genai-patterns.md"],
        "azure_session": False,
    },
    # Azure session + generic topic → should route to generic, NOT azure
    {
        "prompt": "How do I create a partial index on a boolean column?",
        "should_route": ["postgresql-advanced-indexing.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Query JSONB column with containment operator",
        "should_route": ["postgresql-jsonb-patterns.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Set up range partition for time-series logs",
        "should_route": ["postgresql-table-partitioning.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Create row level security policy for tenant isolation",
        "should_route": ["postgresql-row-level-security.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "How to use tsvector for full text search with ranking?",
        "should_route": ["postgresql-full-text-search.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Set up logical replication publication and subscription",
        "should_route": ["postgresql-replication.md"],
        "should_not_route": [],
        "azure_session": True,
    },
    {
        "prompt": "Diagnose slow query with EXPLAIN ANALYZE",
        "should_route": ["postgresql-query-performance.md"],
        "should_not_route": [],
        "azure_session": True,
    },
]


def run_tests():
    print("=" * 60)
    print("ROUTING TABLE PRECISION TEST")
    print("=" * 60)
    
    # Validate structure
    if not SKILL_MD.exists():
        print(f"FAIL: {SKILL_MD} not found")
        return False
    
    if not REFERENCES_DIR.exists():
        print(f"FAIL: {REFERENCES_DIR} not found")
        return False
    
    # Parse routing table
    routes = parse_routing_table(SKILL_MD)
    if not routes:
        print("FAIL: No routes parsed from routing table")
        return False
    
    print(f"\nParsed {len(routes)} routes from routing table")
    generic_count = sum(1 for r in routes if not r["is_azure"])
    azure_count = sum(1 for r in routes if r["is_azure"])
    print(f"  Generic routes: {generic_count}")
    print(f"  Azure routes:   {azure_count}")
    
    # Verify all referenced files exist
    missing_refs = []
    for route in routes:
        ref_path = REFERENCES_DIR / route["reference"]
        if not ref_path.exists():
            missing_refs.append(route["reference"])
    
    if missing_refs:
        print(f"\nFAIL: {len(missing_refs)} referenced files missing:")
        for m in missing_refs:
            print(f"  - {m}")
        return False
    
    print(f"\n  All referenced files exist ✓")
    
    # Run routing precision tests
    print(f"\n{'─' * 60}")
    print("ROUTING PRECISION TESTS")
    print(f"{'─' * 60}\n")
    
    passed = 0
    failed = 0
    
    for i, tc in enumerate(TEST_CASES, 1):
        prompt = tc["prompt"]
        expected = set(tc["should_route"])
        forbidden = set(tc["should_not_route"])
        is_azure = tc["azure_session"]
        
        activated = set(match_prompt_to_routes(prompt, routes, is_azure))
        
        errors = []
        
        # Check expected routes are activated
        for exp in expected:
            if exp not in activated:
                errors.append(f"  MISS: expected '{exp}' not activated")
        
        # Check forbidden routes are NOT activated
        for forb in forbidden:
            if forb in activated:
                errors.append(f"  FALSE+: '{forb}' should not activate")
        
        session_type = "Azure" if is_azure else "Generic"
        if errors:
            failed += 1
            print(f"  [{i:2d}] FAIL [{session_type}] {prompt[:60]}")
            for e in errors:
                print(f"       {e}")
        else:
            passed += 1
            print(f"  [{i:2d}] PASS [{session_type}] {prompt[:60]}")
    
    # Summary
    total = passed + failed
    print(f"\n{'=' * 60}")
    print(f"RESULTS: {passed}/{total} passed, {failed} failed")
    print(f"{'=' * 60}")
    
    return failed == 0


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
