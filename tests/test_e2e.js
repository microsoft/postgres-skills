#!/usr/bin/env node
// test_e2e.js — End-to-end MCP integration test.
// Starts the MCP server, connects to a real PostgreSQL database,
// executes queries via MCP tools, and validates results.
//
// Usage:
//   node test_e2e.js
//
// Requires PGSQL_TEST_CONNECTION_STRING env var or pass inline:
//   PGSQL_TEST_CONNECTION_STRING="host=... dbname=..." node test_e2e.js

const { spawn } = require("child_process");
const { join } = require("path");

const SCRIPT = join(__dirname, "run_mcp.js");
const TIMEOUT_MS = 120_000; // 2 min total
const MSG_TIMEOUT_MS = 30_000; // 30s per tool call

const CONN_STRING =
  process.env.PGSQL_TEST_CONNECTION_STRING ||
  (() => { console.error("ERROR: Set PGSQL_TEST_CONNECTION_STRING env var (libpq format: host=... port=... dbname=... user=... password=... sslmode=...)"); process.exit(1); })();

// pgsql-tools uses PGSQL_CONNECTION_STRING env var for password-based auth in CI.
// Build a standard libpq connection string from our test string.
function toLibpqString(cs) {
  const get = (key) => {
    const m = cs.match(new RegExp(`${key}=([^\\s]+)`));
    return m ? m[1] : undefined;
  };
  const h = get("host"), p = get("port") || "5432", d = get("dbname") || "postgres";
  const u = get("user") || "postgres", pw = get("password"), ssl = get("sslmode");
  let s = `host=${h} port=${p} dbname=${d} user=${u}`;
  if (pw) s += ` password=${pw}`;
  if (ssl) s += ` sslmode=${ssl}`;
  return s;
}

function parseConnString(cs) {
  const get = (key) => {
    const m = cs.match(new RegExp(`${key}=([^\\s]+)`));
    return m ? m[1] : undefined;
  };
  return {
    host: get("host") || "localhost",
    port: parseInt(get("port") || "5432", 10),
    user: get("user") || "postgres",
    database: get("dbname") || "postgres",
    ssl_mode: get("sslmode") || "prefer",
  };
}

// --- Helpers -----------------------------------------------------------------

let nextId = 1;
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function sendMsg(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

function callTool(proc, toolName, args) {
  const id = nextId++;
  const msg = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };
  sendMsg(proc, msg);
  return waitForResponse(proc, id, MSG_TIMEOUT_MS);
}

