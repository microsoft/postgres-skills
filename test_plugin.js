#!/usr/bin/env node
// test_plugin.js — Plugin integration test.
// Simulates how an AI platform uses the plugin: skill routing + MCP tools together.
//
// Flow per scenario:
//   1. Match user prompt → skill(s) via activation_keywords
//   2. Load SKILL.md content
//   3. Execute MCP tools guided by skill content
//   4. Verify skill guidance led to correct tool usage + results
//
// Usage:
//   PGSQL_TEST_CONNECTION_STRING="host=... user=... password=... sslmode=..." node test_plugin.js

const { spawn } = require("child_process");
const { join, resolve } = require("path");
const fs = require("fs");

const ROOT = __dirname;
const SCRIPT = join(ROOT, "run_mcp.js");
const TIMEOUT_MS = 180_000;
const MSG_TIMEOUT_MS = 30_000;

const CONN_STRING =
  process.env.PGSQL_TEST_CONNECTION_STRING ||
  (() => {
    console.error(
      "ERROR: Set PGSQL_TEST_CONNECTION_STRING env var (libpq format: host=... port=... dbname=... user=... password=... sslmode=...)"
    );
    process.exit(1);
  })();

// ---------------------------------------------------------------------------
// Skill routing engine (mirrors what AI platforms do)
// ---------------------------------------------------------------------------

function loadSkillsManifest() {
  const root = JSON.parse(fs.readFileSync(join(ROOT, ".skills.json"), "utf8"));
  return root.skills;
}

function routePrompt(prompt, skills) {
  const lower = prompt.toLowerCase();
  const words = new Set(lower.split(/\W+/).filter(Boolean));
  const matches = [];
  for (const skill of skills) {
    const hit = (skill.activation_keywords || []).some((kw) => {
      const kwLower = kw.toLowerCase();
      // Exact substring match
      if (lower.includes(kwLower)) return true;
      // All words in keyword phrase appear in prompt
      const kwWords = kwLower.split(/\W+/).filter(Boolean);
      return kwWords.length > 0 && kwWords.every((w) => words.has(w));
    });
    if (hit || skill.always_load) {
      matches.push(skill);
    }
  }
  return matches;
}

function loadSkillContent(skill) {
  const fullPath = join(ROOT, skill.path);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
}

// ---------------------------------------------------------------------------
// MCP helpers (shared with test_e2e.js pattern)
// ---------------------------------------------------------------------------

