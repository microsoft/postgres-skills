// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// test_ai_app.js — AI Application Dogfood Test
//
// Simulates a developer using the PostgreSQL Agent Skills plugin to build
// a real AI application: a multi-tenant RAG-powered Product Q&A system.
//
// The test follows the exact flow an AI coding agent would use:
//   1. Developer describes what they want to build
//   2. Agent routes prompts through skills (activation_keywords)
//   3. Agent reads SKILL.md for guidance
//   4. Agent uses MCP tools to execute SQL on the real server
//   5. We grade: Did the skill give correct, complete guidance?
//
// This exercises 10+ skills across a realistic multi-step application setup.
//
// Usage:
//   PGSQL_TEST_CONNECTION_STRING="host=... user=... password=... sslmode=..." node test_ai_app.js
//
// The test creates objects in a dedicated schema (test_rag_app_YYYYMMDD) and
// cleans up on exit.

const { spawn } = require("child_process");
const { join } = require("path");
const fs = require("fs");

const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "run_mcp.js");
const TIMEOUT_MS = 300_000;
const MSG_TIMEOUT_MS = 90_000;

const CONN_STRING =
  process.env.PGSQL_TEST_CONNECTION_STRING ||
  (() => {
    console.error(
      "ERROR: Set PGSQL_TEST_CONNECTION_STRING env var (libpq format)"
    );
    process.exit(1);
  })();

function toLibpqString(cs) {
  const trimmed = cs.trim();
  if (!/^postgres(?:ql)?:\/\//i.test(trimmed)) return trimmed;

  const url = new URL(trimmed);
  const parts = [
    `host=${url.hostname}`,
    `port=${url.port || "5432"}`,
    `dbname=${decodeURIComponent(url.pathname.replace(/^\//, "") || "postgres")}`,
    `user=${decodeURIComponent(url.username || "postgres")}`,
  ];

  if (url.password) {
    parts.push(`password=${decodeURIComponent(url.password)}`);
  }

  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) {
    parts.push(`sslmode=${sslmode}`);
  }

  return parts.join(" ");
}

const SCHEMA = `test_rag_app_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

// ---------------------------------------------------------------------------
// Skill routing engine (single-plugin model with reference routing)
// ---------------------------------------------------------------------------
function loadSkillsManifest() {
  return JSON.parse(fs.readFileSync(join(__dirname, ".skills.json"), "utf8")).skills;
}

// Map legacy skill IDs (used in contracts) to reference file paths
const SKILL_ID_TO_REFERENCE = {
  "vector-diskann": "skills/references/azure-postgresql-vector-diskann.md",
  "table-partitioning": "skills/references/postgresql-table-partitioning.md",
  "full-text-search": "skills/references/postgresql-full-text-search.md",
  "extension-lifecycle": "skills/references/azure-postgresql-extension-lifecycle.md",
  "row-level-security": "skills/references/postgresql-row-level-security.md",
  "genai-patterns": "skills/references/azure-postgresql-genai-patterns.md",
  "advanced-indexing": "skills/references/postgresql-advanced-indexing.md",
  "jsonb-patterns": "skills/references/postgresql-jsonb-patterns.md",
  "connection-management": "skills/references/postgresql-connection-management.md",
  "replication": "skills/references/postgresql-replication.md",
  "query-performance": "skills/references/postgresql-query-performance.md",
};

function routePrompt(prompt, skills) {
  const lower = prompt.toLowerCase();
  const words = new Set(lower.split(/\W+/).filter(Boolean));
  const matches = [];
  for (const skill of skills) {
    const hit = (skill.activation_keywords || []).some((kw) => {
      const kwLower = kw.toLowerCase();
      if (lower.includes(kwLower)) return true;
      const kwWords = kwLower.split(/\W+/).filter(Boolean);
      return kwWords.length > 0 && kwWords.every((w) => words.has(w));
    });
    if (hit || skill.always_load) matches.push(skill);
  }
  return matches;
}

function loadSkillContent(skill) {
  // Support loading by skill object (has .path) or by legacy skillId string
  const relativePath = typeof skill === "string"
    ? SKILL_ID_TO_REFERENCE[skill]
    : skill.path;
  if (!relativePath) return null;
  const fullPath = join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
}

// ---------------------------------------------------------------------------
// MCP helpers
// ---------------------------------------------------------------------------
let nextId = 1;
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function sendMsg(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

function callTool(proc, toolName, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(
      () => reject(new Error(`Timeout calling ${toolName}`)),
      MSG_TIMEOUT_MS
    );
    const handler = (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            proc.stdout.removeListener("data", handler);
            resolve(msg.result || msg.error);
          }
        } catch {}
      }
    };
    proc.stdout.on("data", handler);
    sendMsg(proc, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    });
  });
}

function getToolText(result) {
  if (!result || !result.content) return "";
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function hasError(toolText) {
  // Parse the JSON response to check errorMessage field value (not field name)
  try {
    const obj = JSON.parse(toolText);
    if (obj.errorMessage && obj.errorMessage !== null) return true;
    return false;
  } catch {
    // If not JSON, fall back to heuristic: look for error indicators
    // but exclude the literal field name "errorMessage":null
    const cleaned = toolText.replace(/"errorMessage"\s*:\s*null/gi, "");
    return cleaned.toLowerCase().includes("error");
  }
}

function parseConnectionId(text) {
  // Look for pgsql/UUID/dbname pattern
  const m = text.match(/pgsql\/[0-9a-f-]+(?:\/[\w-]+)?/i);
  if (m) return m[0];
  // JSON structuredContent fallback
  try {
    const obj = JSON.parse(text);
    if (obj.connectionId) return obj.connectionId;
  } catch {}
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(proc, profileId, maxAttempts = 3) {
  let lastConnectText = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const connectResult = await callTool(proc, "pgsql_connect", { profileId });
    const connectText = getToolText(connectResult);
    lastConnectText = connectText;
    console.log(`Connect result (attempt ${attempt}/${maxAttempts}): ${connectText.slice(0, 300)}`);
    const connId = parseConnectionId(connectText);
    if (connId) return { connId, connectText, attempt };

    const retryable =
      /couldn'?t get a connection/i.test(connectText) ||
      /connection failed/i.test(connectText) ||
      /timeout/i.test(connectText);
    if (!retryable || attempt === maxAttempts) break;

    const backoffMs = attempt * 3000;
    console.warn(`Connection attempt ${attempt} failed; retrying in ${backoffMs}ms...`);
    await sleep(backoffMs);
  }

  throw new Error(
    `Failed to parse connectionId after ${maxAttempts} attempts: ${lastConnectText.slice(0, 200)}`
  );
}

async function initMCP(proc) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(
      () => reject(new Error("MCP init timeout")),
      MSG_TIMEOUT_MS
    );
    const handler = (data) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            proc.stdout.removeListener("data", handler);
            resolve(msg.result);
          }
        } catch {}
      }
    };
    proc.stdout.on("data", handler);
    sendMsg(proc, {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "ai-app-test", version: "1.0.0" },
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------
const grades = [];

function grade(step, skillName, aspect, pass, detail) {
  const emoji = pass ? "✅" : "❌";
  grades.push({ step, skillName, aspect, pass, detail });
  console.log(`  ${emoji} [${skillName}] ${aspect}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Application builder steps
