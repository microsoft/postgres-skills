# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Routing performance budget.

The keyword routing scan over the skills manifest must stay well under budget.
The MCP server cold-start (15s budget) is also asserted here.
"""

import subprocess
import time

from conftest import ROOT, mcp_server_command

ROUTING_BUDGET_MS = 100
ITERATIONS = 1000
PROMPT = (
    "How do I create a DiskANN index for vector similarity search "
    "on Azure PostgreSQL?"
)
COLD_START_BUDGET_S = 15


def test_routing_within_budget(skills):
    prompt = PROMPT.lower()
    start = time.perf_counter_ns()
    for _ in range(ITERATIONS):
        for skill in skills:
            for kw in skill.get("activation_keywords", []):
                if kw.lower() in prompt:
                    break
    elapsed_ms = (time.perf_counter_ns() - start) / 1_000_000
    avg_ms = elapsed_ms / ITERATIONS
    print(f"Routing time: {avg_ms:.3f}ms per query ({ITERATIONS} iterations)")
    assert avg_ms <= ROUTING_BUDGET_MS, f"routing {avg_ms:.3f}ms exceeds {ROUTING_BUDGET_MS}ms budget"


def test_mcp_cold_start_within_budget():
    """The server must download/initialize and exit on EOF within the budget.

    Launches the server exactly as ``plugin/.mcp.json`` declares it
    (``npx @microsoft/postgres-mcp run``).
    """
    start = time.perf_counter()
    try:
        subprocess.run(
            mcp_server_command(),
            cwd=str(ROOT),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=COLD_START_BUDGET_S,
        )
    except subprocess.TimeoutExpired:
        raise AssertionError(
            f"MCP cold start exceeded {COLD_START_BUDGET_S}s budget"
        )
    elapsed = time.perf_counter() - start
    print(f"Cold-start time: {elapsed * 1000:.0f}ms")
