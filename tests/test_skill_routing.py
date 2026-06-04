# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Skill routing and content-contract tests (no database required).

Covers routing scenarios, skill loading, content contracts, negative routing,
and content-regression guards. Routing/skill expectations are validated against the
``tests/.skills.json`` manifest as the source of truth.
"""

import re

import pytest

from conftest import (
    extract_sql_blocks,
    load_skill_content,
    route_ids,
)

I = re.IGNORECASE


# ---------------------------------------------------------------------------
# Positive routing — prompts should activate the intended current skill
# ---------------------------------------------------------------------------
POSITIVE_ROUTING = [
    ("My query is slow, how do I optimize it?", "query-performance"),
    ("Set up row level security for multi-tenant", "row-level-security"),
    ("How do I install pgvector extension on azure?", "extension-lifecycle"),
    ("hnsw indexes azure tuning for vector search", "vector-diskann"),
    ("full text search with tsvector and ts_rank", "full-text-search"),
    ("jsonb gin index for json containment", "jsonb-patterns"),
    ("create index strategy for tenant lookups", "advanced-indexing"),
    ("Build an in-database rag pipeline with embeddings", "genai-patterns"),
    ("Should I partition my events table by event_date?", "table-partitioning"),
]


@pytest.mark.parametrize("prompt,expected_id", POSITIVE_ROUTING)
def test_prompt_routes_to_expected_skill(skills, prompt, expected_id):
    ids = route_ids(prompt, skills)
    assert expected_id in ids, f"{prompt!r} routed to {ids}, expected {expected_id}"


# ---------------------------------------------------------------------------
# Negative routing — non-PostgreSQL prompts must not activate any skill.
# ---------------------------------------------------------------------------
NEGATIVE_ROUTING = [
    "How do I iterate over an array index in JavaScript?",
    "My Python application is slow, how do I profile it?",
    "How do I set up vector graphics in CSS?",
    "Write a SELECT query to get all users where name = 'John'",
    "How do I replicate a bug in my staging environment?",
    "What's the best way to manage SSH connections to my servers?",
    "How do I set security headers in my Express.js app?",
    "How do I search for text in a file using grep?",
    "I want to extend my TypeScript types with generics",
    "I want to partition my React app into micro-frontends",
]


@pytest.mark.parametrize("prompt", NEGATIVE_ROUTING)
def test_prompt_does_not_falsely_activate(skills, prompt):
    ids = route_ids(prompt, skills)
    assert ids == [], f"{prompt!r} falsely activated {ids}"


# ---------------------------------------------------------------------------
# Skill loading + keyword hygiene
# ---------------------------------------------------------------------------
def test_all_skills_load_and_have_frontmatter(skills):
    errors = []
    loaded = 0
    for skill in skills:
        content = load_skill_content(skill, skills)
        if not content:
            errors.append(f"{skill['id']}: file not found at {skill.get('path')}")
            continue
        if "---" not in content or "# " not in content:
            errors.append(f"{skill['id']}: missing frontmatter or headings")
            continue
        loaded += 1
    assert not errors, "Skill loading errors:\n  " + "\n  ".join(errors)
    assert loaded >= 21, f"Expected >=21 skills, loaded {loaded}"


def test_skills_have_activation_keywords(skills):
    # Every non-always_load skill must declare at least one activation keyword.
    missing = [
        s["id"]
        for s in skills
        if not s.get("always_load") and not (s.get("activation_keywords") or [])
    ]
    assert not missing, f"skills with no activation keywords: {missing}"


# ---------------------------------------------------------------------------
# Phase A: skill content contracts (modernized to current reference style)
# ---------------------------------------------------------------------------
SKILL_CONTRACTS = [
    {
        "skill_id": "vector-diskann",
        "required": [
            r"CREATE\s+EXTENSION.*vector",
            r"USING\s+(diskann|hnsw)",
            r"vector_cosine_ops|vector_l2_ops|vector_ip_ops",
            r"azure_pg_admin",
            r"azure\.extensions",
        ],
        "forbidden": [r"ALTER\s+SYSTEM"],
        "required_sections": ["Prerequisites", "Common Mistakes"],
        "min_sql_blocks": 3,
    },
    {
        "skill_id": "table-partitioning",
        "required": [
            r"\bRANGE\b",
            r"\bLIST\b",
            r"DETACH\s+PARTITION.*CONCURRENTLY",
            r"DEFAULT\s+partition|partition.*DEFAULT",
            r"partition\s+key",
        ],
        "forbidden": [r"ALTER\s+SYSTEM", r"SUPERUSER", r"CREATE\s+TABLESPACE"],
        "required_sections": ["Common Mistakes"],
        "min_sql_blocks": 2,
    },
    {
        "skill_id": "full-text-search",
        "required": [
            r"tsvector",
            r"tsquery|to_tsquery|websearch_to_tsquery",
            r"ts_rank|ts_rank_cd",
            r"GIN|gin",
        ],
        "forbidden": [r"ALTER\s+SYSTEM", r"SUPERUSER"],
        "required_sections": [],
        "min_sql_blocks": 1,
    },
    {
        "skill_id": "extension-lifecycle",
        "required": [
            r"azure\.extensions",
            r"azure_pg_admin",
            r"pg_available_extensions",
            r"shared_preload_libraries",
        ],
        "forbidden": [],
        "required_sections": ["Prerequisites"],
        "min_sql_blocks": 2,
    },
    {
        "skill_id": "row-level-security",
        "required": [
            r"CREATE\s+POLICY",
            r"ENABLE\s+ROW\s+LEVEL\s+SECURITY",
            r"current_setting",
            r"SET\s+LOCAL|set_config",
            r"FORCE\s+ROW\s+LEVEL\s+SECURITY",
        ],
        "forbidden": [r"ALTER\s+SYSTEM"],
        "required_sections": [],
        "min_sql_blocks": 2,
    },
    {
        "skill_id": "genai-patterns",
        "required": [
            r"vector\(\s*(?:\d+|N)\s*\)",
            r"embedding",
            r"cosine|<=>|similarity",
        ],
        "forbidden": [r"ALTER\s+SYSTEM", r"SUPERUSER"],
        "required_sections": [],
        "min_sql_blocks": 2,
    },
    {
        "skill_id": "advanced-indexing",
        "required": [
            r"CREATE\s+INDEX",
            r"btree|B-tree",
            r"GIN|gin",
            r"BRIN|brin",
            r"partial\s+index|WHERE",
        ],
        "forbidden": [r"ALTER\s+SYSTEM", r"SUPERUSER"],
        "required_sections": [],
        "min_sql_blocks": 1,
    },
]


@pytest.mark.parametrize("contract", SKILL_CONTRACTS, ids=lambda c: c["skill_id"])
def test_skill_content_contract(skills, contract):
    content = load_skill_content(contract["skill_id"], skills)
    assert content, f"{contract['skill_id']}: reference file not found"

    missing = [r for r in contract["required"] if not re.search(r, content, I)]
    assert not missing, f"{contract['skill_id']} missing required patterns: {missing}"

    triggered = [f for f in contract["forbidden"] if re.search(f, content, I)]
    assert not triggered, f"{contract['skill_id']} has forbidden patterns: {triggered}"

    for section in contract["required_sections"]:
        assert section in content, f"{contract['skill_id']} missing section: {section}"

    n_blocks = len(extract_sql_blocks(content))
    assert n_blocks >= contract["min_sql_blocks"], (
        f"{contract['skill_id']} has {n_blocks} SQL blocks "
        f"(min {contract['min_sql_blocks']})"
    )


# ---------------------------------------------------------------------------
# Phase E: content-regression guards (known negative-delta failure modes)
# ---------------------------------------------------------------------------
def _single_line(pattern, content):
    """Single-line search: '.' does not cross newlines."""
    return re.search(pattern, content, I) is not None


CONTENT_REGRESSION = {
    "vector-diskann": [
        (
            "no speculative DiskANN GUC parameters",
            lambda c: not (
                _single_line(r"diskann_(?!search_list_size)\w+\s*=\s*\d+", c)
                or _single_line(r"increase search list size", c)
            ),
        ),
        (
            "clear HNSW vs DiskANN decision tree",
            lambda c: (_single_line(r"< ?1M.*HNSW", c) or _single_line(r"HNSW.*small", c))
            and (_single_line(r"> ?1M.*DiskANN", c) or _single_line(r"DiskANN.*large", c)),
        ),
        (
            "operator class matching emphasized",
            lambda c: _single_line(r"wrong.*operator", c)
            or _single_line(r"mismatch.*class", c)
            or _single_line(r"CRITICAL.*operator", c),
        ),
    ],
    "table-partitioning": [
        ("no ALTER SYSTEM references", lambda c: not _single_line(r"ALTER\s+SYSTEM", c)),
        (
            "includes DEFAULT partition warning",
            lambda c: _single_line(r"DEFAULT.*partition.*trap", c)
            or _single_line(r"DEFAULT.*fail", c)
            or _single_line(r"CRITICAL.*Default", c),
        ),
        (
            "partition key in PK constraint",
            lambda c: _single_line(r"partition\s+key.*PRIMARY", c)
            or _single_line(r"PRIMARY.*partition\s+key", c)
            or _single_line(r"include\s+partition\s+key", c),
        ),
        (
            "version-gated CONCURRENTLY",
            lambda c: (
                _single_line(r"PG\s*14", c)
                or _single_line(r"PostgreSQL\s*14", c)
                or _single_line(r"14\+", c)
            )
            and _single_line(r"CONCURRENTLY", c),
        ),
    ],
    "full-text-search": [
        (
            "no overly complex SQL enrichment",
            lambda c: all(
                len(b.split("\n")) <= 25
                for b in re.findall(r"```sql[\s\S]*?```", c)
            ),
        ),
        # Current reference deliberately skips GIN tutorials; it references GIN
        # conceptually rather than showing a literal "USING gin" statement.
        ("mentions GIN for FTS", lambda c: _single_line(r"\bGIN\b", c)),
    ],
}

_REGRESSION_CASES = [
    (skill_id, name, fn)
    for skill_id, checks in CONTENT_REGRESSION.items()
    for name, fn in checks
]


@pytest.mark.parametrize(
    "skill_id,name,check",
    _REGRESSION_CASES,
    ids=[f"{s}-{n}" for s, n, _ in _REGRESSION_CASES],
)
def test_content_regression_guard(skills, skill_id, name, check):
    content = load_skill_content(skill_id, skills)
    assert content, f"{skill_id}: reference file not found"
    assert check(content), f"{skill_id}: {name}"