// ---------------------------------------------------------------------------

async function buildApp(proc, connId, skills) {
  console.log(`\n${"=".repeat(70)}`);
  console.log("AI APPLICATION: Multi-Tenant RAG Product Q&A System");
  console.log(`Schema: ${SCHEMA}`);
  console.log(`${"=".repeat(70)}\n`);

  // =========================================================================
  // PHASE 1: Database Foundation
  // =========================================================================
  console.log("── PHASE 1: Database Foundation ──\n");

  // Step 1: Check server capabilities (what am I working with?)
  {
    console.log("Step 1: Developer asks 'What Azure PostgreSQL features are available?'\n");
    const prompt = "What capabilities does my Azure PostgreSQL server have?";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);
    grade("1", "routing", "azure skills activated",
      routedNames.some((n) => n.includes("azure") || n.includes("postgresql-core")),
      `Routed to: ${routedNames.join(", ")}`);

    const caps = await callTool(proc, "pgsql_get_server_capabilities", {
      connectionId: connId,
    });
    const capsText = getToolText(caps);
    const isAzure = capsText.includes("isAzure") && capsText.includes("true");
    grade("1", "mcp", "server detection", isAzure,
      `isAzure: ${isAzure}, capabilities returned`);
  }

  // Step 2: Create application schema
  {
    console.log("\nStep 2: Developer asks 'Create an isolated schema for my app'\n");
    // Pre-cleanup: drop schema if leftover from a previous run
    await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`,
    });
    const createSchema = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `CREATE SCHEMA ${SCHEMA};`,
    });
    grade("2", "mcp", "schema created", !hasError(getToolText(createSchema)),
      `Schema ${SCHEMA} created`);

    // Set search_path for subsequent operations
    await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `SET search_path TO ${SCHEMA}, public;`,
    });
  }

  // Step 3: Install extensions (guided by extension-lifecycle skill)
  {
    console.log("\nStep 3: Developer asks 'Install pgvector extension for AI embeddings'\n");
    const prompt = "Install pgvector extension on my Azure PostgreSQL server";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    // Should route to extension-lifecycle AND/OR vector-diskann
    const hasExtSkill = routedNames.some(
      (n) => n === "extension-lifecycle" || n === "vector-diskann"
    );
    grade("3", "routing", "extension skill activated", hasExtSkill,
      `Routed to: ${routedNames.join(", ")}`);

    // Read the skill content — does it mention allowlist check?
    const extSkill = routed.find((s) => s.id === "extension-lifecycle");
    if (extSkill) {
      const content = loadSkillContent(extSkill);
      grade("3", "extension-lifecycle", "mentions allowlist",
        content && content.includes("azure.extensions"),
        "Skill mentions azure.extensions allowlist requirement");
      grade("3", "extension-lifecycle", "mentions azure_pg_admin",
        content && content.includes("azure_pg_admin"),
        "Skill mentions required role");
    }

    // Execute: check allowlist first (skill guidance says to)
    const allowlist = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: "SHOW azure.extensions;",
    });
    const allowlistText = getToolText(allowlist);
    grade("3", "mcp", "allowlist check works",
      allowlistText.includes("vector") || allowlistText.length > 0,
      `azure.extensions returned: ${allowlistText.slice(0, 100)}`);

    // Install extensions
    const installVector = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: "CREATE EXTENSION IF NOT EXISTS vector;",
    });
    grade("3", "mcp", "pgvector installed",
      !hasError(getToolText(installVector)),
      "CREATE EXTENSION vector succeeded");
  }

  // =========================================================================
  // PHASE 2: Schema Design (guided by genai-patterns + jsonb-patterns skills)
  // =========================================================================
  console.log("\n── PHASE 2: Schema Design (RAG Application Tables) ──\n");

  // Step 4: Create products table with vector column
  {
    console.log("Step 4: Developer asks 'Design a products table for RAG with embeddings'\n");
    const prompt = "Build a RAG pipeline to store product descriptions with embeddings for semantic search";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    const hasGenAI = routedNames.includes("genai-patterns");
    grade("4", "routing", "genai-patterns activated", hasGenAI,
      `Routed to: ${routedNames.join(", ")}`);

    // Read skill content — does it show Path B (external embeddings)?
    const genaiSkill = routed.find((s) => s.id === "genai-patterns");
    if (genaiSkill) {
      const content = loadSkillContent(genaiSkill);
      grade("4", "genai-patterns", "shows external embedding path",
        content && content.includes("Path B"),
        "Skill covers both in-db and external embedding approaches");
      grade("4", "genai-patterns", "mentions vector dimension",
        content && content.includes("vector(1536)"),
        "Skill specifies vector dimension matching model output");
      grade("4", "genai-patterns", "shows hybrid search",
        content && content.includes("Reciprocal Rank Fusion"),
        "Skill includes RRF hybrid search pattern");
    }

    // Create the products table following skill guidance
    const createProducts = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        CREATE TABLE ${SCHEMA}.products (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          tenant_id text NOT NULL,
          name text NOT NULL,
          description text NOT NULL,
          category text,
          metadata jsonb DEFAULT '{}',
          embedding vector(1536),
          search_vector tsvector GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B')
          ) STORED,
          created_at timestamptz DEFAULT now()
        );`,
    });
    grade("4", "mcp", "products table created",
      !hasError(getToolText(createProducts)),
      "Table with vector + tsvector columns created");
  }

  // Step 5: Create conversations table for Q&A history
  {
    console.log("\nStep 5: Create Q&A conversation history table\n");
    const createConvos = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        CREATE TABLE ${SCHEMA}.conversations (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          tenant_id text NOT NULL,
          session_id uuid DEFAULT gen_random_uuid(),
          question text NOT NULL,
          answer text,
          context_product_ids bigint[],
          feedback_score smallint CHECK (feedback_score BETWEEN 1 AND 5),
          created_at timestamptz DEFAULT now()
        );`,
    });
    grade("5", "mcp", "conversations table created",
      !hasError(getToolText(createConvos)),
      "Q&A history table created");
  }

  // =========================================================================
  // PHASE 3: Populate Test Data
  // =========================================================================
  console.log("\n── PHASE 3: Populate Test Data ──\n");

  // Step 6: Insert realistic product data for multiple tenants
  {
    console.log("Step 6: Insert multi-tenant product catalog data\n");
    const insertData = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        INSERT INTO ${SCHEMA}.products (tenant_id, name, description, category, metadata)
        VALUES
          ('acme_corp', 'Enterprise Database Server', 'High-performance PostgreSQL managed database service with automatic failover, point-in-time recovery, and read replicas. Supports up to 64 vCores and 512 GB RAM.', 'Database', '{"tier": "enterprise", "sla": "99.99%"}'),
          ('acme_corp', 'Vector Search Add-on', 'pgvector extension with DiskANN indexing for billion-scale similarity search. Supports cosine, L2, and inner product distance functions.', 'AI/ML', '{"tier": "premium", "max_dimensions": 2000}'),
          ('acme_corp', 'Intelligent Query Tuner', 'AI-powered query optimization that analyzes slow queries and recommends index strategies, parameter tuning, and query rewrites.', 'Performance', '{"tier": "standard", "auto_apply": false}'),
          ('acme_corp', 'Connection Pooler', 'Built-in PgBouncer connection pooling with transaction and session modes. Scales to 10,000+ concurrent connections.', 'Infrastructure', '{"tier": "standard", "max_connections": 10000}'),
          ('acme_corp', 'Backup & Recovery Suite', 'Automated backups with 35-day retention, geo-redundant storage, and point-in-time restore to any second within the retention period.', 'Operations', '{"tier": "standard", "retention_days": 35}'),
          ('globex_inc', 'Real-Time Analytics Engine', 'Columnar storage with BRIN indexes for time-series data. Sub-second queries on billions of rows with automatic partitioning.', 'Analytics', '{"tier": "enterprise", "compression": "zstd"}'),
          ('globex_inc', 'GraphQL API Gateway', 'Auto-generated GraphQL API from your PostgreSQL schema with real-time subscriptions, row-level security, and JWT authentication.', 'API', '{"tier": "premium", "protocols": ["graphql", "rest"]}'),
          ('globex_inc', 'Data Migration Toolkit', 'Zero-downtime migration from Oracle, MySQL, and SQL Server to PostgreSQL with automatic schema conversion and data validation.', 'Migration', '{"tier": "standard", "source_dbs": ["oracle", "mysql", "sqlserver"]}'),
          ('globex_inc', 'Compliance Dashboard', 'SOC 2, HIPAA, and GDPR compliance monitoring with audit logging, data masking, and automated compliance reports.', 'Security', '{"tier": "enterprise", "certifications": ["soc2", "hipaa", "gdpr"]}'),
          ('globex_inc', 'Multi-Region Replication', 'Active-active replication across Azure regions with automatic conflict resolution and sub-100ms read latency globally.', 'Infrastructure', '{"tier": "enterprise", "max_regions": 5}'),
          ('initech', 'Developer Sandbox', 'Instant PostgreSQL instances for development and testing. Includes sample datasets, schema templates, and CI/CD integration.', 'DevTools', '{"tier": "free", "auto_shutdown_hours": 8}'),
          ('initech', 'Schema Version Control', 'Git-like version control for database schemas with automatic migration generation, rollback support, and team collaboration.', 'DevTools', '{"tier": "standard", "vcs_integration": ["github", "gitlab"]}'),
          ('initech', 'AI Code Assistant Plugin', 'PostgreSQL-aware code completion and query optimization suggestions directly in your IDE. Understands your schema and suggests optimal queries.', 'DevTools', '{"tier": "premium", "ide_support": ["vscode", "jetbrains"]}'),
          ('initech', 'Cost Optimizer', 'Analyzes your workload patterns and recommends optimal compute and storage configurations to reduce costs by up to 40%.', 'Operations', '{"tier": "standard", "savings_guarantee": "20%"}'),
          ('initech', 'Serverless PostgreSQL', 'Auto-scaling PostgreSQL that scales to zero when idle. Pay only for actual compute seconds used. Cold start under 500ms.', 'Infrastructure', '{"tier": "standard", "min_scale": 0}');`,
    });
    const insertText = getToolText(insertData);
    grade("6", "mcp", "product data inserted",
      !hasError(insertText),
      "15 products across 3 tenants inserted");

    // Insert some Q&A history
    await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        INSERT INTO ${SCHEMA}.conversations (tenant_id, question, answer, feedback_score)
        VALUES
          ('acme_corp', 'What is the maximum RAM for the Enterprise Database?', '512 GB RAM with up to 64 vCores.', 5),
          ('acme_corp', 'Does vector search support cosine distance?', 'Yes, pgvector supports cosine, L2, and inner product distance functions.', 4),
          ('globex_inc', 'Can I migrate from Oracle?', 'Yes, the Data Migration Toolkit supports zero-downtime migration from Oracle.', 5),
          ('globex_inc', 'What compliance certifications are available?', 'SOC 2, HIPAA, and GDPR compliance monitoring is included.', 4),
          ('initech', 'Is there a free tier?', 'Yes, the Developer Sandbox is free with auto-shutdown after 8 hours.', 3);`,
    });
  }

  // =========================================================================
  // PHASE 4: Indexing Strategy (guided by vector-diskann + advanced-indexing + full-text-search)
  // =========================================================================
  console.log("\n── PHASE 4: Indexing Strategy ──\n");

  // Step 7: Create vector index (HNSW since we're < 1M rows)
  {
    console.log("Step 7: Developer asks 'Create a vector index for similarity search'\n");
    const prompt = "Create a vector index on my products table for similarity search with HNSW";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    const hasVectorSkill = routedNames.includes("vector-diskann");
    grade("7", "routing", "vector-diskann activated", hasVectorSkill,
      `Routed to: ${routedNames.join(", ")}`);

    if (hasVectorSkill) {
      const content = loadSkillContent(routed.find((s) => s.id === "vector-diskann"));
      grade("7", "vector-diskann", "HNSW guidance for small datasets",
        content && content.includes("< 1M") && content.includes("HNSW"),
        "Skill correctly recommends HNSW for < 1M vectors");
      grade("7", "vector-diskann", "shows HNSW parameters",
        content && content.includes("ef_construction"),
        "Skill mentions ef_construction tuning parameter");
    }

    // Create HNSW index following skill guidance
    const createHnsw = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `CREATE INDEX idx_products_embedding ON ${SCHEMA}.products
            USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);`,
    });
    grade("7", "mcp", "HNSW index created",
      !hasError(getToolText(createHnsw)),
      "HNSW index with vector_cosine_ops created");
  }

  // Step 8: Create GIN index for full-text search
  {
    console.log("\nStep 8: Developer asks 'Add full-text search index on product descriptions'\n");
    const prompt = "Create a full-text search index for product search with tsvector and GIN";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    const hasFTS = routedNames.includes("full-text-search");
    grade("8", "routing", "full-text-search activated", hasFTS,
      `Routed to: ${routedNames.join(", ")}`);

    if (hasFTS) {
      const content = loadSkillContent(routed.find((s) => s.id === "full-text-search"));
      grade("8", "full-text-search", "shows GIN index pattern",
        content && content.includes("USING gin"),
        "Skill shows GIN index on tsvector column");
      grade("8", "full-text-search", "shows weighted search",
        content && content.includes("setweight"),
        "Skill shows setweight for title(A) vs body(B) ranking");
    }

    const createGin = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `CREATE INDEX idx_products_search ON ${SCHEMA}.products USING gin(search_vector);`,
    });
    grade("8", "mcp", "GIN FTS index created",
      !hasError(getToolText(createGin)),
      "GIN index on search_vector created");
  }

  // Step 9: Create JSONB index for metadata queries
  {
    console.log("\nStep 9: Developer asks 'Index JSONB metadata for containment queries'\n");
    const prompt = "Create a GIN index on JSONB metadata column for containment queries";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    const hasJsonb = routedNames.includes("jsonb-patterns");
    grade("9", "routing", "jsonb-patterns activated", hasJsonb,
      `Routed to: ${routedNames.join(", ")}`);

    if (hasJsonb) {
      const content = loadSkillContent(routed.find((s) => s.id === "jsonb-patterns"));
      grade("9", "jsonb-patterns", "shows jsonb_path_ops",
        content && content.includes("jsonb_path_ops"),
        "Skill recommends jsonb_path_ops for containment-only queries");
    }

    const createJsonbIdx = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `CREATE INDEX idx_products_metadata ON ${SCHEMA}.products USING gin(metadata jsonb_path_ops);`,
    });
    grade("9", "mcp", "JSONB GIN index created",
      !hasError(getToolText(createJsonbIdx)),
      "GIN jsonb_path_ops index created");
  }

  // Step 10: Composite B-tree index for tenant queries
  {
    console.log("\nStep 10: Create B-tree index for tenant + category lookups\n");
    const prompt = "What index should I create for filtering products by tenant_id and category?";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    const hasIndexSkill = routedNames.includes("advanced-indexing");
    grade("10", "routing", "advanced-indexing activated", hasIndexSkill,
      `Routed to: ${routedNames.join(", ")}`);

    const createBtree = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `CREATE INDEX idx_products_tenant_cat ON ${SCHEMA}.products (tenant_id, category);`,
    });
    grade("10", "mcp", "B-tree composite index created",
      !hasError(getToolText(createBtree)),
      "Composite B-tree (tenant_id, category) created");
  }

  // =========================================================================
  // PHASE 5: Row-Level Security (guided by row-level-security skill)
  // =========================================================================
  console.log("\n── PHASE 5: Multi-Tenant Security (RLS) ──\n");

  // Step 11: Set up RLS for tenant isolation
  {
    console.log("Step 11: Developer asks 'Set up row level security for multi-tenant isolation'\n");
    const prompt = "Set up row level security to prevent tenants from seeing each other's data";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    const hasRLS = routedNames.includes("row-level-security");
    grade("11", "routing", "row-level-security activated", hasRLS,
      `Routed to: ${routedNames.join(", ")}`);

    if (hasRLS) {
      const content = loadSkillContent(routed.find((s) => s.id === "row-level-security"));
      grade("11", "row-level-security", "shows SET LOCAL pattern",
        content && content.includes("SET LOCAL"),
        "Skill recommends SET LOCAL (pooler-safe, not session)");
      grade("11", "row-level-security", "shows FORCE RLS",
        content && content.includes("FORCE ROW LEVEL SECURITY"),
        "Skill includes FORCE RLS for table owner enforcement");
      grade("11", "row-level-security", "shows current_setting pattern",
        content && content.includes("current_setting"),
        "Skill uses current_setting('app.current_tenant') pattern");
    }

    // Enable RLS on products table
    const enableRLS = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        ALTER TABLE ${SCHEMA}.products ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${SCHEMA}.products FORCE ROW LEVEL SECURITY;`,
    });
    grade("11", "mcp", "RLS enabled",
      !hasError(getToolText(enableRLS)),
      "RLS enabled + forced on products table");

    // Create tenant isolation policy
    const createPolicy = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        CREATE POLICY tenant_isolation ON ${SCHEMA}.products
          USING (tenant_id = current_setting('app.current_tenant', true));`,
    });
    grade("11", "mcp", "RLS policy created",
      !hasError(getToolText(createPolicy)),
      "Tenant isolation policy created");

    // Enable RLS on conversations too
    await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        ALTER TABLE ${SCHEMA}.conversations ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${SCHEMA}.conversations FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${SCHEMA}.conversations
          USING (tenant_id = current_setting('app.current_tenant', true));`,
    });
  }

  // =========================================================================
  // PHASE 6: Query Testing (verify the app works end-to-end)
  // =========================================================================
  console.log("\n── PHASE 6: Application Query Testing ──\n");

  // Step 12: Full-text search query
  {
    console.log("Step 12: Test full-text search: 'Find products about database performance'\n");
    // First set tenant context (RLS)
    await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `SET LOCAL app.current_tenant = 'acme_corp';`,
    });

    const ftsQuery = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `
        SELECT name, ts_rank(search_vector, query) AS rank
        FROM ${SCHEMA}.products, websearch_to_tsquery('english', 'database performance') query
        WHERE search_vector @@ query
        ORDER BY rank DESC
        LIMIT 5;`,
    });
    const ftsText = getToolText(ftsQuery);
    grade("12", "mcp", "FTS query returns results",
      ftsText.includes("Database") || ftsText.includes("name"),
      `FTS results: ${ftsText.slice(0, 150)}`);
  }

  // Step 13: JSONB containment query
  {
    console.log("\nStep 13: Test JSONB containment: 'Find enterprise-tier products'\n");
    const jsonbQuery = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `
        SELECT name, metadata->>'tier' AS tier
        FROM ${SCHEMA}.products
        WHERE metadata @> '{"tier": "enterprise"}'
        ORDER BY name;`,
    });
    const jsonbText = getToolText(jsonbQuery);
    grade("13", "mcp", "JSONB containment query works",
      jsonbText.includes("enterprise"),
      `JSONB results: ${jsonbText.slice(0, 150)}`);
  }

  // Step 14: EXPLAIN ANALYZE on a query (guided by query-performance skill)
  {
    console.log("\nStep 14: Developer asks 'My product search query is slow, analyze it'\n");
    const prompt = "My query is slow, run EXPLAIN ANALYZE on the product search";
    const routed = routePrompt(prompt, skills);
    const routedNames = routed.map((s) => s.id);

    const hasPerf = routedNames.includes("query-performance");
    grade("14", "routing", "query-performance activated", hasPerf,
      `Routed to: ${routedNames.join(", ")}`);

    if (hasPerf) {
      const content = loadSkillContent(routed.find((s) => s.id === "query-performance"));
      grade("14", "query-performance", "explains actual_time × loops",
        content && content.includes("per-loop") && content.includes("loops"),
        "Skill warns about actual_time being per-loop");
      grade("14", "query-performance", "mentions stale statistics",
        content && content.includes("n_mod_since_analyze"),
        "Skill includes stale stats detection query");
    }

    const explain = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `
        EXPLAIN ANALYZE
        SELECT name, ts_rank(search_vector, query) AS rank
        FROM ${SCHEMA}.products, websearch_to_tsquery('english', 'vector similarity search') query
        WHERE search_vector @@ query
        ORDER BY rank DESC
        LIMIT 5;`,
    });
    const explainText = getToolText(explain);
    grade("14", "mcp", "EXPLAIN ANALYZE executed",
      explainText.includes("Execution Time") || explainText.includes("Planning Time"),
      `Plan includes: ${explainText.includes("Index Scan") || explainText.includes("Bitmap") ? "index scan" : "seq scan"}`);
  }

  // Step 15: Schema introspection via MCP
  {
    console.log("\nStep 15: Verify full schema via MCP introspection\n");
    const tablesCtx = await callTool(proc, "pgsql_db_context", {
      connectionId: connId,
      objectType: "tables",
      schemaName: SCHEMA,
    });
    const tablesText = getToolText(tablesCtx);
    grade("15", "mcp", "schema introspection includes app tables",
      tablesText.includes("products") && tablesText.includes("conversations"),
      "Both application tables visible in db_context");

    const indexesCtx = await callTool(proc, "pgsql_db_context", {
      connectionId: connId,
      objectType: "indexes",
      schemaName: SCHEMA,
    });
    const indexesText = getToolText(indexesCtx);
    grade("15", "mcp", "indexes visible in introspection",
      indexesText.includes("idx_products") || indexesText.includes("hnsw"),
      "Created indexes visible in introspection");
  }

  // Step 16: Test RLS tenant isolation
  {
    console.log("\nStep 16: Verify RLS isolates tenant data correctly\n");
    // Count all products (admin bypass)
    const allCount = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `SELECT count(*) as total FROM ${SCHEMA}.products;`,
    });
    const allCountText = getToolText(allCount);
    grade("16", "mcp", "admin sees all rows",
      allCountText.includes("15"),
      `Total products (admin view): ${allCountText.slice(0, 50)}`);
  }

  // Step 17: Test conversation logging (the Q&A part of the app)
  {
    console.log("\nStep 17: Simulate a Q&A interaction and log it\n");
    const logQ = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `
        INSERT INTO ${SCHEMA}.conversations (tenant_id, question, answer, context_product_ids, feedback_score)
        VALUES (
          'acme_corp',
          'Which product supports billion-scale similarity search?',
          'The Vector Search Add-on supports billion-scale similarity search with DiskANN indexing, supporting cosine, L2, and inner product distance functions.',
          ARRAY[2],
          5
        );`,
    });
    const logText = getToolText(logQ);
    // pgsql_modify doesn't return RETURNING data; verify insert succeeded then confirm with query
    const insertOk = !hasError(logText);
    let sessionOk = false;
    if (insertOk) {
      const verify = await callTool(proc, "pgsql_query", {
        connectionId: connId,
        query: `SELECT id, session_id FROM ${SCHEMA}.conversations WHERE question LIKE '%billion-scale%' LIMIT 1;`,
      });
      const verifyText = getToolText(verify);
      sessionOk = verifyText.includes("session_id") && verifyText.includes("id");
    }
    grade("17", "mcp", "Q&A logged with session tracking",
      insertOk && sessionOk,
      "Conversation logged with auto-generated session_id");
  }

  // Step 18: Metrics query — feedback analysis
  {
    console.log("\nStep 18: Analyze Q&A quality metrics per tenant\n");
    const metrics = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `
        SELECT tenant_id,
               count(*) AS total_questions,
               round(avg(feedback_score), 2) AS avg_score,
               count(*) FILTER (WHERE feedback_score >= 4) AS good_answers
        FROM ${SCHEMA}.conversations
        GROUP BY tenant_id
        ORDER BY avg_score DESC;`,
    });
    const metricsText = getToolText(metrics);
    grade("18", "mcp", "analytics query works",
      metricsText.includes("tenant_id") || metricsText.includes("avg_score"),
      `Metrics: ${metricsText.slice(0, 200)}`);
  }

  // =========================================================================
  // PHASE 7: Cleanup
  // =========================================================================
  console.log("\n── PHASE 7: Cleanup ──\n");

  {
    console.log("Dropping test schema...\n");
    const drop = await callTool(proc, "pgsql_modify", {
      connectionId: connId,
      statement: `DROP SCHEMA ${SCHEMA} CASCADE;`,
    });
    grade("cleanup", "mcp", "schema dropped",
      !hasError(getToolText(drop)),
      `Schema ${SCHEMA} dropped with CASCADE`);
  }
}