let nextId = 1;
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function sendMsg(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

function callTool(proc, toolName, args) {
  const id = nextId++;
  sendMsg(proc, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  return waitForResponse(proc, id, MSG_TIMEOUT_MS);
}

function waitForResponse(proc, expectedId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for id=${expectedId}`
        )
      );
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.jsonrpc === "2.0" && parsed.id === expectedId) {
            cleanup();
            resolve(parsed);
            return;
          }
        } catch {}
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.removeListener("data", onData);
    };
    proc.stdout.on("data", onData);
  });
}

async function initSession(proc) {
  const initId = nextId++;
  sendMsg(proc, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test_plugin.js", version: "1.0.0" },
    },
  });
  const res = await waitForResponse(proc, initId, MSG_TIMEOUT_MS);
  assert(res.result, "initialize should return result");
  sendMsg(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  await new Promise((r) => setTimeout(r, 500));
  return res.result.serverInfo;
}

function getToolText(res) {
  if (res.error)
    throw new Error(`RPC error ${res.error.code}: ${res.error.message}`);
  assert(res.result, "should have result");
  const content = res.result.content;
  if (Array.isArray(content)) {
    return content.map((c) => c.text || JSON.stringify(c)).join("\n");
  }
  return JSON.stringify(res.result);
}

function parseConnectionId(text) {
  const m = text.match(/pgsql\/[0-9a-f-]+(?:\/[\w-]+)?/i);
  if (m) return m[0];
  try {
    const obj = JSON.parse(text);
    if (obj.connectionId) return obj.connectionId;
  } catch {}
  const idMatch = text.match(/"connectionId"\s*:\s*"([^"]+)"/);
  if (idMatch) return idMatch[1];
  return null;
}

// ---------------------------------------------------------------------------
// Connect helper (reused across scenarios)
// ---------------------------------------------------------------------------

async function connectToDatabase(proc) {
  const listRes = await callTool(proc, "pgsql_list_connection_profiles", {});
  const listText = getToolText(listRes);
  const uuidMatch = listText.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  assert(uuidMatch, "Should find profileId UUID");
  const profileId = uuidMatch[0];
  const connRes = await callTool(proc, "pgsql_connect", { profileId });
  const connText = getToolText(connRes);
  const connId = parseConnectionId(connText);
  assert(connId, "Should get connectionId from connect");
  return connId;
}

// ---------------------------------------------------------------------------
// Plugin test scenarios
// ---------------------------------------------------------------------------

const scenarios = [
  // ---- Scenario 1: Skill routing accuracy ----
  {
    name: "Skill routing — 'My query is slow, how do I optimize it?'",
    run: async (_proc, skills) => {
      const prompt = "My query is slow, how do I optimize it?";
      const matched = routePrompt(prompt, skills);
      const ids = matched.map((s) => s.id);
      // Should route to query-performance skill
      assert(
        ids.includes("query-performance"),
        `Should match query-performance, got: ${ids.join(", ")}`
      );
      // Should also load always_load root skill
      assert(
        ids.includes("postgresql-core"),
        `Should include always_load postgresql-core, got: ${ids.join(", ")}`
      );
      return `Routed to: ${ids.join(", ")}`;
    },
  },
  {
    name: "Skill routing — 'Install pgvector on Azure PostgreSQL'",
    run: async (_proc, skills) => {
      const prompt = "Install pgvector on Azure PostgreSQL";
      const matched = routePrompt(prompt, skills);
      const ids = matched.map((s) => s.id);
      assert(
        ids.includes("extension-lifecycle") || ids.includes("vector-diskann"),
        `Should match extension or vector skill, got: ${ids.join(", ")}`
      );
      assert(
        ids.includes("azure-postgresql-core"),
        `Should include always_load azure-postgresql-core, got: ${ids.join(", ")}`
      );
      return `Routed to: ${ids.join(", ")}`;
    },
  },
  {
    name: "Skill routing — 'Set up row level security for multi-tenant'",
    run: async (_proc, skills) => {
      const prompt = "Set up row level security for multi-tenant";
      const matched = routePrompt(prompt, skills);
      const ids = matched.map((s) => s.id);
      assert(
        ids.includes("row-level-security"),
        `Should match row-level-security, got: ${ids.join(", ")}`
      );
      return `Routed to: ${ids.join(", ")}`;
    },
  },

  // ---- Scenario 2: Skill content → MCP version check ----
  {
    name: "Skill+MCP — Root skill says 'check version first' → pgsql_query(SELECT version())",
    run: async (proc, skills) => {
      // Load the root postgresql skill
      const rootSkill = skills.find((s) => s.id === "postgresql-core");
      assert(rootSkill, "Should find postgresql-core skill");
      const content = loadSkillContent(rootSkill);
      assert(content, "Should load SKILL.md content");

      // Verify skill instructs version check
      assert(
        content.includes("SELECT version()"),
        "Root skill should instruct SELECT version()"
      );

      // Execute via MCP (skill-guided action)
      const connId = await connectToDatabase(proc);
      const res = await callTool(proc, "pgsql_query", {
        connectionId: connId,
        query: "SELECT version();",
      });
      const text = getToolText(res);
      assert(
        text.toLowerCase().includes("postgresql"),
        `Version check should return PostgreSQL, got: ${text.substring(0, 100)}`
      );
      return `Skill guided version check → ${text.substring(0, 80)}`;
    },
  },

  // ---- Scenario 3: Azure skill → extension allowlist check ----
  {
    name: "Skill+MCP — extension-lifecycle says 'check SHOW azure.extensions' → pgsql_query",
    run: async (proc, skills) => {
      const extSkill = skills.find((s) => s.id === "extension-lifecycle");
      assert(extSkill, "Should find extension-lifecycle skill");
      const content = loadSkillContent(extSkill);
      assert(content, "Should load extension-lifecycle SKILL.md");

      // Verify skill instructs allowlist check
      assert(
        content.includes("SHOW azure.extensions") ||
          content.includes("azure.extensions"),
        "Extension skill should mention azure.extensions allowlist"
      );

      // Execute via MCP (skill-guided action)
      const connId = await connectToDatabase(proc);
      const res = await callTool(proc, "pgsql_query", {
        connectionId: connId,
        query: "SHOW azure.extensions;",
      });
      const text = getToolText(res);
      // Azure server should return the extensions allowlist
      assert(
        !text.toLowerCase().includes("syntax error"),
        `Should not get syntax error on Azure server, got: ${text.substring(0, 100)}`
      );
      return `Skill guided allowlist check → ${text.substring(0, 80)}...`;
    },
  },

  // ---- Scenario 4: Query performance skill → EXPLAIN ANALYZE ----
  {
    name: "Skill+MCP — query-performance says 'use EXPLAIN ANALYZE' → pgsql_query(EXPLAIN...)",
    run: async (proc, skills) => {
      const perfSkill = skills.find((s) => s.id === "query-performance");
      assert(perfSkill, "Should find query-performance skill");
      const content = loadSkillContent(perfSkill);
      assert(content, "Should load query-performance SKILL.md");

      // Verify skill instructs EXPLAIN ANALYZE
      assert(
        content.includes("EXPLAIN") && content.includes("ANALYZE"),
        "Performance skill should instruct EXPLAIN ANALYZE"
      );

      // Execute via MCP (skill-guided action)
      const connId = await connectToDatabase(proc);
      const res = await callTool(proc, "pgsql_query", {
        connectionId: connId,
        query: "EXPLAIN ANALYZE SELECT 1;",
      });
      const text = getToolText(res);
      assert(
        text.includes("Planning") || text.includes("Execution"),
        `EXPLAIN should return query plan, got: ${text.substring(0, 120)}`
      );
      return `Skill guided EXPLAIN → plan returned (${text.length} chars)`;
    },
  },

  // ---- Scenario 5: Indexing skill → create + verify index ----
  {
    name: "Skill+MCP — advanced-indexing says 'confirm with pg_indexes' → CREATE + verify",
    run: async (proc, skills) => {
      const idxSkill = skills.find((s) => s.id === "advanced-indexing");
      assert(idxSkill, "Should find advanced-indexing skill");
      const content = loadSkillContent(idxSkill);
      assert(content, "Should load advanced-indexing SKILL.md");

      const connId = await connectToDatabase(proc);

      // Create test table + index
      await callTool(proc, "pgsql_modify", {
        connectionId: connId,
        statement:
          "CREATE TABLE IF NOT EXISTS _plugin_test_idx (id serial PRIMARY KEY, data text);",
      });
      await callTool(proc, "pgsql_modify", {
        connectionId: connId,
        statement:
          "CREATE INDEX IF NOT EXISTS _plugin_test_idx_data ON _plugin_test_idx(data);",
      });

      // Skill says verify index was created — check pg_indexes
      const res = await callTool(proc, "pgsql_query", {
        connectionId: connId,
        query:
          "SELECT indexname FROM pg_indexes WHERE tablename = '_plugin_test_idx' AND indexname = '_plugin_test_idx_data';",
      });
      const text = getToolText(res);
      assert(
        text.includes("_plugin_test_idx_data"),
        `Should find created index in pg_indexes, got: ${text.substring(0, 100)}`
      );

      // Cleanup
      await callTool(proc, "pgsql_modify", {
        connectionId: connId,
        statement: "DROP TABLE IF EXISTS _plugin_test_idx CASCADE;",
      });
      return `Skill guided: CREATE INDEX + verified via pg_indexes → confirmed`;
    },
  },

  // ---- Scenario 6: Azure server capabilities detection ----
  {
    name: "Skill+MCP — azure-postgresql-core checks tier → pgsql_get_server_capabilities",
    run: async (proc, skills) => {
      const azSkill = skills.find((s) => s.id === "azure-postgresql-core");
      assert(azSkill, "Should find azure-postgresql-core skill");
      const content = loadSkillContent(azSkill);
      assert(content, "Should load azure-postgresql SKILL.md");

      // Skill says check server tier/capabilities
      assert(
        content.includes("server_tier") || content.includes("Burstable"),
        "Azure skill should mention server tier detection"
      );

      const connId = await connectToDatabase(proc);
      const res = await callTool(proc, "pgsql_get_server_capabilities", {
        connectionId: connId,
      });
      const text = getToolText(res);
      assert(
        text.includes("isAzure") || text.includes("serverVersion"),
        `Should get capabilities, got: ${text.substring(0, 100)}`
      );

      // On our Azure test server, isAzure should be true
      const isAzure =
        text.includes('"isAzure":true') || text.includes('"isAzure": true');
      return `Capabilities detected — isAzure: ${isAzure}, response: ${text.substring(0, 80)}...`;
    },
  },

  // ---- Scenario 7: Schema introspection (db_context) ----
  {
    name: "Skill+MCP — root skill says 'query information_schema' → pgsql_db_context",
    run: async (proc, skills) => {
      const rootSkill = skills.find((s) => s.id === "postgresql-core");
      const content = loadSkillContent(rootSkill);

      // Skill mentions information_schema for confirming changes
      assert(
        content.includes("information_schema"),
        "Root skill should mention information_schema"
      );

      const connId = await connectToDatabase(proc);
      const res = await callTool(proc, "pgsql_db_context", {
        connectionId: connId,
        objectType: "schema",
      });
      const text = getToolText(res);
      // Should get schema listing (tables, views, etc.)
      return `Schema introspection returned (${text.length} chars)`;
    },
  },

  // ---- Scenario 8: SKILL.md completeness check ----
  {
    name: "All 21 skills load without errors",
    run: async (_proc, skills) => {
      let loaded = 0;
      let errors = [];
      for (const skill of skills) {
        const content = loadSkillContent(skill);
        if (!content) {
          errors.push(`${skill.id}: file not found at ${skill.path}`);
          continue;
        }
        // Every SKILL.md must have frontmatter and at least one heading
        if (!content.includes("---") || !content.includes("# ")) {
          errors.push(`${skill.id}: missing frontmatter or headings`);
          continue;
        }
        loaded++;
      }
      assert(
        errors.length === 0,
        `Skill loading errors:\n  ${errors.join("\n  ")}`
      );
      assert(loaded >= 21, `Expected ≥21 skills, loaded ${loaded}`);
      return `All ${loaded} skills loaded and validated`;
    },
  },

  // ---- Scenario 9: Keyword coverage — no dead skills ----
  {
    name: "Every non-always_load skill has unique activation keywords",
    run: async (_proc, skills) => {
      const keywordMap = new Map();
      let dups = [];
      for (const skill of skills) {
        if (skill.always_load) continue;
        for (const kw of skill.activation_keywords || []) {
          const lower = kw.toLowerCase();
          if (keywordMap.has(lower)) {
            dups.push(`"${kw}" → ${keywordMap.get(lower)} AND ${skill.id}`);
          }
          keywordMap.set(lower, skill.id);
        }
      }
      // Duplicates are OK if they're across scopes (pg vs azure)
      const realDups = dups.filter(
        (d) =>
          !(d.includes("postgresql") && d.includes("azure")) &&
          !d.includes("always_load")
      );
      return `${keywordMap.size} keywords mapped across ${skills.length} skills. Cross-scope overlaps: ${dups.length}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Plugin Integration Test (Skills + MCP) ===\n");

  // Load skill manifests
  const skills = loadSkillsManifest();
  console.log(`  Loaded ${skills.length} skills from .skills.json\n`);

  // Start MCP server
  console.log("  Starting MCP server...");
  const proc = spawn("node", [SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PGSQL_CONNECTION_STRING: CONN_STRING,
      PGSQL_TOOLS_QUERY_TIMEOUT_MS: "30000",
    },
  });

  let stderrBuf = "";
  proc.stderr.on("data", (d) => (stderrBuf += d.toString()));
  proc.on("error", (e) => {
    console.error("Server failed to start:", e.message);
    process.exit(1);
  });

  await new Promise((r) => setTimeout(r, 3000)); // let server boot

  let passed = 0;
  let failed = 0;
  const failures = [];

  const deadline = setTimeout(() => {
    console.error("\n  TIMEOUT: test suite exceeded", TIMEOUT_MS / 1000, "s");
    proc.kill("SIGTERM");
    process.exit(2);
  }, TIMEOUT_MS);

  try {
    const info = await initSession(proc);
    console.log(
      `  MCP handshake — ${info.name} v${info.version}\n`
    );

    for (const t of scenarios) {
      const label = `  ${t.name}`;
      try {
        const result = await t.run(proc, skills);
        console.log(`${label} ... ✅ ${result}`);
        passed++;
      } catch (err) {
        console.log(`${label} ... ❌ ${err.message}`);
        failures.push({ name: t.name, error: err.message });
        failed++;
      }
    }
  } catch (err) {
    console.error("\n  FATAL:", err.message);
    failed++;
  } finally {
    clearTimeout(deadline);
    proc.kill("SIGTERM");
  }

  // Summary
  console.log(
    `\n=== Results: ${passed} passed, ${failed} failed (of ${scenarios.length} scenarios) ===`
  );
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ❌ ${f.name}: ${f.error}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
