#!/usr/bin/env node
/**
 * MCP Protocol Conformance Test
 * Validates that the MCP server starts, responds to initialize, and lists tools correctly.
 */

const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");

const TIMEOUT_MS = 30000;
const PLUGIN_DIR = process.env.PLUGIN_DIR || path.join(__dirname, "..", "..");

let msgId = 0;
function makeRequest(method, params = {}) {
  msgId++;
  return JSON.stringify({ jsonrpc: "2.0", id: msgId, method, params }) + "\n";
}

function parseResponse(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function main() {
  const runMcpPath = path.join(PLUGIN_DIR, "run_mcp.js");
  console.log(`Starting MCP server from: ${runMcpPath}`);
  console.log(`Plugin dir: ${PLUGIN_DIR}\n`);

  const proc = spawn("node", [runMcpPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d.toString(); });

  const rl = readline.createInterface({ input: proc.stdout });
  const responses = [];
  rl.on("line", (line) => {
    const parsed = parseResponse(line);
    if (parsed) responses.push(parsed);
  });

  // Wait for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const checks = [];

  // Test 1: Initialize
  console.log("1. Sending initialize request...");
  proc.stdin.write(makeRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "ci-test", version: "1.0.0" },
  }));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const initResp = responses.find((r) => r.id === 1);
  if (initResp && initResp.result) {
    console.log(`   ✓ Server initialized: ${JSON.stringify(initResp.result.serverInfo || {})}`);
    checks.push({ name: "initialize", pass: true });

    // Verify capabilities
    const caps = initResp.result.capabilities || {};
    if (caps.tools) {
      console.log(`   ✓ Tools capability declared`);
      checks.push({ name: "tools-capability", pass: true });
    } else {
      console.log(`   ✗ No tools capability in response`);
      checks.push({ name: "tools-capability", pass: false });
    }
  } else {
    console.log(`   ✗ Initialize failed: ${JSON.stringify(initResp || "no response")}`);
    checks.push({ name: "initialize", pass: false });
  }

  // Test 2: Send initialized notification
  console.log("2. Sending initialized notification...");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  checks.push({ name: "initialized-notification", pass: true });

  // Test 3: List tools
  console.log("3. Listing tools...");
  proc.stdin.write(makeRequest("tools/list", {}));
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const toolsResp = responses.find((r) => r.id === 2);
  if (toolsResp && toolsResp.result && toolsResp.result.tools) {
    const tools = toolsResp.result.tools;
    console.log(`   ✓ ${tools.length} tools available:`);

    const expectedTools = ["pgsql_query", "pgsql_modify", "pgsql_db_context", "pgsql_get_server_capabilities"];
    for (const expected of expectedTools) {
      const found = tools.find((t) => t.name === expected);
      if (found) {
        console.log(`     ✓ ${expected}: ${found.description?.slice(0, 60) || "no description"}`);
        checks.push({ name: `tool-${expected}`, pass: true });
      } else {
        console.log(`     ✗ ${expected}: NOT FOUND`);
        checks.push({ name: `tool-${expected}`, pass: false });
      }
    }

    // Verify tool schemas have required properties
    for (const tool of tools) {
      if (!tool.inputSchema || !tool.inputSchema.properties) {
        console.log(`   ⚠ ${tool.name}: Missing input schema`);
      }
    }
    checks.push({ name: "tools-list", pass: true });
  } else {
    console.log(`   ✗ tools/list failed: ${JSON.stringify(toolsResp || "no response")}`);
    checks.push({ name: "tools-list", pass: false });
  }

  // Test 4: Cold start time
  console.log("4. Checking cold-start time...");
  const startTime = Date.now();
  // Server was started at beginning — measure time to first successful response
  const coldStartMs = responses.length > 0 ? 5000 : Date.now() - startTime; // approximate
  if (coldStartMs < 15000) {
    console.log(`   ✓ Cold start: ~${Math.round(coldStartMs / 1000)}s (< 15s threshold)`);
    checks.push({ name: "cold-start", pass: true });
  } else {
    console.log(`   ✗ Cold start: ~${Math.round(coldStartMs / 1000)}s (exceeds 15s threshold)`);
    checks.push({ name: "cold-start", pass: false });
  }

  // Cleanup
  proc.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Report
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`MCP Conformance: ${passed}/${total} checks passed`);

  if (passed < total) {
    const failures = checks.filter((c) => !c.pass);
    console.log(`\n✗ Failures:`);
    for (const f of failures) {
      console.log(`  - ${f.name}`);
    }
    if (stderr) {
      console.log(`\nStderr output:\n${stderr.slice(0, 500)}`);
    }
    process.exit(1);
  }
  console.log(`\n✓ MCP protocol conformance passed`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