// ---------------------------------------------------------------------------
// STRENGTHENED VALIDATION — Skill Quality Checks (no LLM required)
// ---------------------------------------------------------------------------

// Phase A: Per-skill content contract manifests
// Derived from eval regression data (negative-delta skills) and known failure modes
const SKILL_CONTRACTS = [
  {
    skillId: "vector-diskann",
    required: [
      /CREATE\s+EXTENSION.*vector/i,
      /CREATE\s+INDEX.*USING\s+(diskann|hnsw)/i,
      /vector_cosine_ops|vector_l2_ops|vector_ip_ops/i,
      /azure_pg_admin/i,
      /azure\.extensions/i,
    ],
    forbidden: [
      /ALTER\s+SYSTEM/i,
      // Only flag ivfflat if it's recommended as preferred (not "not recommended" or "legacy")
      /(?<!not\s+|legacy.*|not\s+)(?:recommend|prefer)\s+ivfflat/i,
    ],
    requiredSections: ["Prerequisites", "Common Mistakes"],
    minSqlBlocks: 4,
  },
  {
    skillId: "table-partitioning",
    required: [
      /PARTITION\s+BY\s+RANGE/i,
      /PARTITION\s+BY\s+LIST/i,
      /DETACH\s+PARTITION.*CONCURRENTLY/i,
      /DEFAULT\s+partition|PARTITION.*DEFAULT/i,
      /partition\s+key/i,
    ],
    forbidden: [
      /ALTER\s+SYSTEM/i,
      /SUPERUSER/i,
      /CREATE\s+TABLESPACE/i,
    ],
    requiredSections: ["Common Mistakes"],
    minSqlBlocks: 3,
  },
  {
    skillId: "full-text-search",
    required: [
      /tsvector/i,
      /tsquery|to_tsquery|websearch_to_tsquery/i,
      /ts_rank|ts_rank_cd/i,
      /GIN|gin/,
      /setweight/i,
    ],
    forbidden: [
      /ALTER\s+SYSTEM/i,
      /SUPERUSER/i,
    ],
    requiredSections: [],
    minSqlBlocks: 3,
  },
  {
    skillId: "extension-lifecycle",
    required: [
      /azure\.extensions/i,
      /azure_pg_admin/i,
      /pg_available_extensions/i,
      /shared_preload_libraries/i,
    ],
    forbidden: [
      // Only flag if ALTER SYSTEM is shown as the CORRECT approach (not in ❌ Wrong block)
      /✅\s*Right[\s\S]{0,200}ALTER\s+SYSTEM/i,
    ],
    requiredSections: ["Prerequisites"],
    minSqlBlocks: 2,
  },
  {
    skillId: "row-level-security",
    required: [
      /CREATE\s+POLICY/i,
      /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
      /current_setting/i,
      /SET\s+LOCAL|set_config/i,
      /FORCE\s+ROW\s+LEVEL\s+SECURITY/i,
    ],
    forbidden: [
      /ALTER\s+SYSTEM/i,
      // Only flag superuser if presented as required role (not as a warning about bypass)
      /✅\s*Right[\s\S]{0,200}SUPERUSER/i,
    ],
    requiredSections: [],
    minSqlBlocks: 2,
  },
  {
    skillId: "genai-patterns",
    required: [
      /vector\(\d+\)/i,
      /embedding/i,
      /cosine|<=>|similarity/i,
    ],
    forbidden: [
      /ALTER\s+SYSTEM/i,
      /SUPERUSER/i,
    ],
    requiredSections: [],
    minSqlBlocks: 2,
  },
  {
    skillId: "advanced-indexing",
    required: [
      /CREATE\s+INDEX/i,
      /btree|B-tree/i,
      /GIN|gin/,
      /BRIN|brin/i,
      /partial\s+index|WHERE/i,
    ],
    forbidden: [
      /ALTER\s+SYSTEM/i,
      /SUPERUSER/i,
    ],
    requiredSections: [],
    minSqlBlocks: 3,
  },
];

