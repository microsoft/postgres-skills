# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Routing-table precision for the SKILL.md keyword routing table.

Native port of the former ``tests/checks/check_activation_precision.py``. Parses
the keyword→reference routing table from SKILL.md and asserts that representative
prompts activate the expected reference(s) and never activate forbidden ones,
including the Azure-gating rules (Azure references must not activate outside an
Azure session).
"""

import re

import pytest

from conftest import ROOT

SKILL_MD = ROOT / "plugin" / "skills" / "postgresql-best-practices" / "SKILL.md"
REFERENCES_DIR = ROOT / "plugin" / "skills" / "postgresql-best-practices" / "references"


def _parse_routing_table(skill_md_path):
    content = skill_md_path.read_text(encoding="utf-8")
    table_pattern = re.compile(
        r"^\|\s*(.+?)\s*\|\s*\[[\w-]+\]\(references/([\w-]+\.md)\)\s*\|", re.MULTILINE
    )
    routes = []
    for match in table_pattern.finditer(content):
        keywords_cell = match.group(1).strip()
        reference_file = match.group(2).strip()
        if keywords_cell.startswith("---") or keywords_cell.lower() == "keywords":
            continue
        keywords = [
            k.strip().strip("`").lower()
            for k in re.split(r"[,|]", keywords_cell)
            if k.strip().strip("`")
        ]
        routes.append(
            {
                "keywords": keywords,
                "reference": reference_file,
                "is_azure": reference_file.startswith("azure-postgresql-"),
            }
        )
    return routes


def _match_prompt_to_routes(prompt, routes, is_azure_session=False):
    prompt_lower = prompt.lower()
    activated = []
    for route in routes:
        if route["is_azure"] and not is_azure_session:
            continue
        for keyword in route["keywords"]:
            if keyword in prompt_lower:
                activated.append(route["reference"])
                break
    return activated


ROUTES = _parse_routing_table(SKILL_MD) if SKILL_MD.exists() else []

# (prompt, should_route, should_not_route, azure_session)
TEST_CASES = [
    ("How do I create a GIN index on a JSONB column?", ["postgresql-advanced-indexing.md"], ["azure-postgresql-intelligent-tuning.md"], False),
    ("Set up row level security for multi-tenant app", ["postgresql-row-level-security.md"], ["postgresql-table-partitioning.md"], False),
    ("How to use tsvector and tsquery for full text search?", ["postgresql-full-text-search.md"], [], False),
    ("Configure pgvector HNSW index for similarity search", ["postgresql-vector-search.md"], ["azure-postgresql-vector-diskann.md"], False),
    ("Set up range partition for time-series data", ["postgresql-table-partitioning.md"], [], False),
    ("How to configure connection pooling with PgBouncer?", ["postgresql-connection-management.md"], [], False),
    ("Set up logical replication between two PostgreSQL servers", ["postgresql-replication.md"], [], False),
    ("Build a RAG application with pgvector embeddings", ["postgresql-genai-rag.md"], ["azure-postgresql-genai-rag.md"], False),
    ("How to manage extensions in PostgreSQL?", ["postgresql-extensions.md"], ["azure-postgresql-extension-lifecycle.md"], False),
    ("Configure DiskANN index for vector search on Azure", ["azure-postgresql-vector-diskann.md"], [], True),
    ("How to install pg_cron extension on Azure Flexible Server?", ["azure-postgresql-extension-lifecycle.md"], [], True),
    ("Authenticate with Entra ID managed identity", ["azure-postgresql-entra-id-auth.md"], [], True),
    ("Build in-database RAG pipeline with azure_ai and pgvector", ["azure-postgresql-genai-patterns.md"], [], True),
    ("Configure intelligent tuning for query performance on Azure", ["azure-postgresql-intelligent-tuning.md"], [], True),
    ("Configure DiskANN index for vector search", [], ["azure-postgresql-vector-diskann.md"], False),
    ("Authenticate with Entra ID", [], ["azure-postgresql-entra-id-auth.md"], False),
    ("Use intelligent tuning for slow queries", [], ["azure-postgresql-intelligent-tuning.md"], False),
    ("How to allowlist azure.extensions on my server?", [], ["azure-postgresql-extension-lifecycle.md"], False),
    ("Set up built-in PgBouncer azure connection pooling", [], ["azure-postgresql-connection-pooling.md"], False),
    ("Provision a new Flexible Server with GeneralPurpose tier", [], ["azure-postgresql-provisioning.md"], False),
    ("Configure zone redundant HA with failover", [], ["azure-postgresql-ha-disaster-recovery.md"], False),
    ("Set up Private Link and VNet for my database", [], ["azure-postgresql-networking-ssl.md"], False),
    ("Schedule a major version upgrade with maintenance window", [], ["azure-postgresql-upgrades-maintenance.md"], False),
    ("Use azure_ai ai.embed to generate embeddings from SQL", [], ["azure-postgresql-azure-ai.md"], False),
    ("Build azure genai in-database RAG pipeline", [], ["azure-postgresql-genai-patterns.md"], False),
    ("How do I create a partial index on a boolean column?", ["postgresql-advanced-indexing.md"], [], True),
    ("Query JSONB column with containment operator", ["postgresql-jsonb-patterns.md"], [], True),
    ("Set up range partition for time-series logs", ["postgresql-table-partitioning.md"], [], True),
    ("Create row level security policy for tenant isolation", ["postgresql-row-level-security.md"], [], True),
    ("How to use tsvector for full text search with ranking?", ["postgresql-full-text-search.md"], [], True),
    ("Set up logical replication publication and subscription", ["postgresql-replication.md"], [], True),
    ("Diagnose slow query with EXPLAIN ANALYZE", ["postgresql-query-performance.md"], [], True),
]


def test_routing_table_parsed():
    assert SKILL_MD.exists(), f"{SKILL_MD} not found"
    assert REFERENCES_DIR.exists(), f"{REFERENCES_DIR} not found"
    assert ROUTES, "no routes parsed from routing table"


def test_all_referenced_files_exist():
    missing = [r["reference"] for r in ROUTES if not (REFERENCES_DIR / r["reference"]).exists()]
    assert not missing, f"referenced files missing: {missing}"


@pytest.mark.parametrize(
    "prompt,should_route,should_not_route,azure_session",
    TEST_CASES,
    ids=[tc[0][:50] for tc in TEST_CASES],
)
def test_prompt_routing_precision(prompt, should_route, should_not_route, azure_session):
    activated = set(_match_prompt_to_routes(prompt, ROUTES, azure_session))
    errors = []
    for exp in should_route:
        if exp not in activated:
            errors.append(f"MISS: expected '{exp}' not activated")
    for forb in should_not_route:
        if forb in activated:
            errors.append(f"FALSE+: '{forb}' should not activate")
    assert not errors, f"[{prompt}] " + "; ".join(errors)