function waitForResponse(proc, expectedId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for id=${expectedId}`));
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
        } catch {
          // skip non-JSON lines
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.removeListener("data", onData);
    };

    proc.stdout.on("data", onData);
  });
}

// Initialize the MCP session (handshake)
async function initSession(proc) {
  const initId = nextId++;
  sendMsg(proc, {
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test_e2e.js", version: "1.0.0" },
    },
  });

  const res = await waitForResponse(proc, initId, MSG_TIMEOUT_MS);
  assert(res.result, "initialize should return result");

  // Send initialized notification
  sendMsg(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  await new Promise((r) => setTimeout(r, 500));

  return res.result.serverInfo;
}

function getToolText(res) {
  if (res.error) throw new Error(`RPC error ${res.error.code}: ${res.error.message}`);
  assert(res.result, "should have result");
  const content = res.result.content;
  if (Array.isArray(content)) {
    return content.map((c) => c.text || JSON.stringify(c)).join("\n");
  }
  return JSON.stringify(res.result);
}

// --- Test cases --------------------------------------------------------------

const connParams = parseConnString(CONN_STRING);

// Shared state — connectionId returned by pgsql_connect
let connectionId = null;

function parseConnectionId(text) {
  // Look for pgsql/UUID/dbname pattern (the actual format returned by pgsql_connect)
  const pgsqlMatch = text.match(/pgsql\/[0-9a-f-]+(?:\/[\w-]+)?/i);
  if (pgsqlMatch) return pgsqlMatch[0];
  // JSON structuredContent fallback
  try {
    const obj = JSON.parse(text);
    if (obj.connectionId) return obj.connectionId;
  } catch {}
  // Quoted connectionId fallback
  const idMatch = text.match(/"connectionId"\s*:\s*"([^"]+)"/);
  if (idMatch) return idMatch[1];
  return null;
}

const testCases = [
  {
    name: "pgsql_list_connection_profiles",
    run: async (proc) => {
      const res = await callTool(proc, "pgsql_list_connection_profiles", {});
      const text = getToolText(res);
      return `Profiles: ${text.substring(0, 150)}`;
    },
  },
  {
    name: "pgsql_connect (via PGSQL_CONNECTION_STRING env)",
    run: async (proc) => {
      // PGSQL_CONNECTION_STRING creates a default profile; list to find its ID
      const listRes = await callTool(proc, "pgsql_list_connection_profiles", {});
      const listText = getToolText(listRes);

      // Extract profileId (UUID format) from response
      let profileId = null;
      const uuidMatch = listText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (uuidMatch) profileId = uuidMatch[0];
      assert(profileId, `Could not find profileId in: ${listText.substring(0, 200)}`);

      const res = await callTool(proc, "pgsql_connect", { profileId });
      const text = getToolText(res);
      connectionId = parseConnectionId(text);
      assert(connectionId, `Could not parse connectionId from: ${text.substring(0, 200)}`);
      return `Connected — connectionId: ${connectionId}`;
    },
  },
  {
    name: "pgsql_list_databases",
    run: async (proc) => {
      assert(connectionId, "no connectionId from prior connect");
      const res = await callTool(proc, "pgsql_list_databases", { connectionId });
      const text = getToolText(res);
      assert(text.toLowerCase().includes("postgres"), "should list postgres database");
      return `Databases found — response includes 'postgres'`;
    },
  },
  {
    name: "pgsql_query (SELECT version())",
    run: async (proc) => {
      assert(connectionId, "no connectionId");
      const res = await callTool(proc, "pgsql_query", {
        connectionId,
        query: "SELECT version();",
      });
      const text = getToolText(res);
      assert(text.toLowerCase().includes("postgresql"), "version should contain 'postgresql'");
      const ver = text.match(/PostgreSQL [\d.]+/i);
      return `Query OK — ${ver ? ver[0] : "version found"}`;
    },
  },
  {
    name: "pgsql_modify + pgsql_query (CREATE → INSERT → SELECT → DROP)",
    run: async (proc) => {
      assert(connectionId, "no connectionId");

      await callTool(proc, "pgsql_modify", {
        connectionId,
        statement: "CREATE TABLE IF NOT EXISTS _e2e_test (id serial PRIMARY KEY, val text);",
      });

      await callTool(proc, "pgsql_modify", {
        connectionId,
        statement: "INSERT INTO _e2e_test (val) VALUES ('hello_e2e');",
      });

      const res = await callTool(proc, "pgsql_query", {
        connectionId,
        query: "SELECT val FROM _e2e_test WHERE val = 'hello_e2e' LIMIT 1;",
      });
      const text = getToolText(res);
      assert(text.includes("hello_e2e"), "should find inserted row");

      await callTool(proc, "pgsql_modify", {
        connectionId,
        statement: "DROP TABLE IF EXISTS _e2e_test;",
      });

      return "CREATE → INSERT → SELECT → DROP all succeeded";
    },
  },
  {
    name: "pgsql_db_context (schema introspection)",
    run: async (proc) => {
      assert(connectionId, "no connectionId");
      const res = await callTool(proc, "pgsql_db_context", {
        connectionId,
        objectType: "tables",
      });
      const text = getToolText(res);
      assert(text.length > 10, "db_context should return non-trivial response");
      return `Schema context returned (${text.length} chars)`;
    },
  },
  {
    name: "pgsql_get_server_capabilities",
    run: async (proc) => {
      assert(connectionId, "no connectionId");
      const res = await callTool(proc, "pgsql_get_server_capabilities", { connectionId });
      const text = getToolText(res);
      return `Capabilities: ${text.substring(0, 150)}`;
    },
  },
  {
    name: "pgsql_disconnect",
    run: async (proc) => {
      assert(connectionId, "no connectionId");
      const res = await callTool(proc, "pgsql_disconnect", { connectionId });
      const text = getToolText(res);
      return `Disconnected: ${text.substring(0, 100)}`;
    },
  },
];

// --- Main runner -------------------------------------------------------------

async function main() {
  console.log("=== MCP End-to-End Integration Test ===\n");
  console.log(`Target: ${CONN_STRING.replace(/password=[^\s]+/, "password=***")}\n`);

  // Start MCP server
  console.log("Starting MCP server...");
  const libpq = toLibpqString(CONN_STRING);
  const proc = spawn("node", [SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PGSQL_TOOLS_QUERY_TIMEOUT_MS: "30000",
      PGSQL_CONNECTION_STRING: libpq,
    },
  });

  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  proc.on("error", (err) => {
    console.error(`Failed to start MCP server: ${err.message}`);
    process.exit(1);
  });

  const globalTimer = setTimeout(() => {
    console.error("\nGlobal timeout (2min). Killing server.");
    proc.kill();
    process.exit(1);
  }, TIMEOUT_MS);

  // Wait for server boot
  await new Promise((r) => setTimeout(r, 5000));

  // Initialize session
  process.stdout.write("  MCP handshake ... ");
  try {
    const info = await initSession(proc);
    console.log(`OK — ${info.name} v${info.version}`);
  } catch (err) {
    console.log(`FAIL — ${err.message}`);
    clearTimeout(globalTimer);
    proc.kill();
    process.exit(1);
  }

  // Run test cases
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    process.stdout.write(`  ${tc.name} ... `);
    try {
      const detail = await tc.run(proc);
      console.log(`OK — ${detail}`);
      passed++;
    } catch (err) {
      console.log(`FAIL — ${err.message}`);
      failed++;
    }
  }

  // Cleanup
  clearTimeout(globalTimer);
  proc.kill();

  if (stderr.trim()) {
    console.log("\n--- Server stderr (last 500 chars) ---");
    console.log(stderr.trim().slice(-500));
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed (of ${testCases.length} tests) ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Runner error: ${err.message}`);
  process.exit(1);
});