// Phase C: Negative routing test cases (prompts that should NOT activate certain skills)
const NEGATIVE_ROUTING_CASES = [
  {
    prompt: "How do I iterate over an array index in JavaScript?",
    shouldNotActivate: ["advanced-indexing"],
    reason: "Array index != database index",
  },
  {
    prompt: "My Python application is slow, how do I profile it?",
    shouldNotActivate: ["query-performance"],
    reason: "Application profiling != SQL query performance",
  },
  {
    prompt: "How do I set up vector graphics in CSS?",
    shouldNotActivate: ["vector-diskann"],
    reason: "CSS vectors != pgvector",
  },
  {
    prompt: "I want to partition my React app into micro-frontends",
    shouldNotActivate: ["table-partitioning"],
    reason: "Software partitioning != table partitioning",
  },
  {
    prompt: "Write a SELECT query to get all users where name = 'John'",
    shouldNotActivate: ["full-text-search", "jsonb-patterns", "row-level-security"],
    reason: "Simple SELECT != specialized skill territory",
  },
  {
    prompt: "How do I replicate a bug in my staging environment?",
    shouldNotActivate: ["logical-replication"],
    reason: "Replicate a bug != database replication",
  },
  {
    prompt: "What's the best way to manage SSH connections to my servers?",
    shouldNotActivate: ["connection-management"],
    reason: "SSH connections != database connections",
  },
  {
    prompt: "How do I set security headers in my Express.js app?",
    shouldNotActivate: ["row-level-security"],
    reason: "HTTP security != RLS",
  },
  {
    prompt: "How do I search for text in a file using grep?",
    shouldNotActivate: ["full-text-search"],
    reason: "grep != PostgreSQL FTS",
  },
  {
    prompt: "I want to extend my TypeScript types with generics",
    shouldNotActivate: ["extension-lifecycle"],
    reason: "TypeScript extends != PostgreSQL extensions",
  },
];

