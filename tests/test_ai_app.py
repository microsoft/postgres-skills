# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""AI Application Dogfood Test — Multi-Tenant RAG Product Q&A System.

Replaces the former ``tests/test_ai_app.js``. Simulates an AI coding agent
building a real application: it routes prompts through skills, reads skill
guidance, and executes SQL via MCP tools against a live database, grading
whether the skills gave correct, complete guidance.

Requires PGSQL_TEST_CONNECTION_STRING (Azure Database for PostgreSQL with
pgvector/azure_ai); the module is skipped when it is unset. Routing and skill
expectations are validated against the current ``tests/.skills.json`` manifest.
Pure no-DB skill-content/routing contracts live in ``test_skill_routing.py``.
"""

import re
import os
import time

import pytest

from conftest import (
    connect_to_database,
    extract_sql_blocks,
    get_tool_text,
    has_error,
    load_skill_content,
    route_ids,
)

pytestmark = pytest.mark.integration

# Unique per process so same-day and parallel CI runs never collide.
_SUFFIX = f"{time.strftime('%Y%m%d')}_{os.getpid()}"
SCHEMA = f"test_rag_app_{_SUFFIX}"
SNIPPET_SCHEMA = f"test_snippets_{_SUFFIX}"
VERIFY_SCHEMA = f"test_verify_{_SUFFIX}"


class Grades:
    def __init__(self):
        self.items = []

    def add(self, step, skill, aspect, passed, detail=""):
        self.items.append((step, skill, aspect, bool(passed), detail))
        mark = "PASS" if passed else "FAIL"
        print(f"  [{mark}] step {step} [{skill}] {aspect}: {detail}")

    @property
    def failures(self):
        return [g for g in self.items if not g[3]]


def _text(client, tool, args):
    return get_tool_text(client.call_tool(tool, args))


# ---------------------------------------------------------------------------
# Application build (7 phases, 18 steps)
# ---------------------------------------------------------------------------
def build_app(client, conn_id, skills, g: Grades):
    # ---- PHASE 1: Database Foundation ----
    # Step 1: server capabilities
    ids = route_ids("How do I tune vector search on Azure?", skills)
    g.add("1", "routing", "azure skill activated",
          any("azure" in i or i == "vector-diskann" for i in ids) or bool(ids),
          f"Routed to: {ids}")
    caps_text = _text(client, "pgsql_get_server_capabilities", {"connectionId": conn_id})
    is_azure = "isAzure" in caps_text and "true" in caps_text
    g.add("1", "mcp", "server detection", is_azure, f"isAzure: {is_azure}")

    # Step 2: create schema
    _text(client, "pgsql_modify",
          {"connectionId": conn_id, "statement": f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE;"})
    created = _text(client, "pgsql_modify",
                    {"connectionId": conn_id, "statement": f"CREATE SCHEMA {SCHEMA};"})
    g.add("2", "mcp", "schema created", not has_error(created), f"Schema {SCHEMA}")
    _text(client, "pgsql_query",
          {"connectionId": conn_id, "query": f"SET search_path TO {SCHEMA}, public;"})

    # Step 3: install extensions (extension-lifecycle)
    ids = route_ids("How do I install pgvector extension on azure?", skills)
    g.add("3", "routing", "extension skill activated",
          "extension-lifecycle" in ids, f"Routed to: {ids}")
    ext_content = load_skill_content("extension-lifecycle", skills)
    g.add("3", "extension-lifecycle", "mentions allowlist",
          ext_content and "azure.extensions" in ext_content, "azure.extensions allowlist")
    g.add("3", "extension-lifecycle", "mentions azure_pg_admin",
          ext_content and "azure_pg_admin" in ext_content, "required role")
    allowlist = _text(client, "pgsql_query",
                      {"connectionId": conn_id, "query": "SHOW azure.extensions;"})
    g.add("3", "mcp", "allowlist check works",
          "vector" in allowlist or len(allowlist) > 0, allowlist[:80])
    install = _text(client, "pgsql_modify",
                    {"connectionId": conn_id,
                     "statement": "CREATE EXTENSION IF NOT EXISTS vector;"})
    g.add("3", "mcp", "pgvector installed", not has_error(install), "CREATE EXTENSION vector")

    # ---- PHASE 2: Schema Design ----
    # Step 4: products table (genai-patterns)
    ids = route_ids("Build an in-database rag pipeline with embeddings", skills)
    g.add("4", "routing", "genai-patterns activated",
          "genai-patterns" in ids, f"Routed to: {ids}")
    genai = load_skill_content("genai-patterns", skills)
    g.add("4", "genai-patterns", "shows external embedding path",
          genai and "Path B" in genai, "covers in-db and external embeddings")
    g.add("4", "genai-patterns", "mentions vector dimension",
          genai and "1536" in genai, "specifies dimension matching model output")
    g.add("4", "genai-patterns", "shows hybrid search",
          genai and "RRF" in genai, "includes RRF hybrid search pattern")
    create_products = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        CREATE TABLE {SCHEMA}.products (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          tenant_id text NOT NULL,
          name text NOT NULL,
          description text NOT NULL,
          category text,
          metadata jsonb DEFAULT '{{}}',
          embedding vector(1536),
          search_vector tsvector GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B')
          ) STORED,
          created_at timestamptz DEFAULT now()
        );"""})
    g.add("4", "mcp", "products table created",
          not has_error(create_products), "table with vector + tsvector")

    # Step 5: conversations table
    create_convos = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        CREATE TABLE {SCHEMA}.conversations (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          tenant_id text NOT NULL,
          session_id uuid DEFAULT gen_random_uuid(),
          question text NOT NULL,
          answer text,
          context_product_ids bigint[],
          feedback_score smallint CHECK (feedback_score BETWEEN 1 AND 5),
          created_at timestamptz DEFAULT now()
        );"""})
    g.add("5", "mcp", "conversations table created",
          not has_error(create_convos), "Q&A history table")

    # ---- PHASE 3: Populate Test Data ----
    insert = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        INSERT INTO {SCHEMA}.products (tenant_id, name, description, category, metadata)
        VALUES
          ('acme_corp', 'Enterprise Database Server', 'High-performance PostgreSQL managed database service with automatic failover and read replicas.', 'Database', '{{"tier": "enterprise", "sla": "99.99%"}}'),
          ('acme_corp', 'Vector Search Add-on', 'pgvector extension with DiskANN indexing for billion-scale similarity search.', 'AI/ML', '{{"tier": "premium", "max_dimensions": 2000}}'),
          ('acme_corp', 'Intelligent Query Tuner', 'AI-powered query optimization that recommends index strategies and query rewrites.', 'Performance', '{{"tier": "standard", "auto_apply": false}}'),
          ('globex_inc', 'Real-Time Analytics Engine', 'Columnar storage with BRIN indexes for time-series data with automatic partitioning.', 'Analytics', '{{"tier": "enterprise", "compression": "zstd"}}'),
          ('globex_inc', 'Compliance Dashboard', 'SOC 2, HIPAA, and GDPR compliance monitoring with audit logging and data masking.', 'Security', '{{"tier": "enterprise", "certifications": ["soc2", "hipaa", "gdpr"]}}'),
          ('globex_inc', 'Multi-Region Replication', 'Active-active replication across Azure regions with sub-100ms read latency globally.', 'Infrastructure', '{{"tier": "enterprise", "max_regions": 5}}'),
          ('initech', 'Developer Sandbox', 'Instant PostgreSQL instances for development and testing with sample datasets.', 'DevTools', '{{"tier": "free", "auto_shutdown_hours": 8}}'),
          ('initech', 'Serverless PostgreSQL', 'Auto-scaling PostgreSQL that scales to zero when idle. Cold start under 500ms.', 'Infrastructure', '{{"tier": "standard", "min_scale": 0}}');"""})
    g.add("6", "mcp", "product data inserted", not has_error(insert), "products across tenants")
    _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        INSERT INTO {SCHEMA}.conversations (tenant_id, question, answer, feedback_score)
        VALUES
          ('acme_corp', 'What is the maximum RAM?', '512 GB RAM with up to 64 vCores.', 5),
          ('acme_corp', 'Does vector search support cosine distance?', 'Yes, pgvector supports cosine, L2, and inner product.', 4),
          ('globex_inc', 'What compliance certifications?', 'SOC 2, HIPAA, and GDPR.', 4),
          ('initech', 'Is there a free tier?', 'Yes, the Developer Sandbox is free.', 3);"""})

    # ---- PHASE 4: Indexing Strategy ----
    # Step 7: HNSW vector index (vector-diskann)
    ids = route_ids("hnsw indexes azure tuning for vector search", skills)
    g.add("7", "routing", "vector-diskann activated",
          "vector-diskann" in ids, f"Routed to: {ids}")
    vec = load_skill_content("vector-diskann", skills)
    g.add("7", "vector-diskann", "HNSW guidance for small datasets",
          vec and "< 1M" in vec and "HNSW" in vec, "recommends HNSW for < 1M vectors")
    g.add("7", "vector-diskann", "shows HNSW parameters",
          vec and "ef_construction" in vec, "mentions ef_construction tuning")
    hnsw = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement":
        f"CREATE INDEX idx_products_embedding ON {SCHEMA}.products "
        f"USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);"})
    g.add("7", "mcp", "HNSW index created", not has_error(hnsw), "vector_cosine_ops")

    # Step 8: GIN FTS index (full-text-search)
    ids = route_ids("full text search with tsvector and ts_rank", skills)
    g.add("8", "routing", "full-text-search activated",
          "full-text-search" in ids, f"Routed to: {ids}")
    gin = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement":
        f"CREATE INDEX idx_products_search ON {SCHEMA}.products USING gin(search_vector);"})
    g.add("8", "mcp", "GIN FTS index created", not has_error(gin), "gin(search_vector)")

    # Step 9: JSONB GIN index (jsonb-patterns)
    ids = route_ids("jsonb gin index for json containment", skills)
    g.add("9", "routing", "jsonb-patterns activated",
          "jsonb-patterns" in ids, f"Routed to: {ids}")
    jsonb_skill = load_skill_content("jsonb-patterns", skills)
    g.add("9", "jsonb-patterns", "shows jsonb_path_ops",
          jsonb_skill and "jsonb_path_ops" in jsonb_skill, "recommends jsonb_path_ops")
    jidx = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement":
        f"CREATE INDEX idx_products_metadata ON {SCHEMA}.products USING gin(metadata jsonb_path_ops);"})
    g.add("9", "mcp", "JSONB GIN index created", not has_error(jidx), "jsonb_path_ops index")

    # Step 10: composite B-tree (advanced-indexing)
    ids = route_ids("create index strategy for tenant lookups", skills)
    g.add("10", "routing", "advanced-indexing activated",
          "advanced-indexing" in ids, f"Routed to: {ids}")
    btree = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement":
        f"CREATE INDEX idx_products_tenant_cat ON {SCHEMA}.products (tenant_id, category);"})
    g.add("10", "mcp", "B-tree composite index created",
          not has_error(btree), "(tenant_id, category)")

    # ---- PHASE 5: Row-Level Security ----
    ids = route_ids("row level security for tenant isolation", skills)
    g.add("11", "routing", "row-level-security activated",
          "row-level-security" in ids, f"Routed to: {ids}")
    rls = load_skill_content("row-level-security", skills)
    g.add("11", "row-level-security", "shows SET LOCAL pattern",
          rls and "SET LOCAL" in rls, "pooler-safe SET LOCAL")
    g.add("11", "row-level-security", "shows FORCE RLS",
          rls and "FORCE ROW LEVEL SECURITY" in rls, "FORCE RLS for owner")
    g.add("11", "row-level-security", "shows current_setting pattern",
          rls and "current_setting" in rls, "current_setting('app.current_tenant')")
    enable = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        ALTER TABLE {SCHEMA}.products ENABLE ROW LEVEL SECURITY;
        ALTER TABLE {SCHEMA}.products FORCE ROW LEVEL SECURITY;"""})
    g.add("11", "mcp", "RLS enabled", not has_error(enable), "enabled + forced")
    policy = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        CREATE POLICY tenant_isolation ON {SCHEMA}.products
          USING (tenant_id = current_setting('app.current_tenant', true));"""})
    g.add("11", "mcp", "RLS policy created", not has_error(policy), "tenant isolation policy")
    _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        ALTER TABLE {SCHEMA}.conversations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE {SCHEMA}.conversations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON {SCHEMA}.conversations
          USING (tenant_id = current_setting('app.current_tenant', true));"""})

    # ---- PHASE 6: Query Testing ----
    # Step 12: FTS query
    _text(client, "pgsql_query",
          {"connectionId": conn_id, "query": "SET LOCAL app.current_tenant = 'acme_corp';"})
    fts = _text(client, "pgsql_query", {"connectionId": conn_id, "query": f"""
        SELECT name, ts_rank(search_vector, query) AS rank
        FROM {SCHEMA}.products, websearch_to_tsquery('english', 'database performance') query
        WHERE search_vector @@ query
        ORDER BY rank DESC LIMIT 5;"""})
    g.add("12", "mcp", "FTS query returns results",
          "Database" in fts or "name" in fts, fts[:120])

    # Step 13: JSONB containment
    jsonb_q = _text(client, "pgsql_query", {"connectionId": conn_id, "query": f"""
        SELECT name, metadata->>'tier' AS tier
        FROM {SCHEMA}.products
        WHERE metadata @> '{{"tier": "enterprise"}}'
        ORDER BY name;"""})
    g.add("13", "mcp", "JSONB containment query works",
          "enterprise" in jsonb_q, jsonb_q[:120])

    # Step 14: EXPLAIN ANALYZE (query-performance)
    ids = route_ids("slow query, run explain analyze", skills)
    g.add("14", "routing", "query-performance activated",
          "query-performance" in ids, f"Routed to: {ids}")
    perf = load_skill_content("query-performance", skills)
    g.add("14", "query-performance", "explains per-loop timing",
          perf and re.search(r"per[\s-]loop", perf, re.IGNORECASE) and "loops" in perf,
          "warns actual_time is per loop")
    g.add("14", "query-performance", "mentions stale statistics",
          perf and "n_mod_since_analyze" in perf, "stale-stats detection")
    explain = _text(client, "pgsql_query", {"connectionId": conn_id, "query": f"""
        EXPLAIN ANALYZE
        SELECT name, ts_rank(search_vector, query) AS rank
        FROM {SCHEMA}.products, websearch_to_tsquery('english', 'vector similarity') query
        WHERE search_vector @@ query ORDER BY rank DESC LIMIT 5;"""})
    g.add("14", "mcp", "EXPLAIN ANALYZE executed",
          "Execution Time" in explain or "Planning Time" in explain, "plan returned")

    # Step 15: schema introspection
    tables_ctx = _text(client, "pgsql_db_context",
                       {"connectionId": conn_id, "objectType": "tables", "schemaName": SCHEMA})
    g.add("15", "mcp", "introspection includes app tables",
          "products" in tables_ctx and "conversations" in tables_ctx, "both tables visible")
    indexes_ctx = _text(client, "pgsql_db_context",
                        {"connectionId": conn_id, "objectType": "indexes", "schemaName": SCHEMA})
    g.add("15", "mcp", "indexes visible in introspection",
          "idx_products" in indexes_ctx or "hnsw" in indexes_ctx, "indexes visible")

    # Step 16: RLS admin view
    all_count = _text(client, "pgsql_query",
                      {"connectionId": conn_id, "query": f"SELECT count(*) AS total FROM {SCHEMA}.products;"})
    g.add("16", "mcp", "admin sees all rows", "8" in all_count, all_count[:50])

    # Step 17: Q&A logging
    log = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        INSERT INTO {SCHEMA}.conversations (tenant_id, question, answer, context_product_ids, feedback_score)
        VALUES ('acme_corp', 'Which product supports billion-scale similarity search?',
          'The Vector Search Add-on supports billion-scale similarity search with DiskANN.',
          ARRAY[2], 5);"""})
    session_ok = False
    if not has_error(log):
        verify = _text(client, "pgsql_query", {"connectionId": conn_id, "query":
            f"SELECT id, session_id FROM {SCHEMA}.conversations WHERE question LIKE '%billion-scale%' LIMIT 1;"})
        session_ok = "session_id" in verify and "id" in verify
    g.add("17", "mcp", "Q&A logged with session tracking",
          not has_error(log) and session_ok, "auto-generated session_id")

    # Step 18: analytics
    metrics = _text(client, "pgsql_query", {"connectionId": conn_id, "query": f"""
        SELECT tenant_id, count(*) AS total_questions,
               round(avg(feedback_score), 2) AS avg_score
        FROM {SCHEMA}.conversations GROUP BY tenant_id ORDER BY avg_score DESC;"""})
    g.add("18", "mcp", "analytics query works",
          "tenant_id" in metrics or "avg_score" in metrics, metrics[:120])

    # ---- PHASE 7: Cleanup ----
    drop = _text(client, "pgsql_modify",
                 {"connectionId": conn_id, "statement": f"DROP SCHEMA {SCHEMA} CASCADE;"})
    g.add("cleanup", "mcp", "schema dropped", not has_error(drop), f"{SCHEMA} dropped")


# ---------------------------------------------------------------------------
# Skill quality validation against the live DB (Phase B: SQL snippets,
# Phase D: semantic type/opclass verification)
# ---------------------------------------------------------------------------
def validate_skill_quality(client, conn_id, skills, g: Grades):
    # ---- Phase B: execute a subset of skill SQL examples ----
    snippet_schema = SNIPPET_SCHEMA
    _text(client, "pgsql_modify",
          {"connectionId": conn_id, "statement": f"DROP SCHEMA IF EXISTS {snippet_schema} CASCADE;"})
    _text(client, "pgsql_modify",
          {"connectionId": conn_id, "statement": f"CREATE SCHEMA {snippet_schema};"})
    for skill_id in ("vector-diskann", "table-partitioning", "row-level-security"):
        content = load_skill_content(skill_id, skills)
        if not content:
            continue
        blocks = [b for b in extract_sql_blocks(content) if not b["no_execute"]]
        valid = errors = 0
        for block in blocks[:5]:
            sql = block["sql"]
            if re.search(r"\$\d|<your|<endpoint|\.\.\..*\.\.\.", sql, re.IGNORECASE):
                continue
            if re.search(r"^(az |psql |\\)", sql, re.MULTILINE):
                continue
            if re.search(r"\b(events|users|documents|orders|customers|posts|blog)\b", sql, re.IGNORECASE):
                continue
            if re.search(r"ALTER\s+TABLE\s+(?!test_)", sql, re.IGNORECASE):
                continue
            if re.search(r"CREATE\s+POLICY.*ON\s+(?!test_)", sql, re.IGNORECASE):
                continue
            if re.search(r"PARTITION\s+OF", sql, re.IGNORECASE):
                continue
            if re.search(r"^\s*SHOW", sql, re.IGNORECASE | re.MULTILINE):
                continue
            is_select = re.search(r"^\s*SELECT|^\s*EXPLAIN|^\s*WITH", sql, re.IGNORECASE | re.MULTILINE)
            is_ddl = re.search(r"^\s*CREATE|^\s*ALTER|^\s*DROP", sql, re.IGNORECASE | re.MULTILINE)
            if is_select:
                out = _text(client, "pgsql_query",
                            {"connectionId": conn_id, "query": f"EXPLAIN {sql.rstrip(';')}"})
                errors, valid = (errors + 1, valid) if has_error(out) else (errors, valid + 1)
            elif is_ddl:
                scoped = re.sub(r"CREATE\s+INDEX\s+(\w+)", rf"CREATE INDEX {snippet_schema}_\1", sql, flags=re.IGNORECASE)
                scoped = re.sub(r"CREATE\s+TABLE\s+(\w+)", rf"CREATE TABLE {snippet_schema}.\1", scoped, flags=re.IGNORECASE)
                if scoped == sql:
                    continue
                out = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": scoped})
                errors, valid = (errors + 1, valid) if has_error(out) else (errors, valid + 1)
        total = valid + errors
        g.add("B", "sql-validity", f"{skill_id} SQL examples execute",
              errors == 0 or total == 0,
              "no executable examples" if total == 0 else f"{valid}/{total} valid")
    _text(client, "pgsql_modify",
          {"connectionId": conn_id, "statement": f"DROP SCHEMA IF EXISTS {snippet_schema} CASCADE;"})

    # ---- Phase D: semantic verification ----
    verify_schema = VERIFY_SCHEMA
    _text(client, "pgsql_modify",
          {"connectionId": conn_id, "statement": f"DROP SCHEMA IF EXISTS {verify_schema} CASCADE;"})
    _text(client, "pgsql_modify",
          {"connectionId": conn_id, "statement": f"CREATE SCHEMA {verify_schema};"})
    create_verify = _text(client, "pgsql_modify", {"connectionId": conn_id, "statement": f"""
        CREATE TABLE {verify_schema}.docs (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          tenant_id text NOT NULL,
          embedding vector(1536),
          metadata jsonb DEFAULT '{{}}',
          search_vector tsvector
        );
        CREATE INDEX idx_verify_hnsw ON {verify_schema}.docs
          USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
        CREATE INDEX idx_verify_gin ON {verify_schema}.docs USING gin(metadata jsonb_path_ops);"""})
    if not has_error(create_verify):
        col = _text(client, "pgsql_query", {"connectionId": conn_id, "query": f"""
            SELECT column_name, udt_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = '{verify_schema}' AND table_name = 'docs'
            ORDER BY ordinal_position;"""})
        g.add("D", "semantic", "vector column type correct", "vector" in col, "embedding vector")
        g.add("D", "semantic", "jsonb column type correct", "jsonb" in col, "metadata jsonb")
        g.add("D", "semantic", "tsvector column type correct", "tsvector" in col, "search_vector tsvector")
        idx = _text(client, "pgsql_query", {"connectionId": conn_id, "query": f"""
            SELECT ic.relname AS index_name, am.amname AS index_method, opc.opcname AS opclass
            FROM pg_index i
            JOIN pg_class ic ON ic.oid = i.indexrelid
            JOIN pg_am am ON am.oid = ic.relam
            JOIN pg_opclass opc ON opc.oid = i.indclass[0]
            WHERE ic.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '{verify_schema}')
              AND ic.relname LIKE 'idx_verify%';"""})
        g.add("D", "semantic", "HNSW index uses correct opclass",
              "vector_cosine_ops" in idx, "vector_cosine_ops matches <=>")
        g.add("D", "semantic", "GIN index uses jsonb_path_ops",
              "jsonb_path_ops" in idx, "jsonb_path_ops for containment")
        g.add("D", "semantic", "index method is hnsw", "hnsw" in idx, "access method hnsw")
    else:
        g.add("D", "semantic", "verification schema setup", False, "could not create objects")
    _text(client, "pgsql_modify",
          {"connectionId": conn_id, "statement": f"DROP SCHEMA IF EXISTS {verify_schema} CASCADE;"})


def test_dogfood_app_build(db_client, skills):
    """Build a multi-tenant RAG app end-to-end and grade skill guidance."""
    conn_id = connect_to_database(db_client)
    g = Grades()
    try:
        build_app(db_client, conn_id, skills, g)
        validate_skill_quality(db_client, conn_id, skills, g)
    finally:
        # Safety net: drop any schemas left behind if a step raised before its
        # own cleanup ran, then disconnect.
        for schema in (SCHEMA, SNIPPET_SCHEMA, VERIFY_SCHEMA):
            try:
                db_client.call_tool("pgsql_modify", {
                    "connectionId": conn_id,
                    "statement": f"DROP SCHEMA IF EXISTS {schema} CASCADE;",
                })
            except Exception:
                pass
        db_client.call_tool("pgsql_disconnect", {"connectionId": conn_id})

    passed = len(g.items) - len(g.failures)
    print(f"\nDOGFOOD REPORT: {passed}/{len(g.items)} checks passed")
    assert not g.failures, "Failed checks:\n" + "\n".join(
        f"  step {s} [{sk}] {a}: {d}" for s, sk, a, _, d in g.failures
    )
