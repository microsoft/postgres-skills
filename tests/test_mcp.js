// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

#!/usr/bin/env node
// test_mcp.js — Automated MCP protocol test for pgsql-tools MCP server.
// Sends JSON-RPC messages over stdio and validates responses.

const { spawn } = require("child_process");
const { join } = require("path");

const SCRIPT = join(__dirname, "run_mcp.js");
const TIMEOUT_MS = 60_000; // 60s total test timeout
const MSG_TIMEOUT_MS = 15_000; // 15s per message

// --- Test messages -----------------------------------------------------------
const tests = [
  {
    name: "initialize",
    send: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test_mcp.js", version: "1.0.0" },
      },
    },
    validate: (res) => {
      assert(res.id === 1, "id should be 1");
      assert(res.result, "should have result");
      assert(res.result.serverInfo, "should have serverInfo");
      assert(res.result.capabilities, "should have capabilities");
      return `Server: ${res.result.serverInfo.name || "unknown"} v${res.result.serverInfo.version || "?"}`;
    },
  },
  {
    name: "initialized (notification)",
    send: {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    expectNoResponse: true,
  },
  {
    name: "tools/list",
    send: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    },
    validate: (res) => {
      assert(res.id === 2, "id should be 2");
      assert(res.result, "should have result");
      assert(Array.isArray(res.result.tools), "result.tools should be array");
      const names = res.result.tools.map((t) => t.name);
      return `${names.length} tools: ${names.join(", ")}`;
    },
  },
];

// --- Helpers -----------------------------------------------------------------
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function sendMsg(proc, msg) {
  // FastMCP stdio uses newline-delimited JSON (NDJSON)
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

function waitForResponse(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for response`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
      // NDJSON: split on newlines, try parsing each complete line
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete trailing line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          // Only resolve for JSON-RPC responses (have "id" or "result"/"error")
          if (parsed.jsonrpc === "2.0" && ("id" in parsed || "result" in parsed)) {
            cleanup();
            resolve(parsed);
            return;
          }
        } catch {
          // Not valid JSON — skip (server banner text, etc.)
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

// --- Main test runner --------------------------------------------------------
async function main() {
  console.log("=== MCP Protocol Test Suite ===\n");

  // Start the MCP server
  console.log("Starting MCP server via run_mcp.js...");
  const proc = spawn("node", [SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PGSQL_TOOLS_QUERY_TIMEOUT_MS: "10000" },
  });

  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  // Global timeout
  const globalTimer = setTimeout(() => {
    console.error("\nGlobal timeout reached. Killing server.");
    proc.kill();
    process.exit(1);
  }, TIMEOUT_MS);

  // Wait for server to finish booting (binary download + startup)
  await new Promise((r) => setTimeout(r, 5000));

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    process.stdout.write(`  ${test.name} ... `);
    try {
      sendMsg(proc, test.send);

      if (test.expectNoResponse) {
        // Notifications don't get responses; short wait to confirm no error
        await new Promise((r) => setTimeout(r, 1000));
        console.log("OK (notification sent)");
        passed++;
        continue;
      }

      const response = await waitForResponse(proc, MSG_TIMEOUT_MS);

      if (response.error) {
        throw new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`);
      }

      const detail = test.validate(response);
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

  // Print stderr from server (download progress, etc.)
  if (stderr.trim()) {
    console.log("\n--- Server stderr ---");
    console.log(stderr.trim());
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Test runner error: ${err.message}`);
  process.exit(1);
});