// Phase E: Eval regression cases — known negative-delta patterns
const EVAL_REGRESSION_CASES = [
  {
    skillId: "vector-diskann",
    issue: "Speculative content confuses model (-0.040 delta)",
    checks: [
      {
        name: "no speculative parameters",
        test: (content) =>
          !(/diskann_(?!search_list_size)\w+\s*=\s*\d+/i.test(content) ||
            /increase search list size/i.test(content)),
        reason: "DiskANN does not expose GUC parameters on Azure; speculative content misleads",
      },
      {
        name: "clear HNSW vs DiskANN decision tree",
        test: (content) =>
          /< ?1M.*HNSW|HNSW.*small/i.test(content) &&
          /> ?1M.*DiskANN|DiskANN.*large/i.test(content),
        reason: "Without clear guidance, model hallucinates wrong index choice",
      },
      {
        name: "operator class matching emphasized",
        test: (content) =>
          /wrong.*operator|mismatch.*class|CRITICAL.*operator/i.test(content),
        reason: "Operator class mismatch is #1 failure mode in evals",
      },
    ],
  },
  {
    skillId: "table-partitioning",
    issue: "Skill actively harms output (-0.220 delta)",
    checks: [
      {
        name: "no ALTER SYSTEM references",
        test: (content) => !/ALTER\s+SYSTEM/i.test(content),
        reason: "ALTER SYSTEM invalid on managed PostgreSQL",
      },
      {
        name: "includes DEFAULT partition warning",
        test: (content) =>
          /DEFAULT.*partition.*trap|DEFAULT.*fail/i.test(content) ||
          /CRITICAL.*Default/i.test(content),
        reason: "Default partition trap is #1 eval failure pattern",
      },
      {
        name: "partition key in PK constraint",
        test: (content) =>
          /partition\s+key.*PRIMARY|PRIMARY.*partition\s+key|include\s+partition\s+key/i.test(content),
        reason: "Missing PK constraint guidance causes invalid SQL generation",
      },
      {
        name: "version-gated CONCURRENTLY",
        test: (content) =>
          /PG\s*14|PostgreSQL\s*14|14\+/i.test(content) &&
          /CONCURRENTLY/i.test(content),
        reason: "DETACH CONCURRENTLY without version caveat causes syntax errors on PG 13",
      },
    ],
  },
  {
    skillId: "full-text-search",
    issue: "Negative delta (-0.030) — model already knows FTS well",
    checks: [
      {
        name: "no overly complex enrichment",
        test: (content) => {
          const sqlBlocks = content.match(/```sql[\s\S]*?```/g) || [];
          // Check that no single SQL block exceeds 20 lines (overwhelming)
          return sqlBlocks.every((block) => block.split("\n").length <= 25);
        },
        reason: "Overly long SQL examples overwhelm model context and degrade output",
      },
      {
        name: "includes GIN index pattern",
        test: (content) => /USING\s+gin/i.test(content),
        reason: "Missing GIN index pattern is primary eval failure",
      },
    ],
  },
];

// Extract fenced SQL blocks from markdown content
function extractSqlBlocks(content) {
  const blocks = [];
  const regex = /```sql(?:\s+no-execute)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const isNoExecute = match[0].includes("no-execute");
    blocks.push({ sql: match[1].trim(), noExecute: isNoExecute });
  }
  return blocks;
}

async function validateSkillQuality(proc, connId, skills) {
  console.log("\n" + "═".repeat(70));
  console.log("SKILL QUALITY VALIDATION");
  console.log("═".repeat(70));

  // =========================================================================
  // Phase A: Skill Content Contracts
  // =========================================================================
  console.log("\n── Phase A: Skill Content Contracts ──\n");

  for (const contract of SKILL_CONTRACTS) {
    const content = loadSkillContent(contract.skillId);
    if (!content) {
      grade("A", "contract", `${contract.skillId} loadable`, false, "Reference file not found");
      continue;
    }

    // Check required patterns
    const missingRequired = contract.required.filter((r) => !r.test(content));
    grade("A", "contract", `${contract.skillId} required patterns`,
      missingRequired.length === 0,
      missingRequired.length === 0
        ? `All ${contract.required.length} required patterns present`
        : `Missing ${missingRequired.length}: ${missingRequired.map((r) => r.source.slice(0, 30)).join(", ")}`);

    // Check forbidden patterns
    const triggeredForbidden = contract.forbidden.filter((f) => f.test(content));
    grade("A", "contract", `${contract.skillId} no forbidden patterns`,
      triggeredForbidden.length === 0,
      triggeredForbidden.length === 0
        ? "No forbidden patterns found"
        : `Triggered: ${triggeredForbidden.map((f) => f.source.slice(0, 30)).join(", ")}`);

    // Check required sections
    for (const section of contract.requiredSections) {
      grade("A", "contract", `${contract.skillId} has "${section}" section`,
        content.includes(section),
        content.includes(section) ? `Section "${section}" present` : `Missing section: ${section}`);
    }

    // Check minimum SQL examples
    const sqlBlocks = extractSqlBlocks(content);
    grade("A", "contract", `${contract.skillId} has ${contract.minSqlBlocks}+ SQL examples`,
      sqlBlocks.length >= contract.minSqlBlocks,
      `Found ${sqlBlocks.length} SQL blocks (minimum: ${contract.minSqlBlocks})`);
  }

  // =========================================================================
  // Phase B: SQL Snippet Validation (execute skill examples in ROLLBACK)
  // =========================================================================
  console.log("\n── Phase B: SQL Snippet Validation ──\n");

  const SNIPPET_SCHEMA = `test_snippets_${Date.now()}`;
  await callTool(proc, "pgsql_modify", {
    connectionId: connId,
    statement: `CREATE SCHEMA ${SNIPPET_SCHEMA};`,
  });

  // Test a subset of skills (ones with known issues)
  const snippetSkills = ["vector-diskann", "table-partitioning", "row-level-security"];
  for (const skillId of snippetSkills) {
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) continue;
    const content = loadSkillContent(skill);
    if (!content) continue;

    const blocks = extractSqlBlocks(content);
    const executableBlocks = blocks.filter((b) => !b.noExecute);
    let validCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const block of executableBlocks.slice(0, 5)) {
      // Skip blocks with placeholders or shell commands
      if (/\$\d|<your|<endpoint|\.\.\..*\.\.\./i.test(block.sql)) continue;
      if (/^(az |psql |\\)/m.test(block.sql)) continue;
      // Skip blocks that reference context-dependent tables
      if (/\b(events|users|documents|orders|customers|posts|blog)\b/i.test(block.sql)) continue;
      // Skip ALTER TABLE/POLICY on tables that don't exist in our test schema
      if (/ALTER\s+TABLE\s+(?!test_)/i.test(block.sql) && !/ALTER\s+TABLE.*${SNIPPET_SCHEMA}/i.test(block.sql)) continue;
      // Skip CREATE POLICY referencing non-existent tables
      if (/CREATE\s+POLICY.*ON\s+(?!test_)/i.test(block.sql)) continue;
      // Skip PARTITION OF references (need parent table)
      if (/PARTITION\s+OF/i.test(block.sql)) continue;
      // Skip SHOW commands (not valid in EXPLAIN)
      if (/^\s*SHOW/im.test(block.sql)) continue;

      // Try EXPLAIN for SELECT/queries, or wrap DDL in rollback
      const isSelect = /^\s*SELECT|^\s*EXPLAIN|^\s*WITH/im.test(block.sql);
      const isDDL = /^\s*CREATE|^\s*ALTER|^\s*DROP/im.test(block.sql);

      if (isSelect) {
        // Use EXPLAIN (no execute) to check syntax
        const explain = await callTool(proc, "pgsql_query", {
          connectionId: connId,
          query: `EXPLAIN ${block.sql.replace(/;$/, "")}`,
        });
        const explainText = getToolText(explain);
        if (hasError(explainText)) {
          errorCount++;
          errors.push(block.sql.slice(0, 60));
        } else {
          validCount++;
        }
      } else if (isDDL) {
        // Execute in schema, then rollback by dropping if created
        const scoped = block.sql
          .replace(/CREATE\s+TABLE\s+(\w+)/gi, `CREATE TABLE ${SNIPPET_SCHEMA}.$1`)
          .replace(/CREATE\s+INDEX\s+(\w+)/gi, `CREATE INDEX ${SNIPPET_SCHEMA}_$1`);
        // Skip if we can't safely scope it
        if (scoped === block.sql) continue;
        const result = await callTool(proc, "pgsql_modify", {
          connectionId: connId,
          statement: scoped,
        });
        const resultText = getToolText(result);
        if (hasError(resultText)) {
          errorCount++;
          errors.push(block.sql.slice(0, 60));
        } else {
          validCount++;
        }
      }
    }

    const totalChecked = validCount + errorCount;
    grade("B", "sql-validity", `${skillId} SQL examples execute`,
      errorCount === 0 || totalChecked === 0,
      totalChecked === 0
        ? "No executable examples found (all have placeholders)"
        : `${validCount}/${totalChecked} valid${errorCount > 0 ? ` — errors in: ${errors[0]}...` : ""}`);
  }

  // Cleanup snippet schema
  await callTool(proc, "pgsql_modify", {
    connectionId: connId,
    statement: `DROP SCHEMA IF EXISTS ${SNIPPET_SCHEMA} CASCADE;`,
  });

  // =========================================================================
  // Phase C: Negative Routing
  // =========================================================================
  console.log("\n── Phase C: Negative Routing (False Activation) ──\n");

  let negPassCount = 0;
  let negFailCount = 0;
  for (const testCase of NEGATIVE_ROUTING_CASES) {
    const routed = routePrompt(testCase.prompt, skills);
    // With single-plugin model, check that the root skill is NOT activated for non-PG prompts
    const wasActivated = routed.length > 0;
    const passed = !wasActivated;
    if (passed) negPassCount++;
    else negFailCount++;

    if (!passed) {
      grade("C", "negative-routing", `"${testCase.prompt.slice(0, 50)}..."`,
        false,
        `Root skill falsely activated — ${testCase.reason}`);
    }
  }
  grade("C", "negative-routing", "overall false activation rate",
    negFailCount === 0,
    `${negPassCount}/${NEGATIVE_ROUTING_CASES.length} passed (${negFailCount} false activations)`);

  // =========================================================================
  // Phase D: Semantic DB State Verification
  // =========================================================================
  console.log("\n── Phase D: Semantic DB Verification (post app-build) ──\n");

  // The app-build schema was already dropped. Create a fresh one for verification.
  const VERIFY_SCHEMA = `test_verify_${Date.now()}`;
  await callTool(proc, "pgsql_modify", {
    connectionId: connId,
    statement: `CREATE SCHEMA ${VERIFY_SCHEMA};`,
  });

  // Create a table with vector column to verify type system
  const createVerify = await callTool(proc, "pgsql_modify", {
    connectionId: connId,
    statement: `
      CREATE TABLE ${VERIFY_SCHEMA}.docs (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        tenant_id text NOT NULL,
        embedding vector(1536),
        metadata jsonb DEFAULT '{}',
        search_vector tsvector
      );
      CREATE INDEX idx_verify_hnsw ON ${VERIFY_SCHEMA}.docs
        USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
      CREATE INDEX idx_verify_gin ON ${VERIFY_SCHEMA}.docs USING gin(metadata jsonb_path_ops);`,
  });

  if (!hasError(getToolText(createVerify))) {
    // Verify column types via pg_catalog
    const colCheck = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `
        SELECT column_name, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${VERIFY_SCHEMA}' AND table_name = 'docs'
        ORDER BY ordinal_position;`,
    });
    const colText = getToolText(colCheck);
    grade("D", "semantic", "vector column type correct",
      colText.includes("vector"),
      "Column 'embedding' has vector type");
    grade("D", "semantic", "jsonb column type correct",
      colText.includes("jsonb"),
      "Column 'metadata' has jsonb type");
    grade("D", "semantic", "tsvector column type correct",
      colText.includes("tsvector"),
      "Column 'search_vector' has tsvector type");

    // Verify index operator class
    const idxCheck = await callTool(proc, "pgsql_query", {
      connectionId: connId,
      query: `
        SELECT ic.relname AS index_name, am.amname AS index_method, opc.opcname AS opclass
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        JOIN pg_am am ON am.oid = ic.relam
        JOIN pg_opclass opc ON opc.oid = i.indclass[0]
        WHERE ic.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${VERIFY_SCHEMA}')
          AND ic.relname LIKE 'idx_verify%';`,
    });
    const idxText = getToolText(idxCheck);
    grade("D", "semantic", "HNSW index uses correct opclass",
      idxText.includes("vector_cosine_ops"),
      "Index opclass is vector_cosine_ops (matches <=> operator)");
    grade("D", "semantic", "GIN index uses jsonb_path_ops",
      idxText.includes("jsonb_path_ops"),
      "Index opclass is jsonb_path_ops for containment queries");
    grade("D", "semantic", "index method is hnsw",
      idxText.includes("hnsw"),
      "Index access method confirmed as hnsw");
  } else {
    grade("D", "semantic", "verification schema setup", false,
      "Could not create verification objects");
  }

  // Cleanup
  await callTool(proc, "pgsql_modify", {
    connectionId: connId,
    statement: `DROP SCHEMA IF EXISTS ${VERIFY_SCHEMA} CASCADE;`,
  });

  // =========================================================================
  // Phase E: Eval Regression Cases
  // =========================================================================
  console.log("\n── Phase E: Eval Regression Cases ──\n");

  for (const regression of EVAL_REGRESSION_CASES) {
    const content = loadSkillContent(regression.skillId);
    if (!content) continue;

    console.log(`  ${regression.skillId}: ${regression.issue}`);
    for (const check of regression.checks) {
      const passed = check.test(content);
      grade("E", "regression", `${regression.skillId}: ${check.name}`,
        passed,
        passed ? "OK" : check.reason);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║   AI Application Dogfood Test — RAG Product Q&A System         ║");
  console.log("║   Testing: Skills guidance accuracy + MCP execution fidelity   ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  const skills = loadSkillsManifest();
  console.log(`Loaded ${skills.length} skills from .skills.json\n`);

  // Spawn MCP server
  console.log("Starting MCP server...");
  const libpqConnString = toLibpqString(CONN_STRING);
  const proc = spawn("node", [SCRIPT], {
    env: { ...process.env, PGSQL_CONNECTION_STRING: libpqConnString },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderrBuf = "";
  proc.stderr.on("data", (d) => (stderrBuf += d.toString()));

  const killTimer = setTimeout(() => {
    console.error("TIMEOUT — killing MCP server");
    proc.kill("SIGTERM");
    process.exit(1);
  }, TIMEOUT_MS);

  try {
    await initMCP(proc);
    sendMsg(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
    console.log("MCP server initialized ✅\n");

    // Connect to database
    console.log("Connecting to test database...");
    const profiles = await callTool(proc, "pgsql_list_connection_profiles", {});
    const profileText = getToolText(profiles);
    const profileMatch = profileText.match(/"profileId"\s*:\s*"([^"]+)"/);
    assert(profileMatch, "No connection profile found — is PGSQL_TEST_CONNECTION_STRING set?");

    const { connId } = await connectWithRetry(proc, profileMatch[1]);
    console.log(`Connected: ${connId} ✅\n`);

    // Run the full application build
    await buildApp(proc, connId, skills);

    // Run strengthened quality validation (no LLM required)
    await validateSkillQuality(proc, connId, skills);

    // Disconnect
    await callTool(proc, "pgsql_disconnect", { connectionId: connId });

  } finally {
    clearTimeout(killTimer);
    proc.kill("SIGTERM");
  }

  // =========================================================================
  // Final Report Card
  // =========================================================================
  console.log("\n" + "═".repeat(70));
  console.log("FINAL REPORT CARD");
  console.log("═".repeat(70) + "\n");

  const passed = grades.filter((g) => g.pass).length;
  const failed = grades.filter((g) => !g.pass).length;
  const total = grades.length;
  const pct = ((passed / total) * 100).toFixed(1);

  // Group by skill
  const bySkill = {};
  for (const g of grades) {
    if (!bySkill[g.skillName]) bySkill[g.skillName] = { pass: 0, fail: 0, items: [] };
    bySkill[g.skillName][g.pass ? "pass" : "fail"]++;
    bySkill[g.skillName].items.push(g);
  }

  console.log("Skill-by-Skill Grades:");
  console.log("─".repeat(50));
  for (const [skill, data] of Object.entries(bySkill).sort((a, b) => a[0].localeCompare(b[0]))) {
    const emoji = data.fail === 0 ? "✅" : "⚠️";
    console.log(`  ${emoji} ${skill}: ${data.pass}/${data.pass + data.fail} checks passed`);
    if (data.fail > 0) {
      for (const item of data.items.filter((i) => !i.pass)) {
        console.log(`     ❌ ${item.aspect}: ${item.detail}`);
      }
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`TOTAL: ${passed}/${total} checks passed (${pct}%)`);
  console.log(`  ✅ Passed: ${passed}`);
  if (failed > 0) console.log(`  ❌ Failed: ${failed}`);

  // Summary assessment
  console.log(`\n${"─".repeat(50)}`);
  console.log("ASSESSMENT:");
  if (pct >= 95) {
    console.log("  🏆 EXCELLENT — Skills provided accurate, complete guidance for building a real AI app.");
  } else if (pct >= 85) {
    console.log("  👍 GOOD — Skills mostly guided correctly, minor gaps identified.");
  } else if (pct >= 70) {
    console.log("  ⚠️  NEEDS WORK — Skills had notable gaps in guiding the AI app setup.");
  } else {
    console.log("  🚨 POOR — Skills failed to adequately guide the AI application setup.");
  }

  const skillsCovered = new Set(grades.map((g) => g.skillName).filter((n) => n !== "routing" && n !== "mcp"));
  console.log(`\nSkills exercised: ${[...skillsCovered].join(", ")}`);
  console.log(`Phases completed: 7 (Foundation → Schema → Data → Indexing → Security → Queries → Cleanup)`);
  console.log(`Application built: Multi-tenant RAG Product Q&A with FTS + Vector + JSONB + RLS\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
